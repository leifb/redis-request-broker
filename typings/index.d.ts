
import Worker from './lib/worker';
import Client from './lib/client';
import Subscriber from './lib/subscriber';
import Publisher from './lib/publisher';
import * as Defaults from './lib/defaults';

declare module "redis-request-broker" {
	export {
		Worker,
		Client,
		Subscriber,
		Publisher,
		Defaults
	}
}
