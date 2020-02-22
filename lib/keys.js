/** These channels are used for requests to workers. */
module.exports.workerChannel = function (queueName, workerId) {
    return `q:${queueName}:${workerId}`;
};

/** These channels are used for responses to requests. */
module.exports.responseChannel = function (requestId) {
    return `r:${requestId}`;
};

/** These sets are used to look up the current availability of workers. */
module.exports.availabilitySet = function (queueName) {
    return `a:${queueName}`;
};

/** This list is used to queue requests when no worker is immedeately available */
module.exports.requestQueue = function (queueName) {
    return `q:${queueName}`;
}