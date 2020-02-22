const { Client, Worker } = require('../');

async function doWork(w, data) {


    console.log(w, 'Working on', data);
    return data + 1;
}

const w1 = new Worker('test', data => doWork(1, data));
const w2 = new Worker('test', data => doWork(2, data));
const c = new Client('test');

async function start() {
    try {
        console.log('creating workers');

        await w1.listen();
        await w2.listen();
        console.log('creating client');
        await c.connect();
        console.log('sending requests');
        for (i of [1, 2, 3, 4, 5, 6]) {
            try {
                const r = await c.request(i * 10);
                console.log('response', r);

            }
            catch (error) {
                console.error(error);
            }
        }
        process.exit();
    }
    catch (error) {
        console.log(error);
        process.exit();
    }
}

start();