
declare type Redis = object;
declare type Timeout = number;
declare type Logger = (level: Level) => void;
declare type Level = string | any;
declare type Levels = { error: Level, warning: Level, notice: Level, info: Level, debug: Level };
declare type MinimumRecipients = number;

declare type ClientOptions = {
    redis?: Redis;
    timeout?: Timeout;
    logger?: Logger;
    levels?: Levels;
}

declare type WorkerOptions = {
    redis?: Redis;
    logger?: Logger;
    levels?: Levels;
}

declare type SubscriberOptions = {
    redis?: Redis;
    logger?: Logger;
    levels?: Levels;
}


declare type PublisherOptions = {
    redis?: Redis;
    logger?: Logger;
    levels?: Levels;
    minimumRecipients?: MinimumRecipients;
}

declare type Options = ClientOptions & WorkerOptions & SubscriberOptions & PublisherOptions;