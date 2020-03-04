/** 
 * Composes a request message to be send to a worker via a redis server.
 * @param {string} id The id of the request. The worker will send the result
 *   into a queue specific to this request id.
 * @param {any} data Any serializable data that represents the request.
 * @returns {string} The serialized request message.
 */
module.exports.composeRequest = function (id, data) {
    return JSON.stringify({ id, data });
}

/**
 * Composes a response message to be send to a client via a redis server.
 * @param {string} id The id of the request. This should be taken from the request
 *   that resulted in this response.
 * @param {any} response Any serializable data the represents the response.
 * @returns {string} The serialized response message.
 */
module.exports.composeResponse = function (id, response) {
    return JSON.stringify({ id, response, ok: true });
}

/**
 * Composes a error message to be send to a client via a redis server.
 * @param {string} id The id of the request. This should be taken from the request
 *   that resulted in this error.
 * @param {any} error Any serializable arror.
 * @returns {string} The serialized error response.
 */
module.exports.composeError = function (id, error) {
    return JSON.stringify({ id, error, ok: false });
}

/**
 * Parses a request that has been send by a client via a redis server.
 * @param {string} message The message to parse.
 * @returns {object} The deserialized request message containing the
 *   properties id and data.
 */
module.exports.parseRequest = function (message) {
    const { id, data } = JSON.parse(message);
    return { id, data };
}

/**
 * Parses a response that has been send by a worker via a redis server.
 * This may also be an error response.
 * @param {string} message The message to parse. 
 * @returns {object} The deserialized response message containing the
 *   properties id, ok and response or error, depending on weather the
 *   request was rejected or not.
 */
module.exports.parseResponse = function (message) {
    const { id, response, error, ok } = JSON.parse(message);
    if (!ok)
        return { id, error, ok: false };
    return { id, response, ok: true };
}
