const chai = require('chai');
const chaiAsPromised = require("chai-as-promised");
const { Client, Worker, Defaults } = require('../../index');
const redis = require('redis');

const namespace = 'rrb-test-worker';
chai.use(chaiAsPromised);
chai.should();

describe('Worker', function () {

    // =====
    // Setup
    // =====

    before(async function () {
        Defaults.setDefaults({ redis: { prefix: `${namespace}:` }, timeout: 500 });
        this.queueItentity = 'test-identity';
        this.queueThrowing = 'test-throwing';
        this.queueThrowingErrors = 'test-throwing-errors';
        this.clientIdentity = new Client(this.queueItentity);
        this.clientThrowing = new Client(this.queueThrowing);
        this.clientThrowingErrors = new Client(this.queueThrowingErrors);
        await this.clientIdentity.connect().should.be.fulfilled;
        await this.clientThrowing.connect().should.be.fulfilled;
        await this.clientThrowingErrors.connect().should.be.fulfilled;
        this.redis = redis.createClient(Defaults.apply().redis);
    });

    after(async function () {
        await this.clientIdentity.disconnect().should.be.fulfilled;
        await this.clientThrowing.disconnect().should.be.fulfilled;
        await this.clientThrowingErrors.disconnect().should.be.fulfilled;
        const leftOvers = await new Promise((resolve, _) => {
            this.redis.keys(`${namespace}:*`, (_, keys) => {
                resolve(keys);
            });
        });
        for (const k of leftOvers)
            this.redis.del(k);

        this.redis.end(true);

        if (leftOvers.length > 0)
            throw Error(`${leftOvers.length} leftover keys found: [${leftOvers.join(', ')}]. Try to run the tests again.`);
    });

    beforeEach(async function () {
        this.workerIdentity = new Worker(this.queueItentity, async d => d);
        this.workerThrowing = new Worker(this.queueThrowing, async d => { throw d });
        this.workerThrowingErrors = new Worker(this.queueThrowingErrors, async d => { throw new Error(d) });
        await this.workerIdentity.listen().should.be.fulfilled;
        await this.workerThrowing.listen().should.be.fulfilled;
        await this.workerThrowingErrors.listen().should.be.fulfilled;
    });

    afterEach(async function () {
        await this.workerIdentity.stop().should.be.fulfilled;
        await this.workerThrowing.stop().should.be.fulfilled;
        await this.workerThrowingErrors.stop().should.be.fulfilled;
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

    it('should transmit errors transparently', async function () {
        await this.clientThrowing.request('data').should.be.rejected.and.eventually.eq('data');
    });

    it('should be possible to stop when not running', async function () {
        await this.workerIdentity.stop().should.be.fulfilled;
    });

    it('should pass errors as normal obejcts', async function () {
        await this.clientThrowingErrors.request('data').should.be.rejected
            .and.eventually.have.property('message', 'data');
    });

});
