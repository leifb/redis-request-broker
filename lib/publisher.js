const redis = require("redis");
const uniqid = require('uniqid');

const keys = require('./keys');
const messages = require('./messages');
const defaults = require('./defaults');

module.exports = class Publisher {

    /**
     * A publisher that publishes messages to all subscribers that listen to the corresponding channel.
     * 
     * @param channelName The channel on which to publisher the messages.
     * @param options Advanced options to configure the publisher. Available options are:
     * 
     *  - redis
     *  - logger
     *  - levels
     *  - minimumRecipients
     *  
     *  See `defaults` for more details on these options.
     */
    constructor(channelName, options) {
        this.channelName = channelName;
        this.id = uniqid();

        const o = defaults.apply(options);
        this.logger = o.logger;
        this.levels = o.levels;
        this.redisOptions = o.redis;
        this.minimumRecipients = o.minimumRecipients;

        this.channel = keys.pubSubChannel(channelName);

        this._log(this.levels.debug, 'CONSTRUCTOR', `Initialized new publisher.`);
        this._log(this.levels.debug, 'CONSTRUCTOR', `Pub / Sub Channel: '${this.channel}'.`);
    }

    /**
     * Connects the publisher to the redis. This needs to be called before doing a request.
     * You should consider calling disconnect when done using the publisher to free up recources.
     * 
     * Resolves without a value when connected successful.
     * Rejects with an error when something went wrong.
     */
    connect() {
        return new Promise(async (resolve, reject) => {
            if (this.publisher !== undefined) {
                this._log(this.levels.info, 'CONNECT', 'Tried to connect a publisher that is already connected.');
                return reject(new Error('Publisher already connected.'));
            }

            this._log(this.levels.info, 'CONNECT', 'Connecting to redis.');
            // Create clients
            try {
                this.publisher = redis.createClient(this.redisOptions);
                resolve();
            }
            catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Disconnects the client from the redis.
     */
    disconnect() {
        return new Promise((resolve, reject) => {
            if (!this.publisher) // Not connected
                return resolve();

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
     * Publishes a message to all subscribers
     * 
     * Resolves with the amount of recipients if everything went well.
     * Rejects with an error otherwise.
     * 
     * If the `minimumRecipients` option is set and less subscribers
     * then specified receive the message, the promise  will be rejected.
     * 
     * Subscribers failing to handle the message will not have any effect
     * on the publisher.
     * 
     * @param {The data to send to the subscribers} message 
     */
    publish(message) {
        return new Promise(async (resolve, reject) => {
            if (!this.publisher) {
                this._log(this.levels.info, 'PUBLISH', 'Tried publishing on a publisher that is not connected.');
                return reject(new Error('publisher not connected'));
            }

            const id = uniqid();
            try {
                const m = messages.composePubSubMessage(id, message);
                this._log(this.levels.debug, 'PUBLISH', `Publishing message: ${m}`);
                this.publisher.publish(this.channel, m, (error, received) => {
                    if (error) {
                        this._log(this.levels.error, 'PUBLISH', `Failed to publish message ${id}: ${error}`);
                        return reject(error);
                    }

                    if (received < this.minimumRecipients) {
                        this._log(this.levels.warning, 'PUBLISH', `Message ${id} received by less than specified subscribers (${received}).`);
                        return reject(new Error('Could not reach enough subscribers'));
                    }

                    this._log(this.levels.debug, 'PUBLISH', `Message ${id} published successfully.`);
                    resolve(received);
                });
            }
            catch (error) {
                this._log(this.levels.error, 'PUBLISH', `Publish failed with unknown error: ${JSON.stringify(error)}.`);
                return reject(error);
            }
        });
    }

    _log(level, scope, message) {
        this.logger(level, `[PUBLISHER][${this.id}][${scope}] ${message}`);
    }
}