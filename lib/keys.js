/**
 * Generates the name of a request channel.
 * 
 * These channels are used to notify workers that there is new message in
 * the request queue.
 */
module.exports.requestChannel = function (channelName, prefix) {
    if (!prefix) prefix = '';
    return `${prefix}n:${channelName}`;
}

/**
 * Generates the name of a response channel.
 * 
 * These channels are used for responses to requests.
 * @param {string} requestId The id of the request to respond to.
 */
module.exports.responseChannel = function (requestId, prefix) {
    if (!prefix) prefix = '';
    return `${prefix}r:${requestId}`;
};

/** 
 * Generates the name of a request queue.
 * 
 * These lists are used to queue requests when no worker is immedeately available.
 * @param queueName The name of the queue.
 */
module.exports.requestQueue = function (queueName) {
    return `q:${queueName}`;
}

/**
 * Generates the name of a pub / sub channel.
 * 
 * These are used for publishing messages to multiple subscribers without expecting a response.
 * @param channelName The name of the channel.
 */
module.exports.pubSubChannel = function (channelName, prefix) {
    if (!prefix) prefix = '';
    return `${prefix}c:${channelName}`;
}
