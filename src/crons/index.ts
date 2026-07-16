import { registerFailPostMarketPendingOrdersCron } from './failPostMarketPendingOrders';
import { registerInstrumentSyncCron } from './instrumentSync';

/** Registers every cron (queue + consumer + scheduler). Call after connectRabbit(). */
export const startCrons = async (): Promise<void> => {
  await registerInstrumentSyncCron();
  await registerFailPostMarketPendingOrdersCron();
};

export { stopCrons } from './cron';
