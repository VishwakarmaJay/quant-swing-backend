import { deliverAlert, formatSignalAlert, resendUndelivered } from '@/delivery';
import { persistRun, runPipeline } from '@/pipeline';
import { prisma } from '@services/prisma';

/**
 * The nightly decision run: full pipeline → persist the versioned snapshot.
 * This is what the cron will call.
 *
 *   bun run signals:run          # ATR volatility proxy for regime
 *   bun run signals:run 22       # with a VIX of 22
 */
const run = async () => {
  const vixArg = process.argv[2];
  const vix = vixArg && vixArg !== 'na' ? Number(vixArg) : null;

  const result = await runPipeline(new Date(), { vix });
  await persistRun(result);

  // Flush any backlog first, then deliver today's alert (queues on failure).
  await resendUndelivered();
  const message = formatSignalAlert(result);
  const delivered = await deliverAlert(message, result.runId);

  console.log(`\nRun ${result.runId}`);
  console.log(`  regime ${result.regime} — ${result.regimeDetail}`);
  console.log(`  approved ${result.approved.length}, rejected ${result.rejections.length}`);
  console.log(
    `  versions: engine ${result.versions.engineVersion}, ${result.versions.weightsVersion}, ` +
      `${result.versions.factorConfigChecksum}, ${result.versions.instrumentMasterVersion}`,
  );
  console.log(`  delivered: ${delivered ? 'sent to Telegram' : 'logged (Telegram unconfigured or failed)'}`);
  console.log(`\n--- alert message ---\n${message}`);
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
