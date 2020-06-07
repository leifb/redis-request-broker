import { ClientOpts as Redis } from 'redis'

type Timeout = number;
type Logger = (level: Level, message: string, time: Date, component: Component, instance: string, scope: strnig) => void;
type Level = string | any;
type Levels = { error: Level, warning: Level, notice: Level, info: Level, debug: Level };
type MinimumRecipients = number;
type Component = 'worker' | 'client' | 'subscriber' | 'publisher';

export type ClientOptions = {
    redis?: Redis;
    timeout?: Timeout;
    logger?: Logger;
    levels?: Levels;
}

export type WorkerOptions = {
    redis?: Redis;
    logger?: Logger;
    levels?: Levels;
}

export type SubscriberOptions = {
    redis?: Redis;
    logger?: Logger;
    levels?: Levels;
}


export type PublisherOptions = {
    redis?: Redis;
    logger?: Logger;
    levels?: Levels;
    minimumRecipients?: MinimumRecipients;
}

export type Options = ClientOptions & WorkerOptions & SubscriberOptions & PublisherOptions;
