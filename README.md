# redis-request-broker
A request broker based on the redis PUB / SUB system. This package can be used for the communication of distributed
systems when one service needs to request data from another.

Requests will be send to only one worker. If no worker is currently idle, the request will be queued and picked up
as soon as one becomes available. Workers always handle only one request at a time.

## Goals

 - Simple to use
 - Thread safe 
 - Allwow multiple parallel workers and clients
 - Limited scope
 
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
}

start();
```

## Inner workings

Here is how it is working:

For every queue there will be a `availibilitySet` in the reddis db storing ids of workers that are availible.  Furthermore, a `requestQueue` (list) is used for requests that cannot be handled right away. When a client starts a requests, it will pop one id from the `availiblitySet` and sends the reqeust to a channel spcific for this worker. If no id is in the `availiblitySet`, the request will be put into the `requestQueue` instead.
 
Workers will receive messages and call the provided handler function. Results will be send into a response channel specific for the request. Then the worker will check if there is a request waiting in the `requestQueue` and handle the oldest request. This will repeat until the request queue is empty. After that the worker puts itself into the `availiblitySet` again.

Clients choose workers using the `SPOP` redis command, which means that a random idle worker is chosen when available.
