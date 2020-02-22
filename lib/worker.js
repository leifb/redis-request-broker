const redis = require("redis");
const uniqid = require('uniqid');

const keys = require('./keys');
const messages = require('./messages');
const defaults = require('./defaults');

const HEALTH_CYCLE = 120;

/**
 * A worker that takes requests from clients, perfoms an action and returns a result.
 * 
 * @param queue The queue to listen on.
 * @param handle The method that will be called when receiving requests.
 *   It should return a promise that resolves to the result.
 * @param options Advanced options to configure the worker. Available options are:
 * 
 *  - redis
 *  - logger
 *  - levels
 *  
 *  See `defaults` for more details on these options.
 */
module.exports = class Worker {
    constructor(queue, handle, options) {
        this.id = uniqid();
        this.handle = handle;
        this.queueName = queue;
        const o = defaults.apply(options);
        this.logger = o.logger;
        this.levels = o.levels;
        this.redisOptions = o.redis;

        // Build queue names
        this.availabilitySet = keys.availabilitySet(queue);
        this.workerChannel = keys.workerChannel(queue, this.id);
        this.requestQueue = keys.requestQueue(queue);

        this._log(this.levels.debug, 'CONSTRUCTOR', `Initialized new worker.`);
        this._log(this.levels.debug, 'CONSTRUCTOR', `Availiblity set: '${this.availabilitySet}'.`);
        this._log(this.levels.debug, 'CONSTRUCTOR', `Worker channel: '${this.workerChannel}'.`);
        this._log(this.levels.debug, 'CONSTRUCTOR', `Request queue: '${this.requestQueue}'.`);
    }

    /**
     * Start listening to the channel for requests and set as available.
     * 
     * You should call stop before shutting down so that clients dont
     * try to request this worker any more.
     * 
     * Resolves without any value when done successful.
     * Rejects with an error when anything went wrong.
     */
    listen() {
        return new Promise((resolve, reject) => {
            this._log(this.levels.info, 'LISTEN', 'Starting to listen for requestts.');
            this.isListening = true;
            this.isWorking = false;

            // Create clients for publishing and listening.
            // When subscribed you cannot set keys, but we want to listen before telling the world we are.
            this.subscriber = redis.createClient(this.redisOptions);
            this.publisher = redis.createClient(this.redisOptions);

            // Register listener and start listeing
            this.subscriber.on('message', (_, message) => this._onMessage(message));
            this.subscriber.subscribe(this.workerChannel, async (error, _) => {
                if (error) {
                    this._log(this.levels.error, 'LISTEN', `Error while subscribing to worker channel: ${JSON.stringify(error)}`);
                    return reject(error);
                }

                try {
                    await this._activate();
                    resolve();
                }
                catch (error) {
                    reject(error);
                }
            });
        });
    }

    /**
     * Stop listening to the queue for requests and remove from the availibility set.
     * 
     * Resolves without any value when done successful.
     * Rejects with an error when unsubscribing did not work.
     */
    stop() {
        return new Promise((resolve, reject) => {
            this.isListening = false;
            this.stopPromise = { resolve, reject };
            this._log(this.levels.debug, 'STOP', 'Stop initiated. Decinding how to handle.');

            if (this.isWorking) {
                this._log(this.levels.info, 'STOP', 'Waiting for current task to finish.');
                return;
            }

            // removing the worker from the available ones
            this._log(this.levels.debug, 'STOP', 'Removing from availiblity set.');
            this.publisher.srem(this.availabilitySet, this.id, (error, removed) => {
                if (error) {
                    this._log(this.levels.error, 'STOP', `Error while removing from availiblity set: ${JSON.stringify(error)}`);
                    reject(error);
                }

                // If the key was not in the set, the worker has been chosen while shutting down.
                // We can ignore this since isListening has been set to false, so no new connections
                // should be accepted. Still, logging makes sense.
                else if (!removed)
                    this._log(this.levels.notice, 'STOP', 'Worker has been chosen while shutting down.');

                this._log(this.levels.info, 'STOP', 'Currently indle, closing connections.');
                this._shutdown();
            });
        });
    }

    /**
     * Internal method.
     * unsubscribes form worker channel and stops clients.
     * Uses a promise created by the end method.
     */
    _shutdown() {
        this._log(this.levels.info, 'SHUTDOWN', 'Shutting down now.');
        // unsubscribe from all channels
        this.subscriber.unsubscribe((error, _) => {
            if (error)
                return this.stopPromise.reject(error);

            // Quit both clients to free resources and force if neccessary
            this.subscriber.quit((error, _) => {
                if (error) {
                    this._log(this.levels.warning, 'SHUTDOWN', 'Failed to gracefully close redis connection. Forcing now.');
                    this.subscriber.end(false);
                }
                this.subscriber = undefined;
            });
            this.publisher.quit((error, _) => {
                if (error) {
                    this._log(this.levels.warning, 'SHUTDOWN', 'Failed to gracefully close redis connection. Forcing now.');
                    this.publisher.end(false);
                }
                this.publisher = undefined;
            });

            this.stopPromise.resolve();
            this._log(this.levels.info, 'SHUTDOWN', 'Shutdown complete.');
        });
    }

    /**
     * Internal method.
     * Parses a message and calls the handler.
     * Publishes the result to the corresponding result queue.
     */
    async _onMessage(message) {
        this._log(this.levels.debug, 'MESSAGE', 'Got new message');

        // If shutting down or already working defer message
        if (!this.isListening || this.isWorking) {
            this._log(this.levels.notice, 'MESSAGE', `Will not handle message. isListening:${this.isListening}, isWorking:${this.isWorking}.`);
            return this._deferMessage(message);
        }

        // Parse and handle request
        this.isWorking = true;
        const { id, data } = messages.parseRequest(message);
        const response = await this.handle(data);

        // Respond to client. Ignore if response could not be send as there is not a lot we could do.
        this.publisher.publish(keys.responseChannel(id), messages.composeResponse(id, response), (error, reply) => {
            if (error)
                this._log(this.levels.error, 'MESSAGE', `Cannot send response to client. Message id: ${id}, Error: ${JSON.stringify(error)}.`);

            if (!reply)
                this._log(this.levels.warning, 'MESSAGE', `Response has not been received by client. Message id: ${id}.`);
        });

        this._log(this.levels.debug, 'MESSAGE', `Finished handling message.`)

        // Check if worker was shut down during request
        if (!this.isListening) {
            this._log(this.levels.notice, 'MESSAGE', 'Shutdown has been triggered during work.')
            return this._shutdown();
        }

        this._log(this.levels.debug, 'MESSAGE', 'Reactivating.')
        this.isWorking = false;
        this._activate();
    }

    /**
     * Instead of handling a message, this method sends the message
     * to another worker or puts it into the queue. It is uning a
     * separate redis client, as this might be called during shutdown.
     * @param {The message to defer} message 
     */
    async _deferMessage(message) {
        this._log(this.levels.info, 'DEFER', `Defering message.`);
        const client = redis.createClient(this.redisOptions);
        client.spop(this.availabilitySet, otherWorker => {
            if (!otherWorker) {
                this._log(this.levels.debug, 'DEFER', `Pushing message onto queue.`);
                return client.rpush(this.requestQueue, message, () => {
                    client.end(0);
                });
            }

            this._log(this.levels.debug, 'DEFER', `Sending message to worker '${otherWorker}'.`);
            this.publisher.publish(keys.workerChannel(this.queueName, otherWorker), message, () => {
                client.end(0);
            });
        });
    }

    /**
     * Internal method.
     * Either idles and adds itself to the availiblity set or takes
     * a message from the queue and calles _onMessage.
     * 
     * Rejects with an error if any occured. Resolves otherwise.
     */
    async _activate() {
        return new Promise((resolve, reject) => {

            this._log(this.levels.debug, 'ACTIVATE', 'Activating. Adding to availiblity set.');

            // We need to mark ourself as availible before checking for a message in the 
            // queue. Otherwise a race condition could happen where a message gets put in
            // the queue but without beeing considered by a worker.
            this.publisher.sadd(this.availabilitySet, this.id, (error, _) => {
                if (error) {
                    this._log(this.levels.error, 'ACTIVATE', `Error while adding to availibility set: ${JSON.stringify(error)}`);
                    return reject(error);
                }
                resolve();

                // Check for another queued request
                this._log(this.levels.debug, 'ACTIVATE', 'Checking for queued request.');
                this.publisher.lpop(this.requestQueue, (_, message) => {
                    if (message) {
                        this._log(this.levels.debug, 'ACTIVATE', 'Found queued request. Handling immediately.');
                        this._onMessage(message);

                        this._log(this.levels.debug, 'ACTIVATE', 'Removing from availibility set.');
                        this.publisher.srem(this.availabilitySet, this.id, (_, removed) => {
                            if (!removed)
                                // This means that the worker has been chosen while looking for a
                                // message in the queue. One of the messages will be deferred to
                                // a different worker. If this happens to often, it might result
                                // in bad performance.
                                this._log(this.levels.notice, 'ACTIVATE', 'Could not remove from availiblity set.');
                        });
                        return;
                    }
                    this._log(this.levels.debug, 'ACTIVATE', 'No queued message found. Idling.');
                });
            });

        });
    }

    /**
     * Internal method.
     * Regualry checks is this worker is somehow not working but not
     * inside the avaialbility set.
     */
    async _healthLoop() {
        this._log(this.logger.debug, 'HEALTH', 'Running health loop.');

        // Stop loop when client is not active anymore
        if (!this.isListening) {
            this._log(this.levels.debug, 'HEALTH', 'Stopping health loop. Worker not listening any more.');
            return;
        }

        // Queue next run
        setTimeout(() => this._healthLoop(), HEALTH_CYCLE * 1000);

        // Dont do anything when is working
        if (this.isWorking)
            return;

        // Check if this worker is in the availibility set
        this.publisher.sismember(this.availabilitySet, this.id, (isMemeber) => {
            if (isMemeber)
                return;

            // This can happen either when a client removes the worker from
            // the avilibility set and fails the contact the worker or the
            // worker was not able to put itself into the availibility set
            // after doing work. Its not a big problem, but means that the
            // worker was useless for some time.
            this._log(this.levels.warning, 'HEALTH', 'Worker is not running but also not marked as available');
            this._activate();
        })
    }

    _log(level, scope, message) {
        this.logger(level, `[WORKER][${this.id}][${scope}] ${message}`);
    }
}