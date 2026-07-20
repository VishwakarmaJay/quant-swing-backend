import { env } from '@config/env';

import { DEFAULT_PORTFOLIO_CONFIG, type PortfolioConfig } from './types';

/**
 * Builds the PortfolioConfig from runtime env vars, so capital, limits and the
 * sizing model are set without code changes:
 *   PORTFOLIO_BASE_CAPITAL · PORTFOLIO_MAX_OPEN_POSITIONS · PORTFOLIO_MAX_PER_SECTOR
 *   PORTFOLIO_SIZING_MODE (risk | conviction) · PORTFOLIO_RISK_PCT
 * Anything unset falls back to DEFAULT_PORTFOLIO_CONFIG.
 */
export const portfolioConfigFromEnv = (): PortfolioConfig => ({
  ...DEFAULT_PORTFOLIO_CONFIG,
  baseCapitalPerTrade: env.PORTFOLIO_BASE_CAPITAL,
  maxOpenPositions: env.PORTFOLIO_MAX_OPEN_POSITIONS,
  maxPerSector: env.PORTFOLIO_MAX_PER_SECTOR,
  sizingMode: env.PORTFOLIO_SIZING_MODE,
  riskPctPerTrade: env.PORTFOLIO_RISK_PCT,
});
