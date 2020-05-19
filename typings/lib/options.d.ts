type Redis = object;
type Timeout = number;
type Logger = (level: Level) => void;
type Level = string | any;
type Levels = { error: Level, warning: Level, notice: Level, info: Level, debug: Level };
type MinimumRecipients = number;

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
