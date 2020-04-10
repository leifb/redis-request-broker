const chai = require('chai');
const chaiAsPromised = require("chai-as-promised");
const { Subscriber, Publisher, Defaults } = require('../../index');
const redis = require('redis');
const sleep = require('util').promisify(setTimeout);

const namespace = 'rrb-test-publisher';
chai.use(chaiAsPromised);
chai.should();

describe('Publisher', function () {

    // =====
    // Setup
    // =====

    before(async function () {
        Defaults.setDefaults({ redis: { prefix: `${namespace}:` }, timeout: 500 });
        this.channelOne = 'test-one';
        this.channelZero = 'test-zero';
        this.channelThree = 'test-three';
        this.receivedOne = [];
        this.receivedThree = [];
        const handleOne = message => {
            this.receivedOne.push(message);
        }
        const handleThree = message => {
            this.receivedThree.push(message);
        }
        this.subscriberOne = new Subscriber(this.channelOne, handleOne);
        this.subscriberThree1 = new Subscriber(this.channelThree, handleThree);
        this.subscriberThree2 = new Subscriber(this.channelThree, handleThree);
        this.subscriberThree3 = new Subscriber(this.channelThree, handleThree);
        await this.subscriberOne.listen().should.be.fulfilled;
        await this.subscriberThree1.listen().should.be.fulfilled;
        await this.subscriberThree2.listen().should.be.fulfilled;
        await this.subscriberThree3.listen().should.be.fulfilled;
        this.redis = redis.createClient(Defaults.apply().redis);
    });

    after(async function () {
        await this.subscriberOne.stop().should.be.fulfilled;
        await this.subscriberThree1.stop().should.be.fulfilled;
        await this.subscriberThree2.stop().should.be.fulfilled;
        await this.subscriberThree3.stop().should.be.fulfilled;

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
        this.receivedOne.length = 0;
        this.receivedThree.length = 0;

        this.publisherZero = new Publisher(this.channelZero);
        this.publisherOne = new Publisher(this.channelOne);
        this.publisherThree = new Publisher(this.channelThree);
        this.publisherToLittle = new Publisher(this.channelOne, { minimumRecipients: 2 });
        this.publisherDisconnected = new Publisher(this.channelOne);
        await this.publisherZero.connect().should.be.fulfilled;
        await this.publisherOne.connect().should.be.fulfilled;
        await this.publisherThree.connect().should.be.fulfilled;
        await this.publisherToLittle.connect().should.be.fulfilled;
    });

    afterEach(async function () {
        await this.publisherZero.disconnect().should.be.fulfilled;
        await this.publisherOne.disconnect().should.be.fulfilled;
        await this.publisherThree.disconnect().should.be.fulfilled;
        await this.publisherToLittle.disconnect().should.be.fulfilled;
    })

    this.slow(30);
    this.timeout(1100);

    // =================
    // Actual tests here
    // =================

    it('should be able to send messages', async function () {
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

    it('shohld work with three subscribers', async function() {
        const count = await this.publisherThree.publish('message').should.be.fulfilled;
        count.should.eq(3);
        await sleep(5);
        this.receivedThree.should.deep.eq(['message', 'message', 'message']);
    })

    it('should use minimumRecipients', async function () {
        await this.publisherToLittle.publish('message').should.be.rejected;
    });

    it('should not be possible to connect twice', async function() {
        await this.publisherOne.connect().should.be.rejectedWith('Publisher already connected');
    });

    it('should not be possible to disconnect before connecting', async function() {
        await this.publisherDisconnected.disconnect().should.be.rejectedWith('Publisher not connected');
    });

    it('should not be possible to disconnect twice', async function() {
        const publisher = new Publisher('test-disconnect');
        await publisher.connect().should.be.fulfilled;
        await publisher.disconnect().should.be.fulfilled;
        await publisher.disconnect().should.be.rejectedWith('Publisher not connected');
    });

});
