import { writeFileSync } from 'node:fs';

import { prisma } from '@services/prisma';

/**
 * Task 10 — outstanding data audit (read-only). Independent SQL checks over the
 * ohlcv archive plus a schema dump, for research-output/price_audit.txt.
 */
const run = async () => {
  const q = <T = unknown>(s: string) => prisma.$queryRawUnsafe<T[]>(s);
  const out: string[] = [];
  const log = (s: string) => {
    out.push(s);
    console.log(s);
  };

  log('# QuantSwing Price / Schema Audit');
  log(`# generated ${new Date().toISOString()}`);
  log('');

  // Scope: EQ universe only (the production universe).
  const eqIds = (await q<{ id: string }>(`SELECT id FROM instrument WHERE "instrumentType"='EQ'`)).map((r) => r.id);
  log(`EQ universe: ${eqIds.length} instruments`);
  const total = await q<{ n: bigint }>(`SELECT COUNT(*)::bigint n FROM ohlcv`);
  log(`ohlcv rows (all): ${total[0]!.n}`);
  log('');

  // 1. Duplicate (instrumentId, tradeDate) — should be 0 (composite PK).
  const dups = await q<{ instrumentId: string; tradeDate: string; c: bigint }>(
    `SELECT "instrumentId", "tradeDate", COUNT(*)::bigint c FROM ohlcv GROUP BY 1,2 HAVING COUNT(*)>1 LIMIT 50`,
  );
  log(`## 1. Duplicate (instrumentId, tradeDate) keys: ${dups.length}`);
  if (dups.length) for (const d of dups) log(`   ${d.instrumentId} ${d.tradeDate} ×${d.c}`);
  log('');

  // 2. OHLC consistency violations.
  const ohlc = await q<{ n: bigint }>(
    `SELECT COUNT(*)::bigint n FROM ohlcv WHERE high<low OR high<open OR high<close OR low>open OR low>close OR open<=0 OR high<=0 OR low<=0 OR close<=0`,
  );
  log(`## 2. OHLC consistency violations (high<low, out-of-range, non-positive): ${ohlc[0]!.n}`);
  const ohlcSample = await q<{ instrumentId: string; tradeDate: string; open: number; high: number; low: number; close: number }>(
    `SELECT "instrumentId","tradeDate",open,high,low,close FROM ohlcv WHERE high<low OR high<open OR high<close OR low>open OR low>close OR open<=0 OR high<=0 OR low<=0 OR close<=0 LIMIT 20`,
  );
  for (const s of ohlcSample) log(`   ${s.instrumentId} ${s.tradeDate} O${s.open} H${s.high} L${s.low} C${s.close}`);
  log('');

  // 3. Large one-day moves |return|>20% (EQ only), with count and a sample.
  const bigMoves = await q<{ n: bigint }>(`
    WITH r AS (
      SELECT "instrumentId","tradeDate",close,
             close/NULLIF(LAG(close) OVER (PARTITION BY "instrumentId" ORDER BY "tradeDate"),0)-1 AS ret
      FROM ohlcv WHERE "instrumentId" IN (SELECT id FROM instrument WHERE "instrumentType"='EQ')
    ) SELECT COUNT(*)::bigint n FROM r WHERE ABS(ret) > 0.20`);
  log(`## 3. EQ days with |1-day return| > 20%: ${bigMoves[0]!.n}`);
  const bigSample = await q<{ instrumentId: string; tradeDate: string; ret: number }>(`
    WITH r AS (
      SELECT "instrumentId","tradeDate",
             close/NULLIF(LAG(close) OVER (PARTITION BY "instrumentId" ORDER BY "tradeDate"),0)-1 AS ret
      FROM ohlcv WHERE "instrumentId" IN (SELECT id FROM instrument WHERE "instrumentType"='EQ')
    ) SELECT "instrumentId","tradeDate", ROUND(ret::numeric,4) ret FROM r WHERE ABS(ret) > 0.20 ORDER BY ABS(ret) DESC LIMIT 25`);
  log(`   top 25 by magnitude (likely splits/bonuses if unadjusted, or genuine limit moves):`);
  for (const s of bigSample) log(`   ${s.instrumentId} ${s.tradeDate} ret ${s.ret}`);
  log('');

  // 4. Stale-price runs: 3+ consecutive identical closes (EQ only).
  const stale = await q<{ n: bigint }>(`
    WITH s AS (
      SELECT "instrumentId","tradeDate",close,
             LAG(close) OVER w p1, LAG(close,2) OVER w p2
      FROM ohlcv WHERE "instrumentId" IN (SELECT id FROM instrument WHERE "instrumentType"='EQ')
      WINDOW w AS (PARTITION BY "instrumentId" ORDER BY "tradeDate")
    ) SELECT COUNT(*)::bigint n FROM s WHERE close=p1 AND close=p2`);
  log(`## 4. Stale-price runs (3+ consecutive identical closes), EQ anchor days: ${stale[0]!.n}`);
  log('');

  // 5. Schema dump — confirm no options / flow / pledge tables.
  const tables = await q<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`,
  );
  log('## 5. Public tables (schema dump):');
  log('   ' + tables.map((t) => t.table_name).join(', '));
  const suspicious = tables.filter((t) => /option|flow|pledge/i.test(t.table_name));
  log(`   options/flow/pledge tables: ${suspicious.length ? suspicious.map((t) => t.table_name).join(', ') : 'NONE'}`);
  log('');

  // 6. Date range + per-year row counts (EQ).
  const range = await q<{ mn: string; mx: string }>(`SELECT MIN("tradeDate")::text mn, MAX("tradeDate")::text mx FROM ohlcv`);
  log(`## 6. ohlcv date range: ${range[0]!.mn} → ${range[0]!.mx}`);

  writeFileSync('research-output/price_audit.txt', out.join('\n') + '\n', 'utf8');
  console.log('\nWrote research-output/price_audit.txt');
};

run()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
