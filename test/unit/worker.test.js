const chai = require('chai');
const chaiAsPromised = require("chai-as-promised");
const { Client, Worker } = require('../../index');
const redis = require('redis');

const namespace = 'rrb-test-worker';
chai.use(chaiAsPromised);
chai.should();

describe('Worker', function () {

    this.beforeAll(async function () {
        this.client = new Client('test', { namespace });
        await this.client.connect();
        this.redis = redis.createClient();
    });

    this.afterAll(async function () {
        await this.client.disconnect();
        const leftOvers = await new Promise((resolve, _) => {
            this.redis.keys(`${namespace}:*`, (_, keys) => {
                resolve(keys);
            });
        });
        for (const k of leftOvers)
            await this.redis.del(k);

        if (leftOvers.length > 0)
            throw Error(`${leftOvers.length} leftover keys found: [${leftOvers.join(', ')}]`);
    });

    this.slow(30);
    this.timeout(1100);

    it('should handle a request from a client', async function () {
        const w = new Worker('test', async d => d, { namespace });
        await w.listen();
        await this.client.request(10).should.eventually.equal(10);
        await w.stop();
    });

    it('should handle multiple request in succession', async function () {
        const w = new Worker('test', async d => d, { namespace });
        await w.listen();
        await Promise.all([
            this.client.request(10).should.eventually.equal(10),
            this.client.request(10).should.eventually.equal(10),
            this.client.request(10).should.eventually.equal(10),
            this.client.request(10).should.eventually.equal(10),
            this.client.request(10).should.eventually.equal(10)
        ]);
        await w.stop();
    });

});
