/** These channels are used for requests to workers. */
module.exports.workerChannel = function (namespace, queueName, workerId) {
    return `${namespace}:q:${queueName}:${workerId}`;
};

/** These channels are used for responses to requests. */
module.exports.responseChannel = function (namespace, requestId) {
    return `${namespace}:r:${requestId}`;
};

/** These sets are used to look up the current availability of workers. */
module.exports.availabilitySet = function (namespace, queueName) {
    return `${namespace}:a:${queueName}`;
};

/** This list is used to queue requests when no worker is immedeately available */
module.exports.requestQueue = function (namespace, queueName) {
    return `${namespace}:q:${queueName}`;
}