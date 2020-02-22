const chai = require('chai');
const chaiAsPromised = require("chai-as-promised");
const { Client, Worker } = require('../../index');
const namespace = 'rrb-test-client';
const redis = require('redis');

chai.use(chaiAsPromised);
chai.should();

describe('Client', function () {

    this.beforeAll(async function () {
        this.worker = new Worker('test', (work) => {
            return new Promise((resolve, _) => { setTimeout(() => resolve(work * 2), 5) });
        }, { namespace });
        await this.worker.listen();
        this.redis = redis.createClient();
    });

    this.afterAll(async function () {
        await this.worker.stop();
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

    this.slow(40);
    this.timeout(1100);

    it('should request a resource from a worker', async function () {
        const c = new Client('test', { namespace });
        await c.connect().should.be.fulfilled;
        await c.request(10).should.eventually.equal(20);
        await c.disconnect().should.be.fulfilled;
    });

    it('should time out when no worker is available', async function () {
        this.slow(200);
        const c = new Client('invalid queue', { namespace, timeout: 70 });
        await c.connect().should.be.fulfilled;
        await c.request(20).should.be.rejectedWith(Error, 'Request timed out');
        await c.disconnect().should.be.fulfilled;
    });

    it('should use the request queue', async function () {
        this.slow(50);
        const c = new Client('test', { namespace });
        await c.connect().should.be.fulfilled;
        await Promise.all([
            c.request(10).should.eventually.equal(20),
            c.request(20).should.eventually.equal(40)
        ]);
        await c.disconnect().should.be.fulfilled;
    });

    it('should use the namespace option', async function () {
        this.slow(200);
        const c = new Client('test', { namespace: `${namespace}:no worker here`, timeout: 70 });
        await c.connect();
        await c.request(10).should.be.rejectedWith(Error, 'Request timed out');
        await c.disconnect();
        await this.redis.del(`${namespace}:no worker here:q:test`);
    });

    it('should fail when not connected', async function () {
        const c = new Client('test', { namespace });
        await c.request(10).should.be.rejectedWith(Error, 'Client not connected');
        await c.disconnect().should.be.rejectedWith(Error, 'Client not connected');
    });

    it('should send the request to only one worker', async function () {
        let worked = false;
        const work = async () => {
            if (worked) throw new Error('Only one worker should handle the request');
            worked = true;
        }
        const w1 = new Worker('test', work, { namespace });
        const w2 = new Worker('test', work, { namespace });
        const c = new Client('test', { namespace });
        await w1.listen();
        await w2.listen();
        await c.connect();
        await c.request('work').should.be.fulfilled;
        await w1.stop();
        await w2.stop();
        await c.disconnect();
    });
});
