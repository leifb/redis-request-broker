import { PublisherOptions } from './options'

export default class Publisher<Data> {

    constructor(channelName: string, options: PublisherOptions)
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    publish(message: Data): Promise<number>;

}
