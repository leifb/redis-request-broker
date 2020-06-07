
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

module.exports.defaulLogger = function (level, message, component, instance, scope) {
    if (loggingTo.includes(level)) {
        const time = new Date().toISOString();
        console.log(`${time} [${level}][${component}][${instance}][${scope}] ${message}`);
    }
}