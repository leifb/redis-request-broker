import { PublisherOptions } from './options.d.ts';

export default class Publisher<Data> {

    constructor(channelName: string, options: PublisherOptions)
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    publish(message: Data): Promise<number>;

}