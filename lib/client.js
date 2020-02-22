const redis = require("redis");
const keys = require('./keys');
const messages = require('./messages');
const uniqid = require('uniqid');

const defaultOptions = {
    namespace: 'rrb',
    timeout: 1000
}

module.exports = class Client {
    constructor(queue, options) {
        this.queue = queue;

        const o = Object.assign({ ...defaultOptions }, options);
        this.namespace = o.namespace;
        this.timeout = o.timeout;

        this.availabilitySet = keys.availabilitySet(this.namespace, queue);
        this.requestQueue = keys.requestQueue(this.namespace, queue);
    }

    /**
     * Connects the client to the redis. This needs to be called before doing a request.
     * You should consider calling disconnect when done using the worker to free up recources.
     * 
     * Resolves without a value when connected successful.
     * Rejects with an error when something went wrong.
     */
    connect() {
        return new Promise(async (resolve, _) => {
            // Create clients
            this.publisher = redis.createClient();
            resolve();
        });
    }

    /**
     * Disconnects the client from the redis.
     */
    disconnect() {
        if (!this.publisher)
            return Promise.reject(new Error('Client not connected'));

        return new Promise((resolve, reject) => {
            this.publisher.quit((error, reply) => {
                // Force quit on error
                if (error) {
                    this.publisher.end(flase);
                    this.publisher = undefined;
                    return reject(error);
                }

                this.publisher = undefined;
                resolve();
            });
        });
    }

    /**
     * Sends a request to a worker.
     * 
     * Resolves with the result if everything went well.
     * Rejects with an error otherwise.
     * @param {The data to send to the worker} data 
     */
    request(data) {
        if (!this.publisher)
            return Promise.reject(new Error('Client not connected'));

        return new Promise(async (resolve, reject) => {

            // Timeout
            let completed = false;
            setTimeout(() => {
                if (completed)
                    return;

                completed = true;
                requestClient.end(false);
                reject(new Error("Request timed out"));
            }, this.timeout);

            // Create new client for this request.
            // Reusing a client could cause race conditions.
            const requestClient = redis.createClient();
            while (!completed) {
                try {
                    const response = await this._getDataFromWorker(data, requestClient);
                    if (completed)
                        return;

                    completed = true;
                    resolve(response);
                }
                catch (error) {
                    if (completed)
                        return;

                    // Retry when we cannot reach a worker
                    if (error.message === 'Could not reach worker')
                        continue;

                    // Other errors should me the request fail
                    completed = true;
                    reject(error);
                }
            }

            requestClient.end(false);
        });
    }

    /**
     * Internal method.
     * Tries to get data from a worker.
     * 
     * Resolves with the result if it worked.
     * Rejects with an error otherwise.
     * @param {The data to send to the worker} data 
     * @param {The client to use} requestClient 
     */
    async _getDataFromWorker(data, requestClient) {
        return new Promise((resolve, reject) => {
            // Get a worker from the availability set
            this.publisher.spop(this.availabilitySet, (error, requestWorker) => {
                if (error)
                    return reject(error);

                const requestId = uniqid();

                const listener = (_, message) => {
                    const { response } = messages.parseResponse(message);
                    resolve(response);
                };

                // Register response handler
                // requestClient.removeAllListeners('message');
                requestClient.once('message', listener);
                requestClient.subscribe(keys.responseChannel(this.namespace, requestId), _ => {

                    const requestMessage = messages.composeRequest(requestId, data)

                    // Queue if no worker availible now
                    if (!requestWorker)
                        return this.publisher.rpush(this.requestQueue, requestMessage);

                    // Start request otherwise 
                    const workerChannel = keys.workerChannel(this.namespace, this.queue, requestWorker);
                    this.publisher.publish(workerChannel, requestMessage, (error, received) => {
                        if (received > 0)
                            return;

                        // If request did not work, remove the event listener and reject
                        requestClient.off('message', listener);
                        reject(error || new Error('Could not reach worker'));
                    });
                });
            });

        });
    }
}