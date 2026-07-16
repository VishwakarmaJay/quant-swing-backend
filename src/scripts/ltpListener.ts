import { LTP_CHANNEL } from '@/ltpStream/ltpStream';
import type { LtpUpdate } from '@/ltpStream/ltpUpdate';
import { redisSubClient } from '@services/redis';

/**
 * Test server: subscribes to the LTP Redis channel and prints every tick.
 * Run alongside the backend with `bun run listen:ltp` (Ctrl+C to exit).
 */
const run = async () => {
  if (redisSubClient.status === 'wait') await redisSubClient.connect();
  await redisSubClient.subscribe(LTP_CHANNEL);
  console.log(`[LtpListener]: subscribed to "${LTP_CHANNEL}" — waiting for ticks`);

  redisSubClient.on('message', (_channel, message) => {
    const update = JSON.parse(message) as LtpUpdate;
    for (const [id, tick] of Object.entries(update)) {
      console.log(
        `${new Date().toISOString()}  ${id.padEnd(20)} ltp=${tick.l} bid=${tick.b} ask=${tick.a} vol=${tick.v}`,
      );
    }
  });
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
