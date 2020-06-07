
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

module.exports.defaulLogger = function (level, message, time, component, instance, scope) {
    if (loggingTo.includes(level)) {
        console.log(`${time.toISOString()} [${level}][${component}][${instance}][${scope}] ${message}`);
    }
}