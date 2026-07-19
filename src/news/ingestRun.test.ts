import { describe, expect, test } from 'bun:test';

import type { IngestSummary, SourceResult } from './ingest';
import { deriveIngestAlerts, formatIngestAlert, type PreviousRunView } from './ingestRun';

const NOW = new Date('2026-07-18T12:00:00Z');

const src = (over: Partial<SourceResult> & { source: SourceResult['source'] }): SourceResult => ({
  parsed: 50,
  inserted: 5,
  duplicates: 40,
  alreadyStored: 5,
  unmatched: 1,
  newestItem: '2026-07-18T11:45:00Z',
  error: null,
  ...over,
});

const summary = (perSource: SourceResult[], sentiment: IngestSummary['sentiment'] = { degraded: false, scored: 3, modelVersion: 'm@r' }): IngestSummary => ({
  fetchedAt: NOW,
  perSource,
  totals: { parsed: 100, inserted: 5, duplicates: 90, alreadyStored: 5, unmatched: 1 },
  unmatchedSample: [],
  sentiment,
});

const prev = (perSource: PreviousRunView['perSource'], sentimentDegraded = false, alerts: string[] = []): PreviousRunView => ({
  perSource,
  sentimentDegraded,
  alerts,
});

describe('deriveIngestAlerts — healthy run', () => {
  test('all sources fresh → ok, no alerts', () => {
    const d = deriveIngestAlerts(summary([src({ source: 'ET_MARKETS' }), src({ source: 'LIVEMINT' })]), null, NOW);
    expect(d.status).toBe('ok');
    expect(d.alerts).toEqual([]);
  });
});

describe('deriveIngestAlerts — two-consecutive rules (flap resistance)', () => {
  test('first failure stays quiet (degraded, no alert)', () => {
    const d = deriveIngestAlerts(
      summary([src({ source: 'ET_MARKETS' }), src({ source: 'LIVEMINT', error: 'fetch failed' })]),
      prev([
        { source: 'ET_MARKETS', parsed: 50, error: null },
        { source: 'LIVEMINT', parsed: 40, error: null },
      ]),
      NOW,
    );
    expect(d.status).toBe('degraded');
    expect(d.alerts).toEqual([]);
  });

  test('second consecutive failure alerts', () => {
    const d = deriveIngestAlerts(
      summary([src({ source: 'LIVEMINT', error: 'fetch failed' })]),
      prev([{ source: 'LIVEMINT', parsed: 0, error: 'fetch failed' }]),
      NOW,
    );
    expect(d.alerts).toHaveLength(1);
    expect(d.alerts[0]).toContain('LIVEMINT');
    expect(d.alerts[0]).toContain('second consecutive');
  });

  test('zero-parse alerts only on the second consecutive quiet run', () => {
    const current = summary([src({ source: 'BSE_ANNOUNCEMENTS', parsed: 0, newestItem: null })]);
    expect(deriveIngestAlerts(current, prev([{ source: 'BSE_ANNOUNCEMENTS', parsed: 30, error: null }]), NOW).alerts).toEqual([]);
    const second = deriveIngestAlerts(current, prev([{ source: 'BSE_ANNOUNCEMENTS', parsed: 0, error: null }]), NOW);
    expect(second.alerts).toHaveLength(1);
    expect(second.alerts[0]).toContain('parsed 0');
  });

  test('sidecar degraded alerts only on the second consecutive run', () => {
    const current = summary([src({ source: 'ET_MARKETS' })], { degraded: true, scored: 0, modelVersion: null });
    expect(deriveIngestAlerts(current, prev([{ source: 'ET_MARKETS', parsed: 50, error: null }], false), NOW).alerts).toEqual([]);
    const second = deriveIngestAlerts(current, prev([{ source: 'ET_MARKETS', parsed: 50, error: null }], true), NOW);
    expect(second.alerts).toHaveLength(1);
    expect(second.alerts[0]).toContain('sidecar');
    expect(second.status).toBe('degraded');
  });

  test('first run ever (no previous) never fires consecutive rules', () => {
    const d = deriveIngestAlerts(
      summary(
        [src({ source: 'ET_MARKETS' }), src({ source: 'LIVEMINT', error: 'fetch failed' })],
        { degraded: true, scored: 0, modelVersion: null },
      ),
      null,
      NOW,
    );
    expect(d.alerts).toEqual([]);
    expect(d.status).toBe('degraded');
  });
});

describe('deriveIngestAlerts — repeat suppression (page on onset, not every 15 min)', () => {
  test('a persisting condition stays in alerts but leaves newAlerts', () => {
    const current = summary([src({ source: 'ET_MARKETS' })], { degraded: true, scored: 0, modelVersion: null });
    const first = deriveIngestAlerts(current, prev([{ source: 'ET_MARKETS', parsed: 50, error: null }], true), NOW);
    expect(first.newAlerts).toHaveLength(1); // onset → page

    const second = deriveIngestAlerts(
      current,
      prev([{ source: 'ET_MARKETS', parsed: 50, error: null }], true, first.alerts),
      NOW,
    );
    expect(second.alerts).toHaveLength(1); // condition still recorded on the row
    expect(second.newAlerts).toEqual([]); // …but no repeat page
  });

  test('a condition that clears and re-triggers pages again', () => {
    const current = summary([src({ source: 'LIVEMINT', parsed: 35, newestItem: '2026-07-10T09:00:00Z' })]);
    const reonset = deriveIngestAlerts(current, prev([{ source: 'LIVEMINT', parsed: 35, error: null }], false, []), NOW);
    expect(reonset.newAlerts).toHaveLength(1);
  });
});

describe('deriveIngestAlerts — FROZEN detection (immediate)', () => {
  test('a feed with healthy counts but stale dates alerts on the first sighting', () => {
    const d = deriveIngestAlerts(
      summary([src({ source: 'LIVEMINT', parsed: 35, newestItem: '2026-07-10T09:00:00Z' })]),
      null,
      NOW,
    );
    expect(d.alerts).toHaveLength(1);
    expect(d.alerts[0]).toContain('FROZEN');
    expect(d.status).toBe('degraded');
  });

  test('fresh feed does not trip frozen', () => {
    const d = deriveIngestAlerts(summary([src({ source: 'LIVEMINT', newestItem: '2026-07-17T09:00:00Z' })]), null, NOW);
    expect(d.alerts).toEqual([]);
  });
});

describe('deriveIngestAlerts — status roll-up', () => {
  test('every source failed → failed', () => {
    const d = deriveIngestAlerts(
      summary([src({ source: 'ET_MARKETS', error: 'fetch failed' }), src({ source: 'LIVEMINT', error: 'fetch failed' })]),
      null,
      NOW,
    );
    expect(d.status).toBe('failed');
  });

  test('one of two failed → degraded', () => {
    const d = deriveIngestAlerts(
      summary([src({ source: 'ET_MARKETS' }), src({ source: 'LIVEMINT', error: 'fetch failed' })]),
      null,
      NOW,
    );
    expect(d.status).toBe('degraded');
  });
});

describe('formatIngestAlert', () => {
  test('compact markdown with status, bullets, totals', () => {
    const s = summary([src({ source: 'LIVEMINT', error: 'fetch failed' })]);
    const alerts = ['❌ LIVEMINT: fetch failed — second consecutive run'];
    const msg = formatIngestAlert({ status: 'degraded', alerts, newAlerts: alerts }, s);
    expect(msg).toContain('*News ingest DEGRADED*');
    expect(msg).toContain('• ❌ LIVEMINT');
    expect(msg).toContain('totals: 5 new / 100 parsed');
  });
});
