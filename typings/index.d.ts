declare module "redis-request-broker" {
	export { default as Worker } from './lib/worker.d.ts';
	export { default as Client } from './lib/client.d.ts';
	export { default as Subscriber } from './lib/subscriber.d.ts';
	export { default as Publisher } from './lib/publisher.d.ts';
	export * as Defaults from './lib/defaults.d.ts';
}
