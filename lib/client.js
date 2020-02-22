const redis = require("redis");
const uniqid = require('uniqid');

const keys = require('./keys');
const messages = require('./messages');
const logging = require('./logging');

const defaultOptions = {
    namespace: 'rrb',
    timeout: 1000,
    logger: logging.defaulLogger,
    levels: logging.levels
}

module.exports = class Client {
    constructor(queue, options) {
        this.queue = queue;
        this.id = uniqid();

        const o = Object.assign({ ...defaultOptions }, options);
        this.namespace = o.namespace;
        this.timeout = o.timeout;
        this.logger = o.logger;
        this.levels = o.levels;

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
            this._log(this.levels.info, 'CONNECT', 'Connecting to redis.');
            // Create clients
            this.publisher = redis.createClient();
            resolve();
        });
    }

    /**
     * Disconnects the client from the redis.
     */
    disconnect() {
        return new Promise((resolve, reject) => {
            if (!this.publisher) {
                this._log(this.levels.warning, 'DISCONNECT', 'Tried to disconnect a client that is not connected.');
                return reject(new Error('Client not connected'));
            }

            this._log(this.levels.info, 'DISCONNECT', 'Disconnecting from redis.');
            this.publisher.quit((error, _) => {
                // Force quit on error
                if (error) {
                    this._log(this.levels.warning, 'DISCONNECT', 'Failed to gracefully close redis connection. Forcing now.');
                    this.publisher.end(false);
                    reject(error);
                }

                this.publisher = undefined;
                resolve();
                this._log(this.levels.info, 'DISCONNECT', 'Disconnecting complete.');
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
        return new Promise(async (resolve, reject) => {
            if (!this.publisher) {
                this._log(this.levels.warning, 'REQUEST', 'Tried requesting on a client that is not connected.');
                return reject(new Error('Client not connected'));
            }

            this._log(this.levels.debug, 'REQUEST', 'Starting new request.');

            // Set timer for timeout
            let completed = false;
            setTimeout(() => {
                if (completed)
                    return;

                this._log(this.levels.info, 'REQUEST', 'Request timed out.');

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
                    if (completed) {
                        this._log(this.levels.debug, 'REQUEST', 'Ignoring response as request has timed out.');
                        return;
                    }

                    completed = true;
                    resolve(response);
                    this._log(this.levels.debug, 'REQUEST', 'Request completed successfully.');
                }
                catch (error) {
                    if (completed)
                        return;

                    // Retry when we cannot reach a worker
                    if (error.message === 'Could not reach worker') {
                        this._log(this.levels.info, 'REQUEST', 'Retrying failed requst.');
                        continue;
                    }

                    // Other errors should let the request fail
                    completed = true;
                    this._log(this.levels.error, 'REQUEST', `Request failed with unknown error: ${JSON.stringify(error)}.`);
                    reject(error);
                }
            }

            requestClient.end(false);
            this._log(this.levels.debug, 'REQUEST', 'Request handling complete.');
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
            this._log(this.levels.debug, 'GET_DATA', 'Trying to get data from woker.');
            // Get a worker from the availability set
            this.publisher.spop(this.availabilitySet, (error, requestWorker) => {
                if (error) {
                    this._log(this.levels.error, 'GET_DATA', `Failed to get available worker: ${JSON.stringify(error)}`);
                    return reject(error);
                }

                const requestId = uniqid();
                this._log(this.levels.debug, 'GET_DATA', `Request id: ${requestId}.`);

                const listener = (_, message) => {
                    this._log(this.levels.debug, 'GET_DATA', 'Got response from worker.');
                    const { response } = messages.parseResponse(message);
                    resolve(response);
                };

                // Register response handler
                requestClient.once('message', listener);
                requestClient.subscribe(keys.responseChannel(this.namespace, requestId), error => {

                    if (error) {
                        requestClient.off('message', listener);
                        this._log(this.levels.error, 'GET_DATA', `Failed to subscribe to response channel: ${JSON.stringify(error)}`);
                        return reject(error);
                    }

                    const requestMessage = messages.composeRequest(requestId, data)

                    // Queue if no worker availible now
                    if (!requestWorker) {
                        this._log(this.levels.debug, 'GET_DATA', 'Pushing request to queue.');
                        return this.publisher.rpush(this.requestQueue, requestMessage);
                    }

                    // Start request otherwise 
                    const workerChannel = keys.workerChannel(this.namespace, this.queue, requestWorker);
                    this.publisher.publish(workerChannel, requestMessage, (error, received) => {
                        // All good, if the worker received the request
                        if (received > 0)
                            return;

                        // Otherwise something happened. If there is no error, the worker probably
                        // crashed or got forcefully shutdown. In that case we should try to reach 
                        // another worker. If there was an error there is probably something wrong
                        // with the redis connection so we want to reject the request.                        
                        if (error) {
                            this._log(this.levels.error, 'GET_DATA', `Failed to publish request message: ${error}`);
                            reject(error);
                        }
                        else {
                            this._log(this.levels.notice, 'GET_DATA', 'Could not reach worker.');
                            reject(new Error('Could not reach worker'));
                        }
                        // In any case, we wont receive a response so we remove the event listener
                        requestClient.off('message', listener);
                    });
                });
            });

        });
    }

    _log(level, scope, message) {
        this.logger(level, `[CLIENT][${this.id}][${scope}] ${message}`);
    }
}