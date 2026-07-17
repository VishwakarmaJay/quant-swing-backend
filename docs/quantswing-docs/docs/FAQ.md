# FAQ

**Does it place orders automatically?**
No. Signals go to Telegram; you place orders manually. By design (SEBI simplicity, bug safety).

**Why no ChatGPT/Claude in the pipeline?**
Cost (~₹9–12k/month at our article volume), non-determinism, hallucination risk.
FinBERT is local, free, deterministic, finance-trained.

**Will it make money?**
Unknown until proven. v1's goal is discipline + an auditable research loop. The
paper-trading gate requires beating Buy & Hold Nifty 50 risk-adjusted before live capital.

**Why long-only?**
Shorting needs F&O margin and a different risk profile — unfit for ₹5K.

**Can I change the weights/thresholds?**
Yes — everything is in config/default.yaml. But changes should follow the research protocol.

**Why did my favorite stock not get a signal?**
Check rejections table — every drop has a recorded reason (gate failed, sector cap,
quality skip, regime).

**Can I run it with more capital?**
Yes — capital rules are config. Re-derive sizing sanity (max-per-trade, sector caps) first.

**Backtest shows X% — is that real?**
Backtests exclude sentiment (no historical news archive yet) and carry survivorship
bias (documented). Treat as directional, not promised returns.
