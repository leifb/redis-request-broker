# redis-request-broker

[![Build Status](https://travis-ci.org/leifb/redis-request-broker.svg?branch=master)](https://travis-ci.org/leifb/redis-request-broker)

A request broker based on the redis PUB / SUB system. This package can be used for the communication of distributed
systems when one service needs to request data from another.

Requests will be send to only one worker. If no worker is currently idle, the request will be queued and picked up
as soon as one becomes available. Workers always handle only one request at a time.

## Goals

 - Simple to use
 - Thread safe 
 - Allow multiple parallel workers and clients
 - Limited scope
 - Transparent usage
 
## Example
 
 ```js
const { Worker, Client } = require('redis-request-broker');

async function doWork(data) {
    console.log('Working on', data);
    return data + 1;
}

const w = new Worker('myqueue', doWork);
const c = new Client('myqueue');

async function start() {
    await w.listen();
    await c.connect();

    const result = await c.request(42);
    console.log('result', r);
    
    await w.stop();
    await c.disconnect();
}

start();
```

## Configuration

You can configure each client and worker itself or set process wide defaults:

```js
const { Worker, Client, Defaults } = require('redis-request-broker');
Defaults.setDefaults({ redis: { port: 1234, db: 'separated' } });
const w1 = new Worker('myqueue', someWork, { logger: console.log }); // Options will be merged
```

Here are all available options:

 - `redis`: An object that configures the redis connection. It will be passed
   directly to the `createClient` method of the underlying `redis` package. See
   The [redis](https://www.npmjs.com/package/redis#options-object-properties) npm
   package for more information.
   
   **IMPORTANT:** When overriding you should make sure to set either the `prefix`
   or the `db` option or otherwise your keys might get mixed up with other stuff
   in the database!
    
     - The default value is `{ prefix: 'rrb:' }`.
     - Example: `{ port: 1234, db: 'myapp' }`
     
 - `timeout`: A timeout in ms after which a request fails. For the client that means
    when it will stop waiting for a response from a worker and rejects the request.
    
     - The default value is `1000` ms.
     - Example: `{ timeout: 5000 } // five seconds`
  
 - `logger`: Allows to inject a custom logger. It has to be a method that takes two
    arguments: The logging level and a message. The logging levels are strings by
    default, but you can configure them to be whatever you want by using the levels
    option.
  
     - The default logger is writing `error`, `warning` and `notice` logs to the console.
     - Example: `{ logger: (level, message) => console.log(message)}`
  
 - `levels`: Allows to customize what gets passed into the logger method for logging.
   The package uses five different levels: error, warning, notice, info and debug.
    
    - The default values are the respective strings ('error' for error, etc.) and
      are therefore compatible with winston log levels.
    - Example: `{ levels: { error: 'e', warning: 'w', notice: 'n', info: 'i', debug: 'd' }}`

## Transparent Error Handling

If the `handle` mehod of the worker rejects the request, the error will be transmitted to the
client where the `reqeust` call will be rejected with the same error, if not already timed out.

Here is a simple example of this behavior:

```js
const w = new Worker('throwing', d => { throw d; });
const c = new Client('throwing');
await w.listen();
await c.connect();
try {
  await c.request('My Request');
}
catch (error) {
  console.log(error); // Will log 'My Request'
}
```

Note that due to the fact that all data that is sent between workers and clients is serialized,
some properties of your errors may not be present on the client side, especially methods.

Internally, `JSON.stringify` and `JSON.parse` are used for the (de-) serialization.

## Inner workings

Here is how it is working:

For every queue there will be a `availibilitySet` in the reddis db storing ids of workers that are availible.  Furthermore, a `requestQueue` (list) is used for requests that cannot be handled right away. When a client starts a requests, it will pop one id from the `availiblitySet` and sends the reqeust to a channel spcific for this worker. If no id is in the `availiblitySet`, the request will be put into the `requestQueue` instead.
 
Workers will receive messages and call the provided handler function. Results will be send into a response channel specific for the request. Then the worker will check if there is a request waiting in the `requestQueue` and handle the oldest request. This will repeat until the request queue is empty. After that the worker puts itself into the `availiblitySet` again.

Clients choose workers using the `SPOP` redis command, which means that a random idle worker is chosen when available.
