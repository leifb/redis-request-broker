module.exports.composeRequest = function (id, data) {
    return JSON.stringify({ id, data });
}

module.exports.composeResponse = function (id, response) {
    return JSON.stringify({ id, response });
}

module.exports.parseRequest = function (message) {
    const { id, data } = JSON.parse(message);
    return { id, data };
}

module.exports.parseResponse = function (message) {
    const { id, response } = JSON.parse(message);
    return { id, response };
}
