const logging = require('./logging');

let defaults = {
    redis: { prefix: 'rrb:' },
    timeout: 1000,
    logger: logging.defaulLogger,
    levels: logging.levels,
    minimumRecipients: 0
};

/**
 * Overwrites the default options. Workers and clients created afterwards
 * will use these new default options.
 * @param options An object of options. Available options are:
 *  
 * **redis:** 
 *   
 *   **IMPORTANT:** When overriding you should make sure to set either the `prefix`
 *   or the `db` option or otherwise your keys might get mixed up with other stuff
 *   in the database!
 *  
 *   An object that configures the redis connection. It will be passed
 *   directly to the `createClient` method of the underlying `redis` package. See
 *   The [redis](https://www.npmjs.com/package/redis#options-object-properties) npm
 *   package for more information.
 *   
 *   - The default value is `{ prefix: 'rrb:' }`.
 *   - _Example:_ `{ port: 1234, db: 'myapp' }`
 * 
 * **timeout**: A timeout in ms after which a request fails. For the client that means
 *   when it will stop waiting for a response from a worker and rejects the request.
 *   
 *   - The default value is `1000` ms.
 *   - _Example:_ `{ timeout: 5000 } // five seconds`
 * 
 * **logger**: Allows to inject a custom logger. It has to be a method that takes two
 *   arguments: The logging level and a message. The logging levels are strings by
 *   default, but you can configure them to be whatever you want by using the levels
 *   option.
 * 
 *   - The default logger is writing `error`, `warning` and `notice` logs to the console.
 *   - _Example:_ `{ logger: (level, message) => console.log(message)}`
 * 
 * **levels**: Allows to customize what gets passed into the logger method for logging.
 *   The package uses five different levels: error, warning, notice, info and debug.
 *   
 *   - The default values are the respective strings ('error' for error, etc.) and
 *     are therefore compatible with winston log levels.
 *   - _Example:_ `{ levels: { error: 'e', warning: 'w', notice: 'n', info: 'i', debug: 'd' }}`
 * 
 * **minimumRecipients**: Sets the minimum amount of recipients that should receive 
 *   a published message. Only effects the publisher.
 * 
 *   - The default value is `0`.
 *   - _Example:_ `{ minimumRecipients: 2 }` // At least two subscribers should listen.
 * 
 */
module.exports.setDefaults = function (options) {
    Object.assign(defaults, options);
}

/**
 * Applies the provided options to the current default options.
 * This does not modify the default options.
 */
module.exports.apply = function (options) {
    return Object.assign({}, defaults, options);
}