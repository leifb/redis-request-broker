import { ClientOptions } from './options'

export default class Client<Data, Result> {

    constructor(queue: string, options: ClientOptions)
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    request(data: Data): Promise<Result>;

}
