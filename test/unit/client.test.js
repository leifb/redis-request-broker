const chai = require('chai');
const chaiAsPromised = require("chai-as-promised");
const { Client, Worker, Defaults } = require('../../index');
const namespace = 'rrb-test-client';
const redis = require('redis');

chai.use(chaiAsPromised);
chai.should();

describe('Client', function () {

    // =====
    // Setup
    // =====

    before(async function () {
        Defaults.setDefaults({ redis: { prefix: `${namespace}:` }, timeout: 500 });
        this.worker = new Worker('test', (work) => {
            return new Promise((resolve, _) => { setTimeout(() => resolve(work * 2), 5) });
        });

        await this.worker.listen().should.be.fulfilled;
        this.redis = redis.createClient(Defaults.apply().redis);
    });

    after(async function () {
        await this.worker.stop().should.be.fulfilled;

        const leftOvers = await new Promise((resolve, _) => {
            this.redis.keys(`${namespace}:*`, (_, keys) => {
                resolve(keys);
            });
        });
        for (const k of leftOvers)
            await this.redis.del(k.replace(`${namespace}:`, ''));


        this.redis.end(false);

        if (leftOvers.length > 0)
            throw Error(`${leftOvers.length} leftover keys found: [${leftOvers.join(', ')}]`);
    });

    /** Unique clients for every test */
    beforeEach(async function () {
        this.clientValid = new Client('test');
        this.clientInvalidQueue = new Client('invalid-queue', { timeout: 70 });
        this.clientInvalidNamespace = new Client('test', { redis: { prefix: `${namespace}:invalid-namespace:` }, timeout: 70 });
        this.clientUnconnected = new Client('test');
        await this.clientValid.connect().should.be.fulfilled;
        await this.clientInvalidQueue.connect().should.be.fulfilled;
        await this.clientInvalidNamespace.connect().should.be.fulfilled;
    });

    /** Clean up clients after each test */
    afterEach(async function () {
        await this.clientValid.disconnect().should.be.fulfilled;
        await this.clientInvalidQueue.disconnect().should.be.fulfilled;
        await this.clientInvalidNamespace.disconnect().should.be.fulfilled;
    })

    this.slow(30);
    this.timeout(1100);

    // =================
    // Actual tests here
    // =================

    it('should request a resource from a worker', async function () {
        await this.clientValid.request(10).should.eventually.equal(20);
    });

    it('should use the request queue', async function () {
        this.slow(50);
        await Promise.all([
            this.clientValid.request(10).should.eventually.equal(20),
            this.clientValid.request(20).should.eventually.equal(40)
        ]);
    });

    it('should send the request to only one worker', async function () {
        let worked = false;
        testSpecificQueue = 'test-2';
        const work = async () => {
            if (worked) throw new Error('Only one worker should handle the request');
            worked = true;
        }
        const w1 = new Worker(testSpecificQueue, work);
        const w2 = new Worker(testSpecificQueue, work);
        const c = new Client(testSpecificQueue);
        try {
            await w1.listen().should.be.fulfilled;
            await w2.listen().should.be.fulfilled;
            await c.connect().should.be.fulfilled;
            await c.request('work').should.be.fulfilled;
        }
        finally {
            await w1.stop().should.be.fulfilled;
            await w2.stop().should.be.fulfilled;
            await c.disconnect().should.be.fulfilled;
        }
    });

    it('should be possible to stop when not running', async function () {
        await this.clientValid.disconnect().should.be.fulfilled;
    });
});
