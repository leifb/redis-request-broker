/**
 * Generates the name of a worker channel.
 *  
 * These channels are used for requests to workers.
 * @param {string} queueName The name of the queue to which the worker listens.
 * @param {string} workerId The id of the worker in question.
 */
module.exports.workerChannel = function (queueName, workerId) {
    return `q:${queueName}:${workerId}`;
};

/**
 * Generates the name of a response channel.
 * 
 * These channels are used for responses to requests.
 * @param {string} requestId The id of the request to respond to.
 */
module.exports.responseChannel = function (requestId) {
    return `r:${requestId}`;
};

/**
 * Generates the name of a availiblity set. 
 * 
 * These sets are used to look up the current availability of workers.
 * @param queueName The name of the queue to which the set belongs to.
 */
module.exports.availabilitySet = function (queueName) {
    return `a:${queueName}`;
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
module.exports.pubSubChannel = function (channelName) {
    return `c:${channelName}`;
}
