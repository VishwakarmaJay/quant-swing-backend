import { env } from '@config/env';

/** NSE cash session: 09:15–15:30 IST, Mon–Fri (same math as the frontend helper). */
export const isMarketOpen = (d: Date = new Date()): boolean => {
  const ist = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  const mins = ist.getHours() * 60 + ist.getMinutes();
  return day >= 1 && day <= 5 && mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
};

/**
 * Whether OMS activity (placement, chase) is allowed right now. With
 * enforcement off (default), the Paper broker trades around the clock.
 */
export const isTradingAllowed = (d: Date = new Date()): boolean =>
  env.ENFORCE_MARKET_HOURS === 'true' ? isMarketOpen(d) : true;
