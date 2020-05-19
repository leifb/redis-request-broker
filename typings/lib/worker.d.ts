import { WorkerOptions } from './options'

export default class Worker<Data, Result> {

    constructor(queue: string, handle: (data: Data) => Promise<Result>, options: WorkerOptions)
    listen(): Promise<void>;
    stop(): Promise<void>;

}
