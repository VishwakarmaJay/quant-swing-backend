import { registerFailPostMarketPendingOrdersCron } from './failPostMarketPendingOrders';
import { registerInstrumentSyncCron } from './instrumentSync';
import { registerOhlcvIncrementalCron } from './ohlcvIncremental';

/** Registers every cron (queue + consumer + scheduler). Call after connectRabbit(). */
export const startCrons = async (): Promise<void> => {
  await registerInstrumentSyncCron();
  await registerFailPostMarketPendingOrdersCron();
  await registerOhlcvIncrementalCron();
};

export { stopCrons } from './cron';
