
const loggingTo = [
    'error',
    'warning',
    'notice',
    //'info',
    //'debug',
]

module.exports.levels = {
    error: 'error',
    warning: 'warning',
    notice: 'notice',
    info: 'info',
    debug: 'debug'
}

module.exports.defaulLogger = function (level, message) {
    if (loggingTo.includes(level)) {
        console.log(`[${level}]${message}`);
    }
}