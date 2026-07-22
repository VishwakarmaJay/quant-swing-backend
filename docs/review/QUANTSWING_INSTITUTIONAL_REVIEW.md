# QuantSwing — Institutional Research Review

**Reviewer framing:** allocator due-diligence on a $100M mandate. Verdict-first, no flattery.

---

## 0. The verdict up front

**I would not allocate. I would hire the person who built it.**

The engineering is genuinely better than what I see inside most mid-sized funds. The research is not research — it is a scoring rubric that was never fit to anything, evaluated with an estimator that cannot detect what it is looking for, on a portfolio too concentrated to express a signal even if one existed.

**The single most important finding of this review:**

> Your research program was **statistically underpowered by construction**. Every "negative" result you recorded is equally consistent with *"there is no edge"* and *"there is a real edge, and this design cannot see it."* You have not falsified the alpha hypothesis. You have failed to test it.

Six independent negatives sound overwhelming. They are not independent — they all ran through the same three broken primitives: the wrong label, the wrong portfolio, and the wrong estimator. Six studies sharing one flawed measurement layer is one study repeated six times.

This is not a consolation prize. It is a *stronger* claim than the one your docs make, and it is testable.

---

## 1. Architecture Review

### Subsystem scores

| Subsystem | Score | Assessment |
|---|---|---|
| Determinism & reproducibility | **9.5/10** | Golden gate, version stamps, `weightsVersion`/`factorConfigChecksum`/`aliasVersion`. Better than most funds. |
| Data ingestion (news) | **8/10** | Bronze layer, content-SHA dedup, PIT `availableAt`/`origin`, FROZEN detector. Genuinely professional. |
| Data ingestion (price) | **6/10** | Single vendor (Angel One) + bhavcopy. No redundancy, no cross-vendor reconciliation, no tick data. |
| Point-in-time discipline | **9/10** | `announcedAt` for fundamentals, `availableAt` for news, index-exit vs delist trap caught. Exemplary. |
| Factor layer | **7/10 engineering / 3/10 finance** | Pure, testable, composable. But they are *rubric components*, not forecasts. |
| Strategy layer | **4/10** | Hand-weighted linear score + boolean gates. Not a model. |
| Portfolio construction | **1.5/10** | 2 slots. See §8 — this is the fatal subsystem. |
| Risk management | **2/10** | ATR stops and a daily loss cap. No risk model, no covariance, no factor exposure control. |
| Backtest engine | **7/10** | As-of replay, entries-before-exits, cost model, walk-forward, embargo. Solid mechanics. |
| Statistical layer | **3/10** | No multiple-testing correction, no PBO/DSR, no power analysis, no effective-sample-size adjustment. |
| Observability / ops | **8.5/10** | `ingest_run`, Telegram paging, S3 + CRR backups, verified restores. |
| Execution / market impact | **1/10** | Fixed 5bps + 0.05%. No participation model, no capacity analysis, no impact curve. |

### Architectural weaknesses

**1. There is no risk model.** This is the largest structural gap. Every institutional platform has a factor risk model (covariance matrix, factor exposures, specific risk) sitting between alpha and portfolio construction. You have alpha → sizing. Without it you cannot neutralize, cannot budget risk, cannot attribute P&L to factor vs specific, and cannot tell whether your returns are alpha or beta. Your own horizon study discovered this empirically ("the right tail is market beta") and treated it as a finding rather than as a missing subsystem.

**2. Alpha research and trade construction are fused.** The signal, the entry band, the stop, the targets, the time-stop and the thesis-break all live in one pipeline and are evaluated jointly. This means you can never answer "does the signal predict returns?" independently of "are my exits good?" Institutional platforms separate these into **forecast → portfolio → execution**, each measured with its own metrics. Yours cannot be decomposed.

**3. The universe is a hardcoded artifact.** 166 names in a committed TypeScript file. A research platform needs a *universe service* with liquidity screens, PIT membership, and configurable breadth — you built a fixed list and then discovered survivorship problems downstream.

**4. No feature store / no label store.** Features are computed inline per backtest run. There is no persisted, versioned panel of `(date, symbol, feature, value)` and no separate `(date, symbol, horizon, label)` table. This is why every study required a full replay and why cross-study comparison is hard. A `parquet`/columnar panel would let you run a hundred hypotheses in the time one costs you now.

**5. Single-node, in-memory backtest.** Fine at 166 × 5.5yr. Will not survive 1,500 names × 15yr × 200 features.

**What is genuinely excellent and should be preserved:** the determinism creed, the version stamping, the "every rejection has a reason" discipline, the Bronze layer, the point-in-time religion, and — most of all — the documented culture of retracting your own claims. That last one is rarer and more valuable than everything else combined.

---

## 2. Research Methodology Review

### Hypothesis generation — **4/10**
Hypotheses were generated by *availability* ("what free data can I get?") rather than by *economic mechanism* ("what structural inefficiency should exist, who is on the other side, and why does it persist?"). Delivery %, event typing, and horizon extension are all data-first fishing. The one exception is PEAD (Option C), which is mechanism-first — and notably it's the one you identified as highest-odds.

**A real hypothesis has four parts:** the inefficiency, the economic agent creating it, why it isn't arbitraged away, and the decay horizon. None of your six studies stated all four before running.

### Feature engineering — **3/10**
See §6. Every feature is a univariate transform of a single stock's own price history, mapped to 0–100 by hand-chosen piecewise-linear rules. There are no interactions, no cross-sectional normalization, no residualization, no conditioning variables, no temporal structure. The 0–100 clamping is actively harmful: it discards magnitude information exactly in the tails where the information lives.

### Walk-forward validation — **6/10**
Mechanically correct: expanding folds, embargo, anchored to coverage era. **But you are walk-forwarding over a discrete menu of ~8 hand-built configs.** That is model *selection*, not model *fitting*, and it means:
- Your OOS estimate is biased upward by the selection itself (you report the winner's OOS, which is a max-statistic).
- With 8 configs × 4 folds × 2 tiers you have ~64 comparisons and no correction.
- "Selected on all 4 folds × both tiers" is presented as robustness. With 8 candidates and correlated folds, unanimous selection is far weaker evidence than it appears.

### Survivorship — **8/10**
The best-executed piece of research in the project. You found the "blocked" premise was false, triaged 116 names by ISIN, caught the delist-date-vs-index-exit-date trap (which had made results look *better*), and reported the honest −4.4pp. This is institutional-quality work. **Residual:** ±1 reconstitution imprecision, and only 10 delisted names ingested — the true dead-name tail across 5.5 years of the full market is larger.

### Point-in-time correctness — **9/10**
Excellent. `availableAt` vs `publishedAt`, `announcedAt` vs `periodEnd`, midnight cutoff excluding same-day news, `origin` tiering for reconstructed availability. Two gaps: (a) fundamental *restatements* — do you capture that a number was later revised? (b) index membership at ±1 reconstitution.

### Lookahead prevention — **8.5/10**
Structurally enforced (`candles ≤ asOf`, entries-before-exits, strictly-before delivery baseline). The RELINFRA trap catch shows the discipline is real and not just claimed.

### Statistical testing — **2/10**
This is the weakest section of the entire program.

- **No multiple-testing correction.** You ran 6+ study families, each with grids. The literature standard (Harvey, Liu & Zhu 2016, *"…and the Cross-Section of Expected Returns"*) is that with the number of trials run across a research program, a t-stat of **3.0+** is the minimum bar for a new factor, not 2.0.
- **No Deflated Sharpe Ratio** (Bailey & López de Prado) — adjusts observed Sharpe for number of trials, sample length, skew and kurtosis.
- **No Probability of Backtest Overfitting (PBO)** via combinatorially-symmetric cross-validation.
- **No power analysis.** Nowhere do you ask "given my design, what effect size could I detect?" Had you asked, the program would have stopped at §3's finding on day one.
- **No effective-sample-size adjustment.** 4,394 trades across 166 names that share a market factor is *not* 4,394 independent observations. With pairwise correlation ρ̄ ≈ 0.4–0.5 typical for Indian large caps, effective independent observations are closer to **the number of trading days than the number of trades** — call it low hundreds, not thousands. Every t-statistic in the program is materially overstated.
- **No confidence intervals on the headline numbers.** "−0.04%/trade, PF 0.97" is reported as a point estimate. Its 95% CI almost certainly spans zero comfortably in both directions. You may have *positive* edge and not know it.

### Reproducibility — **9.5/10**
Best in class. Version stamps on config, weights, factors, aliases, sentiment model, event extractor. Golden determinism gate. Content-addressed raw capture. I have seen $2B funds with worse.

### Would this pass institutional research standards?

**Data engineering: yes, comfortably.** **Research methodology: no.** It would fail at the first quant committee on three grounds: no risk model, no multiple-testing framework, and a research design with no power to detect its target effect size.

---

## 3. Alpha Review — why no edge was found

This is the section that matters. I'll take each candidate cause and give a verdict.

### 3.1 THE PRIMARY CAUSE — insufficient breadth, i.e. no statistical power

**The Fundamental Law of Active Management** (Grinold): `IR ≈ IC × √Breadth`

Your parameters:
- Realistic cross-sectional IC for a good equity signal: **0.02–0.05**
- Concurrent positions: **2**
- Holding period: 7 days → ~36 rebalances/year
- Breadth ≈ 2 × 36 = **72 bets/year** (and *less* than that in effect, since both positions share market beta)

`IR ≈ 0.03 × √72 ≈ 0.25`

Now the detection question. To reject "Sharpe = 0" at 95% confidence you need roughly `t = SR × √T ≥ 2`, so `T ≥ (2/0.25)² = 64 years`.

> **You have 5.5 years. You needed ~64. Your portfolio design was ~12× short of the data required to detect a genuinely good signal.**

Contrast with 50 concurrent positions: breadth ≈ 1,800, `IR ≈ 0.03 × √1800 ≈ 1.27`, and `t ≈ 1.27 × √5.5 ≈ 3.0` — **detectable in the data you already have.**

This single design choice invalidates the portfolio-level conclusion of every study you ran. And it directly explains B11: **"random beats the composite ranking at 2 slots"** is the *expected* result when concentration is that high, whether or not the ranking has IC. Your conclusion — *"the bottleneck is signal quality, not allocation"* — is very likely backwards. At 2 slots you had no power to distinguish any ranking from random. B11 measured your portfolio's noise floor, not your signal's quality.

**The per-trade tests are better powered** (981 / 4,394 trades) — but they use the wrong label (§3.3) and don't adjust for cross-sectional correlation, so their effective n is a fraction of nominal.

### 3.2 Wrong objective — you optimized a strategy, not a forecast

You never defined a prediction target. There is no `y`. The composite is a rubric that was hand-weighted and then *selected* among variants — nothing was ever *fit* to forward returns.

`ρ ≈ 0 for every factor and the composite` is therefore not a finding about markets. **It is the expected outcome of scoring without fitting.** You built a scoring function and then discovered it doesn't correlate with returns. It was never constructed to.

### 3.3 Wrong label — the dependent variable is contaminated by exit logic

Your unit of analysis is *per-trade net return after SL / T1 / T2 / time-stop / thesis-break*. That is a **path-dependent function of your own exit rules**, not a measure of predictive content.

Consequences:
- A signal with real forward-return predictive power can show zero per-trade expectancy if stops truncate it (your exits stop out ~242/981 and time-stop 539/981 — the distribution is being *shaped* by the exit policy, not by the signal).
- You cannot compare hypotheses cleanly, because changing the signal changes which trades survive to be measured.
- Your sweep concluded "the problem is entries, not exits" — but that inference is only valid if the label is exit-independent. It isn't.

**The correct label:** forward return over horizon *h*, cross-sectionally demeaned, ideally residualized against market/sector/size/momentum. Then optimize execution separately.

### 3.4 Wrong return space — absolute, not residual

Everything is long-only, absolute-return, in a market with a dominant beta. Your only beta-aware factor is RS-vs-Nifty (raw excess, not beta-adjusted).

Your horizon study literally found *"the right tail does appear but most of it is market beta."* That is not a finding about the horizon — **that is the diagnostic that you are measuring in the wrong space.** In an absolute-return framework, beta swamps alpha and no amount of horizon tuning fixes it.

The correct research object: does the signal rank stocks cross-sectionally **after removing market, sector, size, value and momentum exposure**? You have never asked this question.

### 3.5 Wrong horizon — the 2–7 day dead zone

2–7 days is the single most competitive, least structurally-inefficient window in equities:
- **Too slow** for microstructure/liquidity-provision edges (< 1 day)
- **Too fast** for fundamental repricing (1–12 months)
- **Maximally crowded** — retail momentum systems, prop desks, and every retail algo platform in India (Streak, Tradetron) operate exactly here

Documented persistent anomalies cluster at **<1 day** (order flow, reversal, overnight) and **1–12 months** (PEAD, value, quality, momentum, revisions). You picked the trough.

### 3.6 Insufficient universe

166 large caps is too small for cross-sectional work *and* is the most efficiently priced segment. Cross-sectional methods need breadth in the *name* dimension: Nifty 500 minimum, ideally all NSE names above a turnover floor (~₹5–10 Cr ADV) → 700–1,000 names.

**Your midcap spike does not refute this.** It applied the *large-cap-tuned config* to midcaps. That tests **transfer**, not **midcap alpha**. Those are different hypotheses, and your own doc concedes the config wasn't re-tuned and the ff50/sf50 floors read neutral (so the effective strategy was a 3-factor stub). The correct experiment — fit fresh on a wide universe with proper labels — has not been run.

### 3.7 Over-constrained strategy

Count the constraints you imposed *before* measuring anything: long-only · 2 positions · 1 per sector · 7-day exit · ATR stops · 2R/3R targets · composite ≥ 65 · technical floor 60 · MACD>0 · price>EMA20 · RSI 35–68 · R:R ≥ 1.5 · ATR < 6% · cost-drag 3×.

That is **~14 hard constraints** on a signal you had never verified had any information. Each one destroys sample and truncates the return distribution. You constrained first and measured second. The order should be reversed: measure the raw predictive content, *then* add constraints and price each one's cost in IC.

### 3.8 Factor crowding — partially valid

Trend/EMA-stack, MACD, RSI, and 60-day RS are the four most widely-implemented retail signals in existence, available in every charting package. Whatever edge they carried was arbitraged decades ago. Your factors aren't orthogonal to the crowd — **they are the crowd.**

But note: they are also mutually collinear. Trend, Momentum and RS all load on the same underlying price-trend factor. Your "4-factor composite" has an effective rank of roughly **1.5**. Diversification across correlated features buys nothing.

### 3.9 Efficient markets — the weakest explanation

Indian equities are *not* efficient enough to justify this conclusion. The market is retail-heavy, has documented PEAD, documented promoter-pledge effects, structural F&O flows, quarterly index rebalancing with predictable flow, and disclosure asymmetries. Emerging-market anomaly literature consistently finds *larger* factor premia than developed markets.

**The EMH explanation is not supported.** Your setup would have failed to detect a *known, published, live* anomaly. Which brings me to the test I most want you to run:

### 3.10 THE FALSIFICATION TEST — run this before anything else

> Implement a **known-positive control**: 12-1 cross-sectional momentum, or Piotroski F-score, or 1-week reversal — anomalies with decades of published evidence including in Indian equities. Run them through **your existing pipeline, your labels, your 2-slot portfolio, your gates.**
>
> - **If the known anomaly also shows ρ ≈ 0 and fails the gate** → your *measurement apparatus* is broken, and none of your six negatives mean what you think. This is my strong prior.
> - **If it shows clean positive IC and beats the benchmark** → your pipeline is sound, and your factors genuinely lack edge.

This is a one-week experiment. It is the highest-information thing you can do, and its absence is the biggest hole in the research program. **No institutional platform ships without positive controls.**

### 3.11 Sentiment implementation is measuring the wrong quantity

Your sentiment factor computes a **recency-weighted mean level** of FinBERT headline scores. The literature (Tetlock 2007; Tetlock, Saar-Tsechansky & Macskassy 2008; Loughran & McDonald 2011) is consistent that what predicts returns is:
- **Abnormal** tone — deviation from that stock's own baseline, not the raw level
- **Abnormal coverage volume** — attention shocks
- **Novelty vs staleness** — Tetlock (2011) shows *stale* news predicts reversal
- **Unexpectedness** relative to a prior

You compute a level. Levels are priced. Surprises are not. Additionally: FinBERT is trained on US financial text; India-specific idiom is only partially handled by your normalizer; headline-only scoring loses the body; and there's no source-credibility weighting or entity-salience weighting (your own docs flag "mention ≠ subject").

---

## 4. Missing Data

Ordered by **expected edge ÷ (cost × complexity)**. India-specific where possible — this is where you have a genuine home-field advantage that a US fund doesn't.

### Tier 1 — free, India-specific, genuinely orthogonal (build these first)

| Dataset | Source | Expected edge | Complexity | Cost | Evidence |
|---|---|---|---|---|---|
| **FII/DII daily cash flows** | NSE/SEBI, free | Medium-high. Foreign flows drive Indian large-cap returns; flow persistence + reversal are documented | Low | ₹0 | Strong EM literature on foreign flow price impact (Froot/O'Connell/Seasholes) |
| **Participant-wise F&O OI** (FII/DII/Client/Pro) | NSE, free daily | **High.** Positioning extremes → reversal; client-vs-FII divergence is a smart-vs-dumb-money proxy | Low-med | ₹0 | Commitment-of-Traders literature; India-specific studies show client positioning is contrarian-predictive |
| **Promoter pledge % changes** | BSE/NSE shareholding patterns, quarterly | **High.** Pledge increases predict distress and negative drift in India specifically | Low | ₹0 | Documented in Indian markets; structurally under-researched |
| **Shareholding pattern deltas** (FII/DII/MF/promoter) | BSE/NSE quarterly | Medium-high. Institutional accumulation predicts drift | Medium | ₹0 | Ownership-change literature (Chen/Jegadeesh/Wermers) |
| **Bulk & block deals** | NSE/BSE daily, free | Medium. Informed-block follow-through | Low | ₹0 | Block-trade information content well documented |
| **Options chain: OI, IV, skew** | NSE, free (scrape) | **Very high.** IV skew is the best-documented single-name crash predictor | Medium | ₹0 | Xing/Zhang/Zhao (2010); Cremers-Weinbaum put-call parity deviation |
| **Credit rating actions** | CRISIL/ICRA/CARE, free | Medium. Post-rating-change drift | Low | ₹0 | Dichev-Piotroski; Hand/Holthausen/Leftwich |
| **Index rebalancing announcements** | NSE, free (you have tooling) | Medium-high, capacity-limited | Low | ₹0 | Shleifer (1986), Harris-Gurel; India rebalances semi-annually with predictable flow |
| **F&O ban list / securities in ban** | NSE daily | Medium. Forced-deleveraging events | Very low | ₹0 | India-specific structural effect, under-researched |
| **MF monthly portfolio disclosures** | AMFI/AMC, free | Medium. Crowding + front-running of predictable flows | Medium-high (parsing) | ₹0 | Coval-Stafford fire-sale literature |
| **Securities Lending & Borrowing (SLB)** | NSE, free | Medium. Short-interest proxy | Low | ₹0 | Short interest is among the most robust negative predictors globally |

### Tier 2 — paid, high prior

| Dataset | Expected edge | Complexity | Cost (India, indicative) | Evidence |
|---|---|---|---|---|
| **PIT consensus estimates + revisions** | **Highest of any single dataset.** Unlocks SUE/PEAD *and* revision momentum — two separate documented anomalies | Medium (you're 90% built) | ₹10k–₹1L/yr retail (Trendlyne/Tijori — **must verify PIT**); LSEG I/B/E/S is gold standard at enterprise pricing | Ball-Brown (1968), Bernard-Thomas (1989); Chan-Jegadeesh-Lakonishok (1996) for revisions. Confirmed in Indian equities. |
| **Analyst dispersion** | Medium-high. High dispersion → underperformance | Low (comes with estimates) | bundled | Diether-Malloy-Scherbina (2002) |
| **Intraday tick / order book** | High but different game (<1 day) | Very high | ₹1–5L/yr+ | Order flow imbalance, Kyle's lambda |
| **Earnings call transcripts** | Medium-high. Tone, uncertainty, evasiveness in Q&A | Medium-high (NLP) | ₹low-lakhs or scrape | Loughran-McDonald; Hassan et al. political-risk measure |
| **Corporate guidance** | Medium. Guidance revisions predict drift | Medium | bundled | Guidance literature |

### Tier 3 — lower priority for your context

Satellite/geolocation, credit-card panels, web-scraped pricing, app-download data — high cost, poor India coverage, weak fit to a 166–500 name large/mid-cap universe.

### The single recommendation

**Do Tier 1 first, not Option C.** Your docs frame consensus estimates as the only remaining lever. That's wrong — you have **eleven free, orthogonal, India-specific datasets** you have never touched, several with better documented effects than PEAD. Options IV skew, participant OI, and promoter pledge alone are a year of legitimate research at zero data cost. Buy estimates *after* you've proven the rebuilt pipeline can detect a known anomaly.

---

## 5. Missing Machine Learning

### Should you abandon deterministic weighted scoring? **Yes — but not for the reason you'd expect.**

The problem with your composite isn't that it's not ML. It's that **it was never fit to anything.** A hand-weighted linear score is a perfectly respectable model *if the weights are estimated from data with proper cross-validation.* Yours were chosen by intuition and then selected from a menu of 8.

**Do not jump to deep learning.** The correct sequence:

### Stage 1 — Linear, cross-sectional (do this first, months 1–3)
**Fama-MacBeth regressions** and **cross-sectional ridge** on residualized forward returns. Why first:
- If IC isn't there linearly, gradient boosting almost never rescues it — it usually just overfits faster.
- Gives you interpretable factor premia and t-stats you can defend.
- Establishes the IC baseline every later model must beat.

### Stage 2 — Gradient boosting (months 4–8)
**LightGBM** (preferred over XGBoost for speed on wide panels; CatBoost if you have high-cardinality categoricals like sector/industry). Non-negotiable accompaniments:
- **Purged K-fold CV with embargo** (López de Prado, *Advances in Financial Machine Learning*, ch. 7) — standard K-fold leaks catastrophically on overlapping-horizon financial labels
- **Sample uniqueness weighting** — overlapping 7-day labels mean observations aren't independent; weight by concurrency
- **Feature importance via MDA on purged folds**, not in-sample gain (which is badly biased)

### Stage 3 — Learning-to-Rank (months 6–10)
**LambdaMART / LambdaRank.** This is the *correct objective for your problem* and almost nobody outside institutional quant uses it. You don't need to predict return magnitude — you need to **rank** stocks to pick the top decile. Optimizing NDCG@k directly on the ranking objective consistently beats regression-then-sort. Given your portfolio picks the top few names, this is a natural fit.

### Stage 4 — Meta-labelling (do this early, it's cheap)
López de Prado's meta-labelling is **directly aimed at your exact situation**. Your own finding — *"every lever trims the left tail; nothing identifies winners"* — is the textbook signature of a primary model with acceptable recall but poor precision. Meta-labelling:
- Keep your existing rubric as the **primary model** (determines side/candidacy)
- Train a **secondary binary classifier** on "given this signal fired, will it be profitable?"
- Use secondary model's probability for **position sizing**

Your fundamental and sentiment *floors* are hand-built meta-labels. A fitted meta-model would do that job far better and give you calibrated sizing instead of a binary gate.

### Stage 5 — Bayesian / hierarchical (months 9+)
**Hierarchical Bayesian models** for pooling across sectors with small per-sector samples, and for producing honest posterior intervals on factor premia rather than point estimates. Also gives you a principled shrinkage prior — critical when you have 200 features and 5 years of data.

### What to skip, and why

| Method | Verdict | Reason |
|---|---|---|
| **Reinforcement Learning** | **Skip.** | Needs millions of episodes; financial data is non-stationary and sample-poor. Nearly every published RL-trading result fails OOS. RL for *execution* (optimal order placement) is legitimate — but that's a different problem you don't have yet. |
| **Graph Neural Networks** | **Later (months 12+).** | Genuinely interesting for supply-chain and ownership networks (§11 #47–49), but you must first build the graph data, which doesn't exist for India. Not a starting point. |
| **Transformers** | **Skip for cross-section.** | Attention over what? You have ~250 obs/year/name. Transformers need scale you don't have. Useful only for the NLP layer (replacing FinBERT), not for return prediction. |
| **Time-series foundation models** (TimeGPT, Chronos, Moirai) | **Skip.** | Unproven for cross-sectional equity alpha. They forecast univariate series; your problem is cross-sectional ranking. Category error. |
| **Deep learning generally** | **Not yet.** | Empirically, on tabular cross-sectional equity panels, GBDT ≥ NN in almost all published comparisons (Gu, Kelly & Xiu 2020 find NNs help, but with 60 years × 30,000 stocks — you have 5.5 years × 166). |

### The honest ML caveat

ML will **not** create alpha from features that have none. Your features currently have no demonstrated information content. Running LightGBM on Trend/Momentum/RSI/Volume will produce a beautifully overfit model with an impressive in-sample Sharpe and zero OOS edge. **Fix the data and the labels first; ML is stage two, not stage one.**

---

## 6. Feature Engineering Review

### What's wrong with the existing eight

| Issue | Detail |
|---|---|
| **0–100 clamping destroys information** | `clamp(excess/20, −1, 1)` throws away everything beyond ±20% — precisely the tail where information concentrates. Never clamp before modelling; let the model see the raw distribution. |
| **Piecewise-linear hand-mapping** | Volatility's 100/0/linear-between is an arbitrary functional form. Let the model learn the shape. |
| **No cross-sectional normalization** | Every factor is computed per-stock in absolute terms. Cross-sectional z-scoring or ranking within each date is standard and is the difference between a signal and a description. SectorRS is your only cross-sectional feature — and notably it's the only one that helped. **That is a very loud hint you ignored.** |
| **No residualization** | No feature is orthogonalized against market beta, size, sector, or against the other features. Trend/Momentum/RS have effective rank ~1.5. |
| **No interactions** | Momentum conditional on volatility regime, value conditional on quality, sentiment conditional on liquidity — all documented, all absent. |
| **No temporal structure** | No feature captures *change* in a signal — only levels. Δfactor is often more predictive than the level (this is exactly why "revision momentum" beats "estimate level"). |
| **No conditioning on stock characteristics** | Same rules applied to a ₹5L Cr FMCG name and a ₹10k Cr cyclical. Normalization by liquidity/size/beta is standard. |

### Missing feature families

**1. Cross-sectional (highest priority)**
Every feature should have a cross-sectional-rank twin: rank within universe, rank within sector, rank within size bucket, rank within liquidity bucket. Your SectorRS result is direct evidence this family works for you.

**2. Residual / risk-adjusted**
Residual momentum, residual volatility, idiosyncratic vol, beta-adjusted returns, alpha vs a 4-factor model. Removes the beta contamination your horizon study identified.

**3. Change / acceleration (Δ features)**
Δ margin, Δ estimates, Δ pledge, Δ ownership, Δ OI, Δ short interest, Δ analyst count, Δ coverage volume. Second derivatives too — momentum-of-momentum.

**4. Surprise / abnormal features**
Every level should have an "abnormal" version: `(x − rolling_mean(x)) / rolling_std(x)`. Abnormal volume, abnormal turnover, abnormal coverage, abnormal spread, abnormal delivery. **Your delivery-surge feature was constructed correctly this way — and it was your best-designed feature.** Generalize the pattern.

**5. Regime-conditional**
Interact every feature with: VIX bucket, market trend, breadth, dispersion, correlation regime, term structure. Your regime work stopped at "which regime am I in" instead of "how does each factor's payoff vary by regime."

**6. Interaction terms**
Explicitly: momentum × idiosyncratic vol (Barroso-Santa Clara), value × quality (Asness), sentiment × liquidity, size × illiquidity, PEAD × analyst coverage (drift is stronger where coverage is thin).

**7. Temporal / seasonality**
Day-of-week, turn-of-month, days-to/from earnings, days-to-expiry, index rebalance proximity, budget-day proximity, Muhurat. Earnings-proximity is genuinely predictive (earnings announcement premium).

**8. Network / relational**
Supply chain, ownership overlap, sector-peer lead-lag, promoter-group linkage. India has visible business groups (Tata, Adani, Reliance, Birla) — intra-group information transmission is a real, under-researched effect.

**9. Liquidity / microstructure**
Amihud illiquidity, turnover, spread proxies (Corwin-Schultz from high/low), Roll's implied spread, volume clustering.

---

## 7. Strategy Review

### Would an institutional fund trade this? **No. Categorically.**

Not because it loses money — because it isn't a strategy in the institutional sense. It's a signal generator wired to a 2-position discretionary alert.

**Disqualifiers:**

1. **No capacity.** 2 positions × ₹1L = zero AUM capacity. There's no scaling path.
2. **No risk model or exposure control.** Unknown factor exposures, uncontrolled beta, no ex-ante risk forecast.
3. **Long-only in a beta-dominated market** means returns are ~90% market. An allocator gets that for 5bps from an index fund.
4. **Manual execution.** Not systematic. Unmodelable slippage, unauditable discipline.
5. **No capacity/impact analysis.** Fixed 5bps slippage regardless of size or liquidity is a placeholder, not a cost model.
6. **Concentration risk.** 2 positions = single-name blowup risk with no diversification.
7. **No live track record.** Paper trading hasn't started (correctly gated).

### How an institution would redesign it

```
Universe:      NSE liquid names, ADV > ₹5 Cr, ~700–1000 names, PIT membership
                    │
Features:      200–400 features across 9 families (§6), cross-sectionally
               z-scored per date, winsorized 1/99, residualized vs risk model
                    │
Label:         forward residual return, h ∈ {5, 21, 63} days,
               cross-sectionally demeaned, vol-scaled
                    │
Model:         ridge → LightGBM → LambdaMART, purged CV + embargo,
               uniqueness-weighted, ensembled across horizons
                    │
Risk model:    factor covariance (market, size, value, momentum, quality,
               vol, 20 sectors) + specific risk
                    │
Portfolio:     mean-variance / risk-parity optimizer
               • 50–150 names • market-neutral or beta-targeted
               • sector-neutral ±2% • single-name cap 2%
               • turnover penalty • ex-ante tracking error target
                    │
Execution:     participation-rate model, impact curve, VWAP/TWAP,
               capacity analysis at multiple AUM levels
                    │
Monitoring:    live IC decay, factor exposure drift, regime dashboards,
               P&L attribution alpha-vs-beta-vs-cost
```

The distance between what you have and this is not a refactor. It's a different platform sharing your (excellent) data layer.

---

## 8. Risk Review

| Component | Score | Assessment |
|---|---|---|
| Position sizing | 3/10 | Risk-based sizing is the right *instinct* (and switching from conviction was correct — sizing ∝ a ρ≈0 score was actively harmful). But it's per-trade risk, not portfolio risk. |
| Portfolio construction | **1/10** | 2 slots, 1/sector, greedy rank-order fill. This is not portfolio construction; it's a queue. |
| Correlation | **0/10** | No covariance matrix anywhere. Two positions could be perfectly correlated (both high-beta cyclicals in different "sectors") with no mechanism to detect it. |
| Diversification | **1/10** | n=2. |
| Kelly sizing | 0/10 | Not implemented. Note: full Kelly is inappropriate anyway; fractional (¼–½) Kelly with parameter uncertainty is the institutional norm. |
| Volatility targeting | **0/10** | Absent, and this is a **major, cheap win**. Vol-targeting (scale exposure inversely to forecast vol) improves Sharpe across essentially every asset class and strategy (Moreira-Muir 2017). One of the highest ROI additions available. |
| Expected shortfall / CVaR | 0/10 | Not computed. Max drawdown is reported, but MDD is a single realized path, not a risk measure. |
| Turnover | 2/10 | Not measured or penalized. With 7-day holds you're turning over ~36×/year — turnover should be a first-class term in the objective. |
| Liquidity | 2/10 | No ADV screen, no participation limit, no liquidity-adjusted sizing. |
| Execution assumptions | **1/10** | Flat 5bps + 0.05%. No impact model, no spread model, no size dependence. Given your own ₹5,000 capital reality, note that **fixed costs (DP charges) dominate at small size** — your 0.25% round-trip assumption is optimistic at small notional and irrelevant at large. |

**The most damaging risk finding:** you have a stop-loss (ATR-based) and a daily loss cap, and you called that risk management. Those are **trade-level** controls. You have zero **portfolio-level** risk machinery: no ex-ante vol forecast, no factor exposure limits, no correlation control, no stress testing, no scenario analysis.

**Cheapest high-value risk additions, in order:**
1. Volatility targeting (days of work, improves Sharpe almost everywhere)
2. A crude factor risk model — even market + size + 20 sector dummies + rolling covariance
3. Turnover penalty in the objective
4. ADV-based participation caps
5. CVaR reporting alongside MDD

---

## 9. Backtesting Review

### Would I trust these results? **Partially — I trust the mechanics, not the conclusions.**

Your backtest engine is honestly built. The bias sources you've closed are real and well-handled. But the *inferences* drawn from it don't survive scrutiny, for reasons above.

### Bias audit

| Bias | Status | Notes |
|---|---|---|
| Lookahead (price) | ✅ **Closed** | `candles ≤ asOf`, entries-before-exits, next-day-open fills |
| Lookahead (news) | ✅ **Closed** | `availableAt`, midnight cutoff |
| Lookahead (fundamentals) | ✅ **Closed** | `announcedAt`, refuses `periodEnd` |
| Survivorship | ✅ **Mostly closed** | Excellent work; residual = only 10 dead names, ±1 reconstitution |
| Restatement bias | ⚠️ **Open** | Do you capture that a reported figure was *later revised*? If `quarterly_fundamental` is overwritten on restatement, you have hidden lookahead. |
| **Multiple testing / selection bias** | ❌ **Wide open** | 6 study families × grids × folds, no correction. The largest open bias. |
| **Backtest overfitting (PBO)** | ❌ **Not measured** | No CSCV, no deflated Sharpe |
| **Cross-sectional correlation → inflated t-stats** | ❌ **Not addressed** | Effective n ≪ nominal n |
| Cost model realism | ⚠️ **Weak** | Flat bps; no impact, no spread, no size dependence, no fixed costs |
| Capacity / market impact | ❌ **Absent** | Not modelled at all |
| Corporate action handling | ⚠️ **Partially fixed** | Split adjustment bug found and fixed (good catch); dividends? Bonuses? Demergers (PEL left as −45%)? |
| Data-snooping via doc feedback | ⚠️ **Structural** | Every study's results informed the next study's design on the *same* dataset. This is unavoidable but should be acknowledged and priced. |
| Regime coverage | ⚠️ **Thin** | 5.5 years covers one major cycle. No 2008-style stress, no prolonged bear |
| Sequencing sensitivity | ⚠️ **Acknowledged** | n≈53 in some coverage cells — your own docs flag this |

### The unreconciled number

Your docs report the COVERAGE gate as **−6.5% vs Nifty +0.8%** (`B9_RERUN.md`) and **−17.08% vs Nifty +0.80%** (`SURVIVORSHIP.md`) for what is described as the same window and sizing. The benchmark agrees; the strategy doesn't. An 10.6pp discrepancy on your single most decisive metric is a **red flag for an allocator** — it means either the runs differ in an undocumented way, or one is wrong. In DD, this alone would pause the process. **Reconcile it before anything else.**

---

## 10. Roadmap

### Phase 1 — Quick wins (Month 1)

**Goal: find out whether your measurement apparatus works at all.**

1. **Run the positive control (§3.10).** Implement 12-1 momentum + Piotroski F-score through your existing pipeline. This single test determines whether the last six months of research means anything. **Highest-information experiment available to you.**
2. **Reconcile the −6.5% / −17.08% discrepancy.**
3. **Build the IC measurement layer.** Rank IC per date, IC decay curve by horizon (1/5/21/63d), IC-IR, quantile spread returns (Q1–Q10), Fama-MacBeth t-stats. Re-measure all 8 existing factors *properly* — you have never actually measured them as forecasts.
4. **Change the label.** Forward residual return, cross-sectionally demeaned, at h ∈ {5, 21, 63}. Decouple from exit logic entirely.
5. **Expand universe to Nifty 500** with an ADV floor. You already have bhavcopy + the ingestion tooling.
6. **Add DSR + PBO** to the reporting stack.
7. **Add volatility targeting** to the portfolio layer.

### Phase 2 — Major improvements (Months 2–3)

8. **Build a feature store.** Versioned columnar panel `(date, symbol, feature, value)` + separate label store. This changes your research iteration speed by ~10×.
9. **Build a minimal risk model.** Market + size + 20 sectors + rolling covariance + specific risk. Doesn't need to be Barra — needs to exist.
10. **Residualize everything.** Every feature and every label orthogonalized against the risk model.
11. **Rebuild portfolio construction.** Replace 2 slots with an optimizer: 50–150 names, sector-neutral, single-name caps, turnover penalty, beta target. **This alone moves you from `t≈0.3` to `t≈3.0` detection capability.**
12. **Cross-sectional feature transforms.** Z-score/rank within date, sector, and size bucket for every feature.
13. **Ingest Tier-1 free data**, starting with options chain (IV/skew/OI), participant-wise OI, and promoter pledge.

### Phase 3 — Research expansion (Months 4–6)

14. **Fama-MacBeth + ridge** on the expanded feature set. Establish the linear IC baseline.
15. **LightGBM with purged CV + embargo + uniqueness weighting.**
16. **Meta-labelling layer** on the primary model.
17. **Complete Tier-1 data ingestion** (FII/DII flows, bulk deals, SLB, ratings, MF disclosures, index rebalance).
18. **Rebuild the NLP layer:** abnormal tone (not level), coverage-volume shocks, novelty/staleness, entity salience, cross-sectional normalization.
19. **Decide Option C** — but only *after* the positive control passes. Buy a one-time historical estimate snapshot first.
20. **Multi-horizon ensemble** — separate models at 5/21/63 days, combined.

### Phase 4 — Institutional maturity (Months 7–12)

21. **Learning-to-Rank (LambdaMART)** as the primary ranking model.
22. **Full transaction cost model** — spread, impact curve, participation rate, capacity analysis at ₹1Cr / ₹10Cr / ₹100Cr.
23. **Long-short / market-neutral variant.** Even if you never trade the short leg, the L/S spread is the cleanest measurement of alpha.
24. **Bayesian hierarchical models** for honest posterior intervals.
25. **Live paper trading** with full attribution (alpha vs beta vs cost vs slippage) from day one.
26. **Regime-conditional factor timing** research.
27. **Network/graph data** (supply chain, ownership, promoter group) if earlier phases justify it.
28. **Research governance:** pre-registration of hypotheses, trial counter, automatic DSR adjustment on every reported result.

---

## 11. New Alpha Ideas — 50 directions

Grouped by family. **E** = empirical support (★★★ = extensively replicated incl. EM; ★★ = solid; ★ = suggestive/thin). **I** = implementation difficulty for *you specifically*.

### A. Cross-sectional equity factors

| # | Idea | E | I | Why it should work |
|---|---|---|---|---|
| 1 | **12-1 cross-sectional momentum** | ★★★ | Low | Jegadeesh-Titman; among the most replicated anomalies globally, confirmed in India. **Use as positive control first.** |
| 2 | **Residual momentum** | ★★★ | Med | Blitz-Huij-Martens (2011): momentum on factor-residualized returns has higher Sharpe and far smaller crashes. Directly addresses your beta contamination. |
| 3 | **Volatility-scaled momentum** | ★★★ | Low | Barroso-Santa Clara (2015): scaling by realized vol nearly doubles momentum's Sharpe by removing crash risk. |
| 4 | **1-week short-term reversal** | ★★★ | Low | Jegadeesh (1990); stronger in retail-heavy markets — India qualifies. Liquidity-provision premium. |
| 5 | **Idiosyncratic volatility anomaly** | ★★★ | Low | Ang-Hodrick-Xing-Zhang (2006): low idio-vol outperforms. Robust across 23 countries. |
| 6 | **Betting-against-beta** | ★★★ | Low | Frazzini-Pedersen (2014): leverage-constrained investors bid up high beta. Strong in EM. |
| 7 | **Quality-minus-junk** | ★★★ | Med | Asness-Frazzini-Pedersen: profitability + growth + safety + payout. |
| 8 | **Gross profitability** | ★★★ | Low | Novy-Marx (2013): gross profits/assets is the cleanest profitability measure. |
| 9 | **Asset growth / investment** | ★★★ | Low | Cooper-Gulen-Schill (2008): high asset growth predicts low returns. Strong in EM. |
| 10 | **Net share issuance** | ★★★ | Med | Daniel-Titman: issuance predicts underperformance, buybacks outperformance. India has heavy promoter issuance activity. |
| 11 | **Accruals** | ★★★ | Med | Sloan (1996): high accruals → low future returns. Under-arbitraged in EM. |
| 12 | **Piotroski F-score** | ★★★ | Low | Piotroski (2000): works *especially* well in emerging markets and for small/value names. |
| 13 | **52-week high proximity** | ★★ | Low | George-Hwang (2004): anchoring bias; nearness to 52w high predicts continuation. |
| 14 | **Long-term reversal (3–5y)** | ★★ | Low | DeBondt-Thaler. Slower horizon but genuinely orthogonal to your current work. |
| 15 | **Low-risk / low-vol anomaly** | ★★★ | Low | Baker-Bradley-Wurgler; the most robust anomaly after value/momentum. |

### B. Earnings & analyst

| # | Idea | E | I | Why |
|---|---|---|---|---|
| 16 | **PEAD / SUE drift** | ★★★ | Med (needs estimates) | Ball-Brown (1968); Bernard-Thomas (1989). The anomaly your B12 proved you can't see. Drift is *stronger* where analyst coverage is thin — a structural India advantage. |
| 17 | **Estimate revision momentum** | ★★★ | Med | Chan-Jegadeesh-Lakonishok (1996). **Often stronger than SUE itself** and needs only revisions, not surprises. |
| 18 | **Analyst dispersion** | ★★ | Low | Diether-Malloy-Scherbina (2002): high dispersion → underperformance (short-sale constraints). |
| 19 | **Earnings announcement premium** | ★★ | Low | Frazzini-Lamont (2007): stocks earn abnormal returns *in* announcement months. Pure calendar play, free to implement. |
| 20 | **Post-earnings-call tone drift** | ★★ | High | Loughran-McDonald sentiment on transcripts; Q&A evasiveness. |
| 21 | **Guidance revision drift** | ★★ | Med | Management guidance changes predict drift beyond the surprise itself. |
| 22 | **SUE without estimates (time-series)** | ★★ | **Low** | Standardized unexpected earnings vs a seasonal random walk of your *own* announcement-dated actuals. **You can build this today, for free, with data you already have.** Weaker than consensus-based SUE but genuinely predictive — and it de-risks the Option C purchase. |

### C. Flow, positioning, ownership (your India edge)

| # | Idea | E | I | Why |
|---|---|---|---|---|
| 23 | **FII/DII flow imbalance** | ★★ | Low | Foreign flows move EM prices; persistence then reversal. Free from NSE. |
| 24 | **Participant-wise OI extremes** | ★★ | Low | Client (retail) positioning is contrarian; FII positioning is trend-confirming. Free, daily, genuinely orthogonal. |
| 25 | **Promoter pledge changes** | ★★ | Low | India-specific, structurally under-researched, distress-predictive. Free from shareholding patterns. |
| 26 | **Institutional ownership change** | ★★ | Med | Quarterly shareholding-pattern deltas; institutional accumulation predicts drift. |
| 27 | **Mutual fund crowding / fire sales** | ★★ | Med-High | Coval-Stafford (2007): flow-driven forced selling creates predictable reversal. AMFI monthly disclosures are free. |
| 28 | **Bulk/block deal follow-through** | ★★ | Low | Informed block trades carry information; free daily disclosure. |
| 29 | **Short interest / SLB balance** | ★★★ | Low | Short interest is one of the most robust *negative* predictors globally. NSE SLB data is free. |
| 30 | **Index rebalancing front-run** | ★★★ | Low | Shleifer (1986); Harris-Gurel. Predictable, dated, mechanical flow. Capacity-limited but real. |
| 31 | **F&O ban-period effects** | ★ | Low | India-specific forced deleveraging. Almost no published research — genuine white space. |

### D. Options-derived

| # | Idea | E | I | Why |
|---|---|---|---|---|
| 32 | **IV skew as crash predictor** | ★★★ | Med | Xing-Zhang-Zhao (2010): steep put skew predicts negative returns. Among the best single-name signals in existence. |
| 33 | **Volatility risk premium** | ★★★ | Med | Implied minus realized vol; one of the most persistent premia in finance. Tradeable on NIFTY directly. |
| 34 | **Put-call parity deviation** | ★★ | Med | Cremers-Weinbaum (2010): deviations predict returns; informed traders act in options first. |
| 35 | **Options OI change / PCR** | ★★ | Low | Positioning extremes → reversal. Free from NSE. |
| 36 | **IV term structure regime** | ★★ | Low | Backwardation vs contango as a market-regime input — far better than your current VIX threshold. |
| 37 | **Straddle-implied earnings move vs realized** | ★★ | Med | Systematic bias in implied earnings moves. |

### E. Microstructure & liquidity

| # | Idea | E | I | Why |
|---|---|---|---|---|
| 38 | **Overnight vs intraday decomposition** | ★★★ | **Low** | Lou-Polk-Skouras (2019): momentum lives overnight, reversal intraday. **You can compute this from your existing bhavcopy data today.** One of the highest ROI ideas on this list. |
| 39 | **Amihud illiquidity premium** | ★★★ | Low | Amihud (2002); computable from existing OHLCV. |
| 40 | **Corwin-Schultz spread from high/low** | ★★ | Low | Spread proxy without tick data. |
| 41 | **Abnormal turnover as attention** | ★★ | Low | Barber-Odean attention-driven buying → subsequent reversal. |
| 42 | **Order flow imbalance / Kyle's lambda** | ★★★ | High | Requires tick data. Powerful but a different data tier. |

### F. Text & alternative

| # | Idea | E | I | Why |
|---|---|---|---|---|
| 43 | **News staleness/novelty** | ★★ | Med | Tetlock (2011): *stale* news drives reversal, novel news drives drift. **Reframes your entire sentiment archive.** |
| 44 | **Abnormal coverage volume** | ★★ | Low | Attention shock, independent of tone. You have the archive — this is nearly free. |
| 45 | **Cross-sectionally normalized tone** | ★★ | Low | Deviation from the stock's *own* tone baseline, not the raw level. Fixes §3.11. |
| 46 | **Supply-chain momentum** | ★★ | High | Cohen-Frazzini (2008): customer returns predict supplier returns with a lag. Needs a supply-chain graph — doesn't exist for India. Genuine white space. |
| 47 | **Business-group linkage** | ★ | Med | India-specific: Tata/Adani/Reliance/Birla intra-group information transmission. Almost no literature. **Highest-novelty idea on this list.** |
| 48 | **Ownership-network linkage** | ★ | High | Common institutional holders → correlated flow (Anton-Polk 2014). |
| 49 | **Google Trends / search attention** | ★ | Low | Da-Engelberg-Gao (2011). Weak and decayed, but free. |

### G. Regime & meta

| # | Idea | E | I | Why |
|---|---|---|---|---|
| 50 | **Factor momentum** | ★★★ | Low | Gupta-Kelly (2019): factors themselves exhibit momentum. Times *your own* factors — pure meta-signal, no new data. |
| 51 | **Volatility-managed portfolios** | ★★★ | **Low** | Moreira-Muir (2017): scale exposure inversely to forecast vol. Improves Sharpe across nearly every strategy. **Cheapest win on this entire list.** |
| 52 | **Seasonality (turn-of-month, budget, Muhurat)** | ★★ | Low | Turn-of-month is robust globally; India has unique calendar effects (Union Budget, Muhurat trading) that are under-studied. |
| 53 | **Meta-labelling ensemble** | ★★ | Med | López de Prado. Directly targets your "trims left tail, can't find winners" diagnosis. |

**If I could only pick five for you to start:** #38 (overnight/intraday — free, high evidence, data in hand), #51 (vol targeting — free, near-universal Sharpe improvement), #22 (time-series SUE — free, de-risks Option C), #32 (IV skew — free from NSE, top-tier evidence), #25 (promoter pledge — free, India-specific, under-researched).

---

## 12. Final Verdict

### Scores

| Dimension | Score | Note |
|---|---|---|
| **Engineering** | **8.5/10** | Determinism, testing, versioning, CI/CD. Genuinely excellent. |
| **Data Engineering** | **7.5/10** | PIT discipline and Bronze layer are institutional-grade. Universe too narrow, single-vendor price data. |
| **Research Methodology** | **5.5/10** | Excellent PIT/survivorship/reproducibility. Fatal gaps in statistical testing, hypothesis generation, and experimental design. |
| **Quantitative Finance** | **3/10** | No risk model, no residualization, no cross-sectional framework, no breadth, no capacity. The weakest dimension by a wide margin. |
| **Statistical Rigor** | **4.5/10** | Intellectually honest (top decile) but methodologically incomplete (bottom quartile). No multiple-testing, no power analysis, no effective-n. |
| **Production Readiness** | **8/10** | Deployed, monitored, backed up, restore-verified. |
| **Alpha Potential** | **2/10 as-is · 6.5/10 reframed** | Currently near-zero. The *platform* has real potential once the research layer is rebuilt. |
| **Institutional Readiness** | **3.5/10** | Data layer would pass DD. Research and risk layers would not. |

**Composite: 5.3/10 — an A-grade engineer's C+ research platform.**

The gap between your engineering score (8.5) and your quant-finance score (3) is the entire story. **You solved the problem you knew how to solve.** The bottleneck was never code quality, test coverage, or reproducibility — it was that nobody on the project was a quantitative researcher, so the research design was never subjected to the standards the engineering was.

### The one thing that raises my opinion most

You retracted a 30-day-horizon claim *the same day* the walk-forward inverted it. You found your own survivorship bias, and reported it made results *worse*. You de-confounded `INSIDER_PLEDGE` and killed your own best result. You wrote "this is not an edge" into production source code.

**That intellectual honesty is rarer and more valuable than any signal in this document.** Most people who build a losing system either don't find out or don't say. I would rather hire someone with your epistemics and no alpha than someone with a 3.0 Sharpe backtest and no scepticism — because the second person's backtest is almost always wrong and they'll never know.

### If this landed on my desk today — the 12-month plan

**Months 1–2: Determine whether the last six months of research means anything.**
Run the positive controls (12-1 momentum, F-score) through the existing pipeline. Reconcile the −6.5%/−17.08% discrepancy. Build the IC framework. Change the label to residualized forward returns. My prior: **the positive controls will also fail**, which means the six negatives were measurement artifacts and the alpha question is *still open*.

**Months 2–4: Rebuild the measurement layer, not the strategy.**
Feature store. Minimal risk model. Residualization. Universe to Nifty 500. Portfolio construction from 2 slots to 50–150 names with an optimizer. Re-measure all 8 existing factors as forecasts. **This step alone moves detection capability from t≈0.3 to t≈3.0** — it is the difference between a research program that can find things and one that cannot.

**Months 4–7: Data, in the free-first order.**
Options IV/skew/OI, participant-wise OI, promoter pledge, FII/DII flows, SLB, overnight/intraday decomposition. Time-series SUE from data you already hold. *Then* decide on buying estimates — with a one-time historical snapshot, not a subscription.

**Months 7–10: Modelling.**
Fama-MacBeth → ridge → LightGBM with purged CV → LambdaMART. Meta-labelling on top. Multi-horizon ensemble. Full DSR/PBO reporting on every result.

**Months 10–12: Portfolio, costs, and honest evaluation.**
Optimizer with turnover and risk constraints. Real transaction-cost model with capacity analysis. Long-short spread as the clean alpha measure. Paper trade with full attribution.

**The decision gate at month 12:** does any signal show rank IC > 0.02 with IC-IR > 0.5, surviving purged CV, DSR-adjusted for the full trial count, and delivering a positive Q1–Q10 quantile spread net of realistic costs? If yes, you have something. If no — after doing it *properly* — then the EMH conclusion is finally earned rather than assumed.

### The blunt closing

Your documentation says free-data avenues are exhausted and the only remaining lever is a purchase. **That is not true.** You have eleven untouched free India-specific datasets, five free high-evidence signal families computable from data already on your disk, and a portfolio design that would have hidden a good signal even if you'd had one.

You didn't exhaust the search space. **You exhausted one small corner of it with an instrument that couldn't measure.**

Fix the instrument first. Then search.

---

*Review conducted against QuantSwing Master Reference (repo snapshot `93cbb86`, 2026-07-21). Scores are allocator-standard, not hobbyist-standard — a 5.3 composite here would be an 8+ against retail algorithmic trading projects.*
