const redis = require("redis");
const keys = require('./keys');
const messages = require('./messages');
const uniqid = require('uniqid');

const HEALTH_CYCLE = 120;

const defaultOptions = {
    namespace: 'rrb'
};

/**
 * A worker that takes requests from clients, perfoms an action and returns a result. 
 */
module.exports = class Worker {
    constructor(queue, handle, options) {
        this.id = uniqid();
        this.handle = handle;
        this.queueName = queue;

        const o = Object.assign({ ...defaultOptions }, options);
        this.namespace = o.namespace;

        // Build queue names
        this.availabilitySet = keys.availabilitySet(this.namespace, queue);
        this.workerChannel = keys.workerChannel(this.namespace, queue, this.id);
        this.requestQueue = keys.requestQueue(this.namespace, queue);
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
            this.isListening = true;
            this.isWorking = false;

            // Create clients for publishing and listening.
            // When subscribed you cannot set keys, but we want to listen before telling the world we are.
            this.subscriber = redis.createClient();
            this.publisher = redis.createClient();

            // Register listener and start listeing
            this.subscriber.on('message', (_, message) => this._onMessage(message));
            this.subscriber.subscribe(this.workerChannel, (error, _) => {
                if (error)
                    return reject(error);

                this.publisher.sadd(this.availabilitySet, this.id, (error, added) => {
                    if (!added || error)
                        return reject('could not add worker to availibility set');
                    resolve();
                });
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
            this.log('STOP', 'Stop initiated. Decinding how to handle.');

            if (this.isWorking) {
                this.log('STOP', '> Waiting for current task to finish.');
                return;
            }

            // removing the worker from the available ones
            this.log('STOP', '> Removing from availiblity set.');
            this.publisher.srem(this.availabilitySet, this.id, (error, removed) => {
                if (error) {
                    this.log('STOP', '> Error while removing from availiblity set. Panicing.');
                    this.stopPromise = undefined;
                    return reject(error);
                }

                // If the key was not in the set, the worker has been chosen while shutting down.
                // We can ignore this since isListening has been set to false, so no new connections
                // should be accepted. Still, logging makes sense.
                if (!removed)
                    this.log('STOP', '> Worker has been chosen while shutting down.');

                this.log('STOP', '> Triggering shutdown.');
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
        this.log('SHUTDOWN', 'Shutting down now.');
        // unsubscribe from all channels
        this.subscriber.unsubscribe((error, _) => {
            if (error)
                return this.stopPromise.reject(error);

            // Quit both clients to free resources and force if neccessary
            this.subscriber.quit((error, _) => {
                if (error)
                    this.subscriber.end();
                this.subscriber = undefined;
            });
            this.publisher.quit((error, _) => {
                if (error)
                    this.publisher.end();
                this.publisher = undefined;
            });

            this.stopPromise.resolve();
        });
    }

    /**
     * Internal method.
     * Parses a message and calls the handler.
     * Publishes the result to the corresponding result queue.
     */
    async _onMessage(message) {
        this.log('MESSAGE', 'Got new message');

        // If shutting down or already working defer message
        if (!this.isListening || this.isWorking) {
            this.log('MESSAGE', `> Will not handle message. isListening:${this.isListening}, isWorking:${this.isWorking}.`);
            return this._deferMessage(message);
        }

        // Parse and handle request
        this.isWorking = true;
        const { id, data } = messages.parseRequest(message);
        const response = await this.handle(data);

        // Respond to client. Ignore if response could not be send as there is not a lot we could do.
        this.publisher.publish(keys.responseChannel(this.namespace, id), messages.composeResponse(id, response), (error, reply) => {
            if (error) {
                this.log('MESSAGE', `> Error: Cannot send response.`);
                console.error({ id, data, error, reply });
            }
        });

        this.log('MESSAGE', `> Finished handling message.`)

        // Check if worker was shut down during request
        if (!this.isListening) {
            this.log('MESSAGE', '> Worker has been shut down during work. Running _shutdown not.')
            return this._shutdown();
        }

        this.log('MESSAGE', '> Reactivating.')
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
        this.log('DEFER', `Defering message.`);
        const client = redis.createClient();
        client.spop(this.availabilitySet, otherWorker => {
            if (!otherWorker) {
                this.log('DEFER', `> Pushing message onto queue.`);
                return client.rpush(this.requestQueue, message, () => {
                    client.end(0);
                });
            }

            this.log('DEFER', `> Sending message to worker '${otherWorker}'.`);
            this.publisher.publish(keys.workerChannel(this.namespace, this.queueName, otherWorker), message, () => {
                client.end(0);
            });
        });
    }

    /**
     * Internal method.
     * Either idles and adds itself to the availiblity set or takes
     * a message from the queue and calles _onMessage.
     */
    async _activate() {
        this.log('ACTIVATE', 'Activating. Adding to availiblity set.');

        // We need to mark ourself as availible before checking for a message in the 
        // queue. Otherwise a race condition could happen where a message gets put in
        // the queue but without beeing considered by a worker.
        this.publisher.sadd(this.availabilitySet, this.id, (error, _) => {
            if (error) {
                this.log('ACTIVATE', '> Error while adding to availibility set.');
                return;
            }

            // Check for another queued request
            this.log('ACTIVATE', '> Checking for queued request.');
            this.publisher.lpop(this.requestQueue, (_, message) => {
                if (message) {
                    this.log('ACTIVATE', '> Found queued request. Handling immediately.');
                    this._onMessage(message);

                    this.log('ACTIVATE', '> Removing from availibility set.');
                    this.publisher.srem(this.availabilitySet, this.id, (_, removed) => {
                        if (!removed)
                            // This means that the worker has been chosen while looking for a
                            // message in the queue. One of the messages will be defferred to
                            // a different worker. If this happens to often, it might result
                            // in bad performance.
                            this.log('ACTIVATE', '> Could not remove from availiblity set.');
                    });
                    return;
                }
                this.log('ACTIVATE', '> No queued message found. Idling.');
            });
        });

    }

    /**
     * Internal method.
     * Regualry checks is this worker is somehow not working but not
     * inside the avaialbility set.
     */
    async _healthLoop() {
        this.log('HEALTH', 'Running health loop.');

        // Stop loop when client is not active anymore
        if (!this.isListening) {
            this.log('HEALTH', 'Stopping health loop. Worker not listening any more.');
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
            this.log('HEALTH', 'Warning: Worker not running but also not in availibility set');
            this.publisher.sadd(this.availabilitySet, this.id);
        })
    }

    log(scope, message) {
        return;
        console.log(`[WORKER][${this.id}][${scope}] ${message}`);
    }
}