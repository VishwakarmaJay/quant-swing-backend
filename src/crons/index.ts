import { registerFailPostMarketPendingOrdersCron } from './failPostMarketPendingOrders';
import { registerInstrumentSyncCron } from './instrumentSync';
import { registerOhlcvIncrementalCron } from './ohlcvIncremental';
import { registerSignalRunCron } from './signalRun';

/** Registers every cron (queue + consumer + scheduler). Call after connectRabbit(). */
export const startCrons = async (): Promise<void> => {
  await registerInstrumentSyncCron();
  await registerFailPostMarketPendingOrdersCron();
  await registerOhlcvIncrementalCron();
  await registerSignalRunCron();
};

export { stopCrons } from './cron';
