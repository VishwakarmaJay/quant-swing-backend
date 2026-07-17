# Glossary (Indian market terms)

| Term | Meaning | System handling |
|---|---|---|
| Upper/Lower circuit | Max daily price move limit hit | Sentiment hard override +0.95 / −0.95 |
| Promoter pledge | Promoter shares pledged as loan collateral | Negative fundamental signal; >20% soft flag |
| Bonus issue | Free additional shares to holders | Sentiment override +0.75 |
| QIP | Qualified Institutional Placement — capital raise | Dilutive; normalizer translates before FinBERT |
| Bulk deal | Large single institutional transaction | Normalized for FinBERT |
| T2T / BE / Z group | Trade-to-trade / restricted / non-compliant categories | Universe hard exclusion |
| FII / DII | Foreign / Domestic Institutional Investors | Flow trend = soft flag input |
| India VIX | NSE volatility index | Regime detection input |
| Bhavcopy | NSE end-of-day report incl. delivery % | v1.5 factor candidate |
| STT | Securities Transaction Tax | Part of transaction cost model |
| Symboltoken | Angel One numeric instrument ID | From instrument master JSON |
| Swing low | Lowest low over lookback window | SL structure anchor (15 candles) |
| ATR | Average True Range (14) | Stop distance driver |
| R:R | Risk:Reward ratio | Gate: ≥ 2.0 |
| MAE / MFE | Max Adverse/Favorable Excursion per trade | Dashboard metrics |
| Walk-forward | Rolling train→test backtest split | Overfitting guard |
