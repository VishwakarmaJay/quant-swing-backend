import { syncInstrumentMaster } from '@services/instrumentMaster';
import { CRONJOBS, createCron } from './cron';

/** Refreshes the instrument master from Angel One every day at 08:00. */
export const registerInstrumentSyncCron = () =>
  createCron(CRONJOBS.INSTRUMENT_SYNC, { hour: 8, minute: 0 }, async () => {
    await syncInstrumentMaster('cron');
  });
