const redis = require("handy-redis");
const uniqid = require('uniqid');
const { serializeError } = require('serialize-error');

const keys = require('./keys');
const messages = require('./messages');
const defaults = require('./defaults');
const runningRequests = require('./runningRequests');

module.exports = class Client {

    /**
     * A client that can send requests to workers and returns the result.
     * Multiple requests at the same time are possible.
     * 
     * @param queue The queue in which to put the requests.
     * @param options Advanced options to configure the client. Available options are:
     * 
     *  - redis
     *  - timeout
     *  - logger
     *  - levels
     *  
     *  See `defaults` for more details on these options.
     */
    constructor(queue, options) {
        this.queue = queue;
        this.id = uniqid();

        const o = defaults.apply(options);
        this.timeout = o.timeout;
        this.logger = o.logger;
        this.levels = o.levels;
        this.redisOptions = o.redis;
        this.prefix = this.redisOptions ? this.redisOptions.prefix || '' : '';

        this.requestQueue = keys.requestQueue(queue);
        this.requestChannel = keys.requestChannel(queue, this.prefix);
        this.shuttingDown = false; // Keeps track of the shuttdown process, as running requests have to finish
        this.runningRequests = runningRequests(this.timeout);

        this._log(this.levels.debug, 'constructor', `Initialized new client.`);
        this._log(this.levels.debug, 'constructor', `Request queue: '${this.requestQueue}'.`);
        this._log(this.levels.debug, 'constructor', `Request channel: '${this.requestChannel}'.`);
    }

    /**
     * Connects the client to the redis. This needs to be called before doing a request.
     * You should consider calling disconnect when done using the worker to free up recources.
     * 
     * Resolves without a value when connected successful.
     * Rejects with an error when something went wrong.
     */
    async connect() {
        this.shuttingDown = false;
        this._log(this.levels.info, 'connect', 'Connecting to redis.');
        this.publisher = redis.createHandyClient(this.redisOptions);
    }

    /**
     * Disconnects the client from redis.
     */
    async disconnect() {
        // If not connected, do nothing
        if (!this.publisher)
            return;

        this.shuttingDown = true;
        this._log(this.levels.info, 'disconnect', 'Disconnecting from redis.');

        if (this.runningRequests.hasRunning()) {
            // Wait for all request to finish
            this._log(this.levels.debug, 'disconnect', 'Waiting for requests to finish.');
            await this.runningRequests.await();
        }

        try {
            await this.publisher.quit();
        }
        catch (error) {
            this._log(this.levels.warning, 'disconnect', 'Failed to close redis connection. Trying to force.');
            this.publisher.redis.end(false);
            throw error;
        }
        finally {
            this.publisher = undefined;
        }

        this._log(this.levels.info, 'disconnect', 'Disconnecting complete.');

    }

    /**
     * Sends a request to a worker.
     * 
     * Resolves with the result if everything went well.
     * Rejects with an error otherwise.
     * 
     * If the worker rejects the request, the error will be
     * transmitted and this method call will be rejected with
     * the error provided by the worker.
     * @param {The data to send to the worker} data 
     */
    async request(data) {
        if (!this.publisher) {
            this._log(this.levels.info, 'request', 'Tried requesting on a client that is not connected.');
            return reject(new Error('Client not connected'));
        }

        if (this.shuttingDown) {
            this._log(this.levels.info, 'request', 'Tried requesting on a client that is shutting down.');
            return reject(new Error('Client currently shutting down'));
        }

        const requestId = uniqid();
        const requestClient = redis.createHandyClient(this.redisOptions);
        this.runningRequests.add(requestId);
        let response;
        try {
            response = await this._getDataFromWorker(data, requestId, requestClient);
        }
        catch (error) {
            this._log(this.levels.error, 'request', `Request '${requestId}' failed with unknown error: ${JSON.stringify(serializeError(error))}.`);
            throw error;
        }
        finally {
            this.runningRequests.finish(requestId);
            requestClient.quit();
        }

        this._log(this.levels.debug, 'request', `Request '${requestId}' completed successfully.`);
        if (response.ok)
            return response.response;
        else
            throw response.error;
    }

    /**
     * Internal method.
     * Tries to get data from a worker.
     * 
     * Resolves with the result if it worked.
     * Rejects with an error otherwise.
     * @param {object} data The data to send to the worker
     */
    async _getDataFromWorker(data, requestId, requestClient) {
        return new Promise(async (resolve, reject) => {
            this._log(this.levels.debug, 'get_data', `Trying to get data from woker. Request id: ${requestId}`);

            // Set timer for timeout
            const timeout = setTimeout(() => {
                this._log(this.levels.info, 'get_data', `Request '${requestId}' timed out.`);
                reject(new Error("Request timed out"));
            }, this.timeout);

            // Register the listener
            requestClient.redis.once('message', (_, message) => {
                this._log(this.levels.debug, 'get_data', 'Got response from worker.');
                clearTimeout(timeout);
                try {
                    resolve(messages.parseResponse(message));
                }
                catch (error) {
                    this._log(this.levels.warning, 'get_data', `Failed to parse worker response: ${message}`);
                    reject(error);
                }
            });

            // Push the request to the request queue and notify worker
            try {
                await requestClient.subscribe(keys.responseChannel(requestId, this.prefix));
                await this.publisher.rpush(this.requestQueue, messages.composeRequest(requestId, data));
                await this.notifyWorkers(requestId, requestClient);
            }
            catch (error) {
                this._log(this.levels.error, 'get_data', `Failed to publish request ${requestId}: ${error.message}`);
                clearTimeout(timeout);
                return reject(error);
            }
        });
    }

    async notifyWorkers() {
        const received = await this.publisher.publish(this.requestChannel, '');

        // All good, a worker received the request
        if (received > 0)
            return;

        // It's highly unlikely that a worker will be started up so we let the request fail
        this._log(this.levels.notice, 'notify', `There is no active worker. Waiting until timeout`);
    }

    _log(level, scope, message) {
        this.logger(level, message, 'client', this.id, scope);
    }


}