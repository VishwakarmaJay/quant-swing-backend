import { round } from '@/factors/indicators';
import type { PipelineRun } from '@/pipeline';

/**
 * Formats a pipeline run into an explainable Telegram message (legacy Markdown).
 * Pure and deterministic. Every signal shows entry band, stop (with %), targets,
 * sizing, and the composite/agreement scores; a no-signal run still reports the
 * regime and why nothing qualified.
 */

const inr = (n: number): string => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

const rejectionSummary = (run: PipelineRun): string => {
  const counts = new Map<string, number>();
  for (const r of run.rejections) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([reason, n]) => `${reason} ${n}`)
    .join(' · ');
  return top ? `Top reasons: ${top}` : '';
};

export const formatSignalAlert = (run: PipelineRun): string => {
  const lines: string[] = [
    `📊 *QuantSwing* — ${run.asOf}`,
    `Regime: *${run.regime}* — ${run.regimeDetail}`,
    '',
  ];

  if (run.approved.length === 0) {
    lines.push(`*No signals today* · ${run.rejections.length} candidates screened out`);
    const summary = rejectionSummary(run);
    if (summary) lines.push(summary);
    lines.push('', '_Silence is often the system working._');
    return lines.join('\n');
  }

  lines.push(`*${run.approved.length} signal${run.approved.length > 1 ? 's' : ''}* · ${run.rejections.length} rejected`, '');

  run.approved.forEach((s, i) => {
    const slPct = round(((s.entry - s.stopLoss) / s.entry) * 100, 2);
    lines.push(
      `*${i + 1}. ${s.symbol}* (${s.sector ?? '—'})  BUY`,
      `Entry ₹${inr(s.entryLow)}–₹${inr(s.entryHigh)} · Qty ${s.qty} (₹${inr(s.positionValue)})`,
      `SL ₹${inr(s.stopLoss)} (${slPct}%) · T1 ₹${inr(s.target1)} · T2 ₹${inr(s.target2)}`,
      `Composite ${s.compositeScore} · Agreement ${s.agreementScore}${s.sizeReduced ? ' · _size-reduced_' : ''}`,
      '',
    );
  });

  lines.push('⚠️ _Place orders manually. Not investment advice._');
  return lines.join('\n');
};
