/** 
 * Composes a request message to be send to a worker via a redis server.
 * @param {any} id The id of the request. The worker will send the result
 *   into a queue specific to this request id.
 * @param {any} data Any serializable data that represents the request.
 * @returns {string} The serialized request message.
 */
module.exports.composeRequest = function (id, data) {
    return JSON.stringify({ id, data });
}

/**
 * Composes a response message to be send to a client via a redis server.
 * @param {any} id The id of the request. This should be taken from the request
 *   that resulted into this response.
 * @param {any} response Any serializable data the represents the response.
 * @returns {string} The serialized response message.
 */
module.exports.composeResponse = function (id, response) {
    return JSON.stringify({ id, response });
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
 * @param {string} message The message to parse. 
 * @returns {object} The deserialized response message containing the
 *   properties id and response.
 */
module.exports.parseResponse = function (message) {
    const { id, response } = JSON.parse(message);
    return { id, response };
}
