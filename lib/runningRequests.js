module.exports = function init(timeout) {
    let runningRequests = [];
    let promise = Promise.resolve();
    let promiseResolve;
    return {
        add: function (id) {
            runningRequests.push(id);
            setTimeout(() => this.finish(id), timeout);
            if (runningRequests.length === 1)
                promise = new Promise((resolve, _) => { promiseResolve = resolve; });
        },

        finish: function (id) {
            runningRequests = runningRequests.filter(_id => _id !== id);
            if (runningRequests.length === 0 && promiseResolve) {
                promiseResolve();
                promiseResolve = undefined;
                promise = Promise.resolve();
            }
        },

        await: async function () {
            await promise;
        },

        hasRunning: function () {
            return runningRequests.length > 0;
        }

    }
}