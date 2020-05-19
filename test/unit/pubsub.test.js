const chai = require('chai');
const chaiAsPromised = require("chai-as-promised");
const { Subscriber, Publisher, Defaults } = require('../../index');
const redis = require('redis');
const sleep = require('util').promisify(setTimeout);

const namespace = 'rrb-test-publisher';
chai.use(chaiAsPromised);
chai.should();

describe('Pub Sub', function () {

    // =====
    // Setup
    // =====

    before(async function () {
        Defaults.setDefaults({ redis: { prefix: `${namespace}:` }, timeout: 500 });
        this.channelOne = 'test-one';
        this.channelZero = 'test-zero';
        this.channelThree = 'test-three';
        this.channelThrow = 'test-throw';
        this.redis = redis.createClient(Defaults.apply().redis);
    });

    after(async function () {

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
        this.receivedOne = [];
        this.receivedThree = [];

        const handleOne = message => this.receivedOne.push(message);
        const handleThree = message => this.receivedThree.push(message);

        this.publisherZero = new Publisher(this.channelZero);
        this.publisherOne = new Publisher(this.channelOne);
        this.publisherThree = new Publisher(this.channelThree);
        this.publisherThree2 = new Publisher(this.channelThree);
        this.publisherToLittle = new Publisher(this.channelOne, { minimumRecipients: 2 });
        this.publisherDisconnected = new Publisher(this.channelOne);
        this.publisherThrow = new Publisher(this.channelThrow, { minimumRecipients: 2 });

        this.subscriberOne = new Subscriber(this.channelOne, handleOne);
        this.subscriberThree1 = new Subscriber(this.channelThree, handleThree);
        this.subscriberThree2 = new Subscriber(this.channelThree, handleThree);
        this.subscriberThree3 = new Subscriber(this.channelThree, handleThree);
        this.subscriberNotRunning = new Subscriber(this.channelOne, handleOne);
        this.subscriberThrowing = new Subscriber(this.channelThrow, m => { throw m; });
        this.subscriberRejecting = new Subscriber(this.channelThrow, async m => { throw m });

        await this.publisherZero.connect().should.be.fulfilled;
        await this.publisherOne.connect().should.be.fulfilled;
        await this.publisherThree.connect().should.be.fulfilled;
        await this.publisherThree2.connect().should.be.fulfilled;
        await this.publisherToLittle.connect().should.be.fulfilled;
        await this.publisherThrow.connect().should.be.fulfilled;

        await this.subscriberOne.listen().should.be.fulfilled;
        await this.subscriberThree1.listen().should.be.fulfilled;
        await this.subscriberThree2.listen().should.be.fulfilled;
        await this.subscriberThree3.listen().should.be.fulfilled;
        await this.subscriberThrowing.listen().should.be.fulfilled;
        await this.subscriberRejecting.listen().should.be.fulfilled;
    });

    afterEach(async function () {
        await this.publisherZero.disconnect().should.be.fulfilled;
        await this.publisherOne.disconnect().should.be.fulfilled;
        await this.publisherThree.disconnect().should.be.fulfilled;
        await this.publisherThree2.disconnect().should.be.fulfilled;
        await this.publisherToLittle.disconnect().should.be.fulfilled;
        await this.publisherThrow.disconnect().should.be.fulfilled;

        await this.subscriberOne.stop().should.be.fulfilled;
        await this.subscriberThree1.stop().should.be.fulfilled;
        await this.subscriberThree2.stop().should.be.fulfilled;
        await this.subscriberThree3.stop().should.be.fulfilled;
        await this.subscriberThrowing.stop().should.be.fulfilled;
        await this.subscriberRejecting.stop().should.be.fulfilled;
    });

    this.slow(30);
    this.timeout(1100);

    // =================
    // Actual tests here
    // =================

    it('should be able to send a message', async function () {
        const message = 'message';
        const count = await this.publisherOne.publish(message).should.be.fulfilled;
        count.should.eq(1);
        await sleep(5);
        this.receivedOne.length.should.eq(1);
        this.receivedOne[0].should.eq(message);
    });

    it('should work with zero subscribers', async function () {
        const count = await this.publisherZero.publish('message').should.be.fulfilled;
        count.should.eq(0);
    });

    it('should work with three subscribers', async function () {
        const count = await this.publisherThree.publish('message').should.be.fulfilled;
        count.should.eq(3);
        await sleep(5);
        this.receivedThree.should.deep.eq(['message', 'message', 'message']);
    });

    it('should be possible to have multiple publishers on the same channel', async function () {
        const count1 = await this.publisherThree.publish('message 1').should.be.fulfilled;
        const count2 = await this.publisherThree2.publish('message 2').should.be.fulfilled;
        count1.should.eq(3);
        count2.should.eq(3);
        await sleep(5);
        this.receivedThree.length.should.eq(6);
        this.receivedThree.filter(m => m === 'message 1').length.should.eq(3);
        this.receivedThree.filter(m => m === 'message 2').length.should.eq(3);
    });

    it('should use minimumRecipients', async function () {
        await this.publisherToLittle.publish('message').should.be.rejected;
    });

    it('should not be possible to connect a publsiher twice', async function () {
        await this.publisherOne.connect().should.be.rejectedWith(Error, 'Publisher already connected');
    });

    it('should not be possible to start a subscriber twice', async function () {
        await this.subscriberOne.listen().should.be.rejectedWith(Error, 'Subscriber already listening');
    });

    it('should be possible to disconnect a publisher before connecting', async function () {
        await this.publisherDisconnected.disconnect().should.be.fulfilled;
    });

    it('should be possible to stop a subscriber before starting', async function () {
        await this.subscriberNotRunning.stop().should.be.fulfilled;
    });

    it('should be possible to disconnect a publisher twice', async function () {
        const publisher = new Publisher('test-disconnect');
        await publisher.connect().should.be.fulfilled;
        await publisher.disconnect().should.be.fulfilled;
        await publisher.disconnect().should.be.fulfilled;
    });

    it('should be possible to stop a subscriber twice', async function () {
        const subscriber = new Subscriber('test-disconnect', m => { });
        await subscriber.listen().should.be.fulfilled;
        await subscriber.stop().should.be.fulfilled;
        await subscriber.stop().should.be.fulfilled;
    });

    it('should handle throwing or rejecting handlers', async function () {
        const count = await this.publisherThrow.publish('message').should.be.fulfilled;
        count.should.eq(2);

    });
});
