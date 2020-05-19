import { SubscriberOptions } from './options'

export default class Subscriber<Data> {

    constructor(channelName: string, handle: (data: Data) => any | void | Promise<any> | Promise<void>, options?: SubscriberOptions)
    listen(): Promise<void>;
    stop(): Promise<void>;

}
