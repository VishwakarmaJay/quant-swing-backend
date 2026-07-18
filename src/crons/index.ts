import { registerFailPostMarketPendingOrdersCron } from './failPostMarketPendingOrders';
import { registerFundamentalsSnapshotCron } from './fundamentalsSnapshot';
import { registerInstrumentSyncCron } from './instrumentSync';
import { registerNewsIngestCron } from './newsIngest';
import { registerOhlcvIncrementalCron } from './ohlcvIncremental';
import { registerSignalRunCron } from './signalRun';

/** Registers every cron (queue + consumer + scheduler). Call after connectRabbit(). */
export const startCrons = async (): Promise<void> => {
  await registerInstrumentSyncCron();
  await registerFailPostMarketPendingOrdersCron();
  await registerOhlcvIncrementalCron();
  await registerSignalRunCron();
  await registerNewsIngestCron();
  await registerFundamentalsSnapshotCron();
};

export { stopCrons } from './cron';
