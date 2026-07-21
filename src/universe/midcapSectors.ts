/**
 * Sector-label normalization for the Nifty Midcap 150 constituent snapshots
 * (Option-B spike, docs/MIDCAP_SPIKE.md). PURE.
 *
 * NSE's `Industry` taxonomy drifted across the 2021→2026 snapshots (case and
 * naming: "Power" vs "ENERGY", "IT" vs "Information Technology", "PHARMA" vs
 * "Healthcare"). Left as-is, the same business would split into several
 * SectorRelativeStrength peer groups and pollute the 1-per-sector cap, so every
 * raw label is folded to one canonical sector.
 */

/** Canonical sector for a raw NSE industry label (case-insensitive). */
export const normalizeMidcapSector = (raw: string): string => {
  const k = raw.trim().toUpperCase();
  const MAP: Record<string, string> = {
    'FINANCIAL SERVICES': 'Financial Services',
    'HEALTHCARE': 'Healthcare',
    'HEALTHCARE SERVICES': 'Healthcare',
    'PHARMA': 'Healthcare',
    'AUTOMOBILE': 'Auto',
    'AUTOMOBILE AND AUTO COMPONENTS': 'Auto',
    'INFORMATION TECHNOLOGY': 'IT',
    'IT': 'IT',
    'CONSUMER GOODS': 'FMCG',
    'FAST MOVING CONSUMER GOODS': 'FMCG',
    'CONSUMER SERVICES': 'Services',
    'SERVICES': 'Services',
    'CONSUMER DURABLES': 'Consumer Durables',
    'POWER': 'Power',
    'ENERGY': 'Power',
    'OIL GAS & CONSUMABLE FUELS': 'Oil & Gas',
    'METALS': 'Metals & Mining',
    'METALS & MINING': 'Metals & Mining',
    'CONSTRUCTION': 'Construction',
    'CONSTRUCTION MATERIALS': 'Construction Materials',
    'MEDIA & ENTERTAINMENT': 'Media',
    'MEDIA ENTERTAINMENT & PUBLICATION': 'Media',
    'INDUSTRIAL MANUFACTURING': 'Capital Goods',
    'CAPITAL GOODS': 'Capital Goods',
    'CHEMICALS': 'Chemicals',
    'REALTY': 'Realty',
    'TEXTILES': 'Textiles',
    'TELECOMMUNICATION': 'Telecom',
    'TELECOM': 'Telecom',
    'DIVERSIFIED': 'Diversified',
  };
  return MAP[k] ?? raw.trim(); // unknown labels pass through, reported by the ingest
};
