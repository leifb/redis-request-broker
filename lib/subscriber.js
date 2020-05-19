const redis = require("redis");
const uniqid = require('uniqid');

const keys = require('./keys');
const messages = require('./messages');
const defaults = require('./defaults');

const HEALTH_CYCLE = 120;

module.exports = class Subscriber {

    /**
     * A subscriber that listens to a channel perfoms an action when messages
     * get published by a publisher.
     * 
     * @param channelName The name of the channel to listen to.
     * @param handle The method that will be called when receiving requests.
     *   Returning any value does not have an effect, neither does rejecting
     *   or resolving a promise.
     * @param options Advanced options to configure the worker. Available options are:
     * 
     *  - redis
     *  - logger
     *  - levels
     *  
     *  See `defaults` for more details on these options.
     */
    constructor(channelName, handle, options) {
        this.id = uniqid();
        this.handle = handle;
        this.channelName = channelName;
        const o = defaults.apply(options);
        this.logger = o.logger;
        this.levels = o.levels;
        this.redisOptions = o.redis;

        this.channel = keys.pubSubChannel(this.channelName);

        this._log(this.levels.debug, 'CONSTRUCTOR', `Initialized new subscriber.`);
        this._log(this.levels.debug, 'CONSTRUCTOR', `Channel: '${this.channelName}'.`);
    }

    /**
     * Start listening to the channel for messages.
     * 
     * You should call stop before shutting down for propper clean-up.
     * 
     * Resolves without any value when done successful.
     * Rejects with an error when anything went wrong.
     */
    listen() {
        return new Promise((resolve, reject) => {
            if (this.isListening) {
                this._log(this.levels.info, 'LISTEN', 'Tried to start a subscriber that is already listeing.');
                return reject(new Error('Subscriber already listening.'));
            }

            this._log(this.levels.info, 'LISTEN', 'Starting to listen for messages.');
            this.isListening = true;

            // Create clients for publishing and listening.
            // When subscribed you cannot set keys, but we want to listen before telling the world we are.
            this.subscriber = redis.createClient(this.redisOptions);

            // Register listener and start listeing
            this.subscriber.on('message', (_, message) => this._onMessage(message));
            this.subscriber.subscribe(this.channel, async (error, _) => {
                if (error) {
                    this._log(this.levels.error, 'LISTEN', `Error while subscribing to channel: ${JSON.stringify(error)}`);
                    return reject(error);
                }

                resolve();
            });
        });
    }

    /**
     * Stop listening to the channel for messages.
     * 
     * Resolves without any value when done successful.
     * Rejects with an error when something did not work.
     */
    stop() {
        return new Promise((resolve, reject) => {
            if (!this.isListening) // That's ok
                return resolve();

            this.isListening = false;
            this._log(this.levels.debug, 'STOP', 'Stop initiated. closing connections.');

            // unsubscribe from all channels
            this.subscriber.unsubscribe((error, _) => {
                if (error)
                    return reject(error);

                // Quit client to free resources and force if neccessary
                this.subscriber.quit((error, _) => {
                    if (error) {
                        this._log(this.levels.warning, 'STOP', 'Failed to gracefully close redis connection. Forcing now.');
                        this.subscriber.end(false);
                    }
                    this.subscriber = undefined;
                    this._log(this.levels.info, 'STOP', 'Shutdown complete.');
                    resolve();
                });
            });
        });
    }

    /**
     * Internal method.
     * Parses a message and calls the handler.
     * Publishes the result to the corresponding result queue.
     */
    async _onMessage(m) {
        this._log(this.levels.debug, 'MESSAGE', `Got new message`, m);

        // Parse and handle request
        const { id, message } = messages.parsePubSubMessage(m);
        try {
            const returnValue = this.handle(message);
            // Turn non promise values into a promise
            await Promise.resolve(returnValue);
        }
        catch (error) {
            this._log(this.levels.warning, 'MESSAGE', `Message handler threw an error: ${JSON.stringify(error)}. Message id: '${id}'`);
        }

        this._log(this.levels.debug, 'MESSAGE', `Finished handling message '${id}'`);
    }

    /**
     * Internal method.
     * Regualry makes sure that the redis connection is working.
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

        // Re subscribe to queue. You cannot really cheack, weather the connection is still
        // valid, so we just re-subscribe.
        this.subscriber.subscribe(this.channel, async (error, _) => {
            if (error)
                this._log(this.levels.error, 'HEALTH', `Error while subscribing to channel: ${JSON.stringify(error)}`);
        });
    }

    _log(level, scope, message) {
        this.logger(level, `[SUBSCRIBER][${this.id}][${scope}] ${message}`);
    }
}