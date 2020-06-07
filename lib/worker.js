const redis = require("handy-redis");
const uniqid = require('uniqid');

const keys = require('./keys');
const messages = require('./messages');
const defaults = require('./defaults');

module.exports = class Worker {

    /**
     * A worker that takes requests from clients, perfoms an action and returns a result.
     * 
     * @param queue The queue to listen on.
     * @param handle The method that will be called when receiving requests.
     *   It should return a promise that resolves to the result. If it rejects,
     *   the error provided will be transmitted to the client where the request
     *   will be rejected with the same error.
     * @param options Advanced options to configure the worker. Available options are:
     * 
     *  - redis
     *  - logger
     *  - levels
     *  
     *  See `defaults` for more details on these options.
     */
    constructor(queue, handle, options) {
        this.id = uniqid();
        this.handle = handle;
        this.queueName = queue;
        const o = defaults.apply(options);
        this.logger = o.logger;
        this.levels = o.levels;
        this.redisOptions = o.redis;

        // Build queue names
        this.requestQueue = keys.requestQueue(queue);
        this.requestChannel = keys.requestChannel(queue);

        this._log(this.levels.debug, 'constructor', `Initialized new worker.`);
        this._log(this.levels.debug, 'constructor', `Request queue: '${this.requestQueue}'.`);
        this._log(this.levels.debug, 'constructor', `Request channel: '${this.requestChannel}'.`);
    }

    /**
     * Start listening to the request channel for requests.
     * 
     * You should call stop before shutting down so that cleanup
     * can be done.
     * 
     * Resolves without any value when done successful.
     * Rejects with an error when anything went wrong.
     */
    async listen() {
        this._log(this.levels.info, 'listen', 'Starting to listen for requestts.');
        this.isListening = true;
        this.isWorking = false;

        // Create clients for publishing and listening.
        // Redis does not allow interacting with the pub sub system while doing anything else
        // So the subscriber is there to listen to the request channel, while the publisher
        // is interacting with everything else.
        this.subscriber = redis.createHandyClient(this.redisOptions);
        this.publisher = redis.createHandyClient(this.redisOptions);

        // Register listener and start listeing
        this.subscriber.redis.on('message', (_, message) => this._onMessage(message));
        try {
            await this.subscriber.subscribe(this.requestChannel);
            await this._checkQueue();
        }
        catch (error) {
            this._log(this.levels.error, 'listen', `Cannot listen for requests: ${JSON.stringify(error)}`);
            throw error;
        }
    }

    /**
     * Stop listening to the request queue and do some cleanup.
     * 
     * Resolves without any value when done successful.
     * Rejects with an error when unsubscribing did not work.
     */
    async stop() {
        return new Promise(async (resolve, reject) => {
            // Don't do anything if not listening
            if (!this.isListening)
                return resolve();

            this.isListening = false; // This flag is used to stop after handling a message
            this.stopPromise = { resolve, reject };
            this._log(this.levels.debug, 'stop', 'Stop initiated. Unsubscribing from request channel.');

            // Unsubscribe from request channel to stop receiving requests
            try {
                await this.subscriber.unsubscribe(this.requestChannel);
            }
            catch (error) {
                this._log(this.levels.warning, 'stop', 'Failed to unsubscribe from request channel. Trying to continue with shutdown.');
            }

            if (this.isWorking) {
                this._log(this.levels.info, 'stop', 'Waiting for current task to finish.');
                return;
            }

            this._shutdown();
        });
    }

    /**
     * Internal method.
     * Stops all redis clients.
     * Uses a promise created by the stop method.
     */
    async _shutdown() {
        this._log(this.levels.info, 'shutdown', 'Shutting down now.');

        // Quit publisher
        try {
            await this.publisher.quit();
            await this.subscriber.quit();
        }
        catch (error) {
            this._log(this.levels.warning, 'shutdown', 'Failed to gracefully close redis connection. Forcing now.');
            this.publisher.redis.end(false);
            this.subscriber.redis.end(false);
        }
        finally {
            this.publisher = undefined;
            this.subscriber = undefined;
            this.stopPromise.resolve();
            this._log(this.levels.info, 'shutdown', 'Shutdown complete.');
        }
    }

    /**
     * Internal method.
     * Gets called, when there is a request in the request queue.
     * Tries to get the request and then handles it.
     * Publishes the result to the corresponding result queue.
     */
    async _onMessage() {
        this._log(this.levels.debug, 'message', 'Got new request');

        // If shutting down or already working ignore the message
        if (!this.isListening || this.isWorking)
            return this._log(this.levels.debug, 'message', `Will not handle request. isListening:${this.isListening}, isWorking:${this.isWorking}.`);

        // Try to get the request
        this.isWorking = true;
        try {
            const message = await this.publisher.lpop(this.requestQueue);

            // If there is no message, somebody else got it
            if (!message) {
                this._log(this.levels.debug, 'message', 'No queued message found. Idling.');
                return;
            }

            // Parse and handle request
            const { id, data } = messages.parseRequest(message);
            const responseMessage = await this._handleMessage(id, data);

            try {
                const received = await this.publisher.publish(keys.responseChannel(id), responseMessage);
                if (!received)
                    this._log(this.levels.warning, 'message', `Response has not been received by client. Message id: ${id}.`);
            } catch (error) {
                this._log(this.levels.error, 'message', `Cannot send response to client. Message id: ${id}, Error: ${JSON.stringify(error)}.`);
            }

            this._log(this.levels.debug, 'message', `Finished handling message.`);

            // Check if worker was shut down during request
            if (!this.isListening) {
                this._log(this.levels.notice, 'message', 'Shutdown has been triggered during work.')
                return this._shutdown();
            }
        }
        catch (error) {
            this._log(this.levels.warning, 'message', `Unknown error during message handling: ${error.message}`);
        }
        finally {
            this.isWorking = false;
            if (this.isListening)
                await this._checkQueue();
        }
    }

    /**
     * Calls the provided handle method and returns either an
     * error response or a normal one.
     * @param {*} data 
     */
    async _handleMessage(id, data) {
        let response;
        let responseError = null;
        try {
            response = await this.handle(data);
        }
        catch (error) {
            responseError = error;
        }

        return responseError
            ? messages.composeError(id, responseError)
            : messages.composeResponse(id, response);
    }

    /**
     * Internal method.
     * Checks weather there is a waiting request and queus to handle it if so.
     * 
     * Rejects with an error if any occured. Resolves otherwise.
     */
    async _checkQueue() {
        this._log(this.levels.debug, 'check_queue', 'Checking request queue for open requests.');

        try {
            const hasRequests = await this.publisher.llen(this.requestQueue);
            if (this.isWorking || !hasRequests)
                return;

            this._onMessage();
        }
        catch (error) {
            this._log(this.levels.warning, 'check_queue', 'Failed to check request queue. Requests may time out.');
        }
    }

    _log(level, scope, message) {
        this.logger(level, message, new Date(), 'worker', this.id, scope);
    }
}