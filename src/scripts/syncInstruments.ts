import { syncInstrumentMaster } from '@services/instrumentMaster';
import { prisma } from '@services/prisma';

const run = async () => {
  const update = await syncInstrumentMaster('system');
  console.log(`Synced instrument master: stored ${update.stored} of ${update.fetched} scrips`);
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
