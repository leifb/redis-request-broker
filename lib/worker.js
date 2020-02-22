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
            this.subscriber.on('message', (channel, message) => this._onMessage(channel, message));
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

            // Start by removing the worker from the available ones
            this.publisher.srem(this.availabilitySet, this.id, (error, removed) => {
                if (error)
                    reject(error);

                // If the key was not in the set, the worker is probably working
                // Or there is a request incoming. Let the worker finish. 
                if (!removed)
                    return;

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
    async _onMessage(_, message, isConsecutive = false) {

        // If already working defer message
        if (this.isWorking && !isConsecutive) {
            this.publisher.spop(this.availabilitySet, otherWorker => {
                if (!otherWorker)
                    return this.publisher.rpush(this.requestQueue, message);

                this.publisher.publish(keys.workerChannel(this.namespace, this.queueName, otherWorker), message);
            });
            return;
        }

        // Parse and handle request
        this.isWorking = true;
        const { id, data } = messages.parseRequest(message);
        const response = await this.handle(data);

        // Respond to client. Ignore if response could not be send as there is not a lot we could do.
        this.publisher.publish(keys.responseChannel(this.namespace, id), messages.composeResponse(id, response), (error, reply) => {
            if (error) {
                console.error("ERROR: Cannot send response!");
                console.error({ id, data, error, reply });
            }
        });

        // Check if worker was shut down during request
        if (!this.isListening)
            return this._shutdown();

        // Check for another queued request
        this.publisher.lpop(this.requestQueue, (error, message) => {
            if (message)
                return this._onMessage(null, message, true);

            // No queued message, so wait unitl next request
            this.publisher.sadd(this.availabilitySet, this.id);
            this.isWorking = false;
        });
    }

    /**
     * Internal method.
     * Regualry checks is this worker is somehow not working but not
     * inside the avaialbility set.
     */
    async _healthLoop() {
        // Stop loop when client is not active anymore
        if (!this.isListening)
            return;

        // Queue next run
        setTimeout(() => this._healthLoop(), HEALTH_CYCLE * 1000);

        // Dont do anything when is working
        if (this.isWorking)
            return;

        // Check if this worker is in the availibility set
        this.publisher.sismember(this.availabilitySet, this.id, (isMemeber) => {
            if (isMemeber)
                return;

            console.log(`Warning: Worker not running but also not in availibility set`);
            this.publisher.sadd(this.availabilitySet, this.id);
        })
    }
}