const chai = require('chai');
const chaiAsPromised = require("chai-as-promised");
const { Client, Worker } = require('../../index');
const redis = require('redis');

const namespace = 'rrb-test-worker';
chai.use(chaiAsPromised);
chai.should();

describe('Worker', function () {

    // =====
    // Setup
    // =====

    before(async function () {
        this.queueItentity = 'test-identity';
        this.clientIdentity = new Client(this.queueItentity, { namespace });
        await this.clientIdentity.connect().should.be.fulfilled;
        this.redis = redis.createClient();
    });

    after(async function () {
        await this.clientIdentity.disconnect().should.be.fulfilled;
        const leftOvers = await new Promise((resolve, _) => {
            this.redis.keys(`${namespace}:*`, (_, keys) => {
                resolve(keys);
            });
        });
        for (const k of leftOvers)
            this.redis.del(k);

        this.redis.end(true);

        if (leftOvers.length > 0)
            throw Error(`${leftOvers.length} leftover keys found: [${leftOvers.join(', ')}]`);
    });

    beforeEach(async function () {
        this.workerIdentity = new Worker(this.queueItentity, async d => d, { namespace });
        await this.workerIdentity.listen().should.be.fulfilled;
    });

    afterEach(async function () {
        await this.workerIdentity.stop().should.be.fulfilled;
    })

    this.slow(30);
    this.timeout(1100);

    // =================
    // Actual tests here
    // =================

    it('should handle a request from a client', async function () {
        await this.clientIdentity.request(10).should.eventually.equal(10);
    });

    it('should handle multiple request in succession', async function () {
        await Promise.all([
            this.clientIdentity.request(10).should.eventually.equal(10),
            this.clientIdentity.request(10).should.eventually.equal(10),
            this.clientIdentity.request(10).should.eventually.equal(10),
            this.clientIdentity.request(10).should.eventually.equal(10),
            this.clientIdentity.request(10).should.eventually.equal(10)
        ]);
    });

});
