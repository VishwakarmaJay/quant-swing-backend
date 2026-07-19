/**
 * Indian-news domain allowlist (ROADMAP B3.5 / GDELT_PRECISION_FIX S1).
 *
 * The GAL bulk downloader matched English news from *everywhere*, so single-word
 * company aliases collided with foreign homonyms ("Britannia" the Welsh bridge /
 * cruise ship / gold coin, "Lupin" the Netflix show, "Colgate" the US university,
 * "federal bank" the US crime). This allowlist restores the country constraint the
 * DOC API had (`sourcecountry:IN`): a GDELT article counts only if it comes from an
 * Indian outlet. Used by BOTH the download filter (`downloadGalArchive.ts`, so
 * future sweeps stay clean) and the in-place unmap (`fixGdeltDomains.ts`).
 *
 * Rule (precision-first — better to drop a few legit small-outlet Indian articles
 * than keep foreign noise): a domain is Indian if
 *   (a) it is under the `.in` ccTLD (`.in` / `.co.in` / `.org.in` …), OR
 *   (b) it matches (exact or subdomain of) a curated Indian `.com`/`.org`/`.net`
 *       outlet below.
 * Everything else — global aggregators (Yahoo Finance, marketscreener), wires
 * (PRNewswire, GlobeNewswire), entertainment, and all foreign local news — is out.
 * Note this deliberately drops legit foreign coverage of Indian stocks
 * (Reuters/Bloomberg/BBC on Reliance); the precision gate is worth that recall.
 */

/**
 * Curated Indian outlets that do NOT end in `.in` (the `.in` ones are matched by
 * the ccTLD rule). Base registrable domains; subdomains match automatically
 * (e.g. `auto.economictimes.indiatimes.com`, `mmb.moneycontrol.com`).
 * Grown from the live GDELT domain-frequency distribution (2026-07-19).
 */
export const INDIAN_NEWS_DOMAINS: readonly string[] = [
  // ── Business / financial ──
  'economictimes.indiatimes.com',
  'moneycontrol.com',
  'thehindubusinessline.com',
  'livemint.com',
  'financialexpress.com',
  'business-standard.com',
  'cnbctv18.com',
  'indiainfoline.com',
  'indiablooms.com',
  'equitybulls.com',
  'vccircle.com',
  'forbesindia.com',
  'dealstreetasia.com',
  'zeebiz.com',
  'domain-b.com',
  'biospectrumindia.com',
  'petrowatch.com',
  // ── General news ──
  'timesofindia.indiatimes.com',
  'indiatimes.com',
  'thehindu.com',
  'ndtv.com',
  'news18.com',
  'indianexpress.com',
  'newindianexpress.com',
  'hindustantimes.com',
  'rediff.com',
  'dnaindia.com',
  'tribuneindia.com',
  'zeenews.india.com',
  'india.com',
  'indiatvnews.com',
  'jagranjosh.com',
  'deccanchronicle.com',
  'deccanherald.com',
  'thestatesman.com',
  'siasat.com',
  'sakshipost.com',
  'firstpost.com',
  'outlookindia.com',
  'mid-day.com',
  'timesnownews.com',
  'oneindia.com',
  'prokerala.com',
  'newkerala.com',
  'udaipurkiran.com',
  'webindia123.com',
  'dailyexcelsior.com',
  'centralchronicle.com',
  'orissadiary.com',
  'orissapost.com',
  'pragativadi.com',
  'thehitavada.com',
  'sentinelassam.com',
  'theshillongtimes.com',
  'morungexpress.com',
  'nagalandpost.com',
  'kashmirreader.com',
  'kashmirlife.net',
  'rashtranews.com',
  'latestly.com',
  'siliconindia.com',
  'chennaionline.com',
  'mangalorean.com',
  'mathrubhumi.com',
  'dailypioneer.com',
  'devdiscourse.com',
  // ── Media / tech / sector trade (Indian) ──
  'barandbench.com',
  'medianama.com',
  'adgully.com',
  'afaqs.com',
  'bestmediainfo.com',
  'yourstory.com',
  'fonearena.com',
  'infotechlead.com',
  'telecomlead.com',
  'technuter.com',
  'greentechlead.com',
  'themobileindian.com',
  'franchiseindia.com',
  'magicbricks.com',
  'organiser.org',
  'openthemagazine.com',
  'gulte.com',
  'bilkulonline.com',
  'newstodaynet.com',
  'cobrapost.com',
  'rozanaspokesman.com',
  'educationtimes.com',
  'theindianawaaz.com',
  // ── Auto (Indian) ──
  'rushlane.com',
  'zigwheels.com',
  'team-bhp.com',
  'autocarindia.com',
  'carandbike.com',
  'cartrade.com',
  'indianautosblog.com',
];

const CURATED = new Set(INDIAN_NEWS_DOMAINS);

/**
 * Extracts the bare host from a URL: strips scheme, `www.`, any path/query, and a
 * trailing `:port` (GAL stores some as `autocarindia.com:443`). Lowercased.
 */
export const domainOf = (url: string): string => {
  let host = url.trim().toLowerCase();
  host = host.replace(/^https?:\/\//, '').replace(/^www\./, '');
  host = host.split('/')[0]!.split('?')[0]!.split(':')[0]!;
  return host;
};

/**
 * True when a URL's host is an Indian news outlet (see module rule). Subdomain-safe
 * and boundary-safe: `auto.economictimes.indiatimes.com` matches, `xindia.com` does
 * NOT match `india.com`.
 */
export const isIndianNewsDomain = (url: string): boolean => {
  const host = domainOf(url);
  if (!host) return false;
  if (host === 'in' || host.endsWith('.in')) return true; // .in / .co.in / .org.in …
  for (const base of CURATED) {
    if (host === base || host.endsWith(`.${base}`)) return true;
  }
  return false;
};
