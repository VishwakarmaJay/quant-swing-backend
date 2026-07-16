import amqplib from 'amqplib';
import type { Channel, ChannelModel } from 'amqplib';

import { env } from '@config/env';
import logger from '@services/logger';

let connection: ChannelModel | null = null;
let channel: Channel | null = null;
let closing = false;

export const connectRabbit = async (): Promise<Channel> => {
  if (channel) return channel;
  closing = false;

  connection = await amqplib.connect(env.RABBITMQ_URL);
  connection.on('error', (err) => logger.error(`[Rabbit]: connection error: ${err.message}`));
  connection.on('close', () => {
    if (closing) return;
    // Drop the dead handles so getChannel() fails loudly instead of handing
    // out a channel that can no longer publish or consume.
    channel = null;
    connection = null;
    logger.error('[Rabbit]: connection lost — cron publishing/consumption is down until restart');
  });

  channel = await connection.createChannel();
  channel.on('error', (err) => logger.error(`[Rabbit]: channel error: ${err.message}`));
  channel.on('close', () => {
    if (closing || !connection) return;
    channel = null;
    logger.error('[Rabbit]: channel closed — cron publishing/consumption is down until restart');
  });
  await channel.prefetch(1);

  logger.info('[Rabbit]: connected');
  return channel;
};

export const getChannel = (): Channel => {
  if (!channel) throw new Error('RabbitMQ channel not initialised; call connectRabbit() first');
  return channel;
};

export const closeRabbit = async (): Promise<void> => {
  closing = true;
  await channel?.close().catch(() => {});
  await connection?.close().catch(() => {});
  channel = null;
  connection = null;
};
