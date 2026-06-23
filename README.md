# NEXUS — Trading Intelligence Dashboard

A self-contained, browser-only crypto **signal + paper-trading** dashboard. No
server, no API keys, no secrets. Open `index.html` and it pulls **live data**
from Binance Futures' public API and runs an 8-stage signal pipeline on your
phone or desktop.

> ⚠️ **Not financial advice. No prediction is guaranteed.** This is an
> educational tool. Paper trade first.

## What it does

- **Live market data** — klines (5m/1h/4h), 24h ticker, funding rate, open
  interest, and the Fear & Greed index, fetched directly from public APIs.
- **A probabilistic engine** — a logistic model combines trend, momentum,
  order-flow and structure factors into a *probability* that price resolves up
  vs. down, then squashes it to a calibrated confidence. It is **its own
  design** — not a copy of any uploaded bot.
- **Honest, measured accuracy** — instead of claiming a fixed "70%", the app
  runs a **walk-forward backtest** over each coin's recent 5m history and shows
  the *measured* hit-rate, expectancy (R), and profit factor. The engine only
  issues `EXECUTE` when that backtested edge is currently positive.
- **8-step filter pipeline** — data integrity → risk gate (incl. drawdown
  halt) → regime → hard filters → liquidity → model-score → trade plan →
  edge + self-critique. Every step is shown live.
- **Multi-timeframe alignment** — needs 2 of 3 timeframes (5m/1h/4h) agreeing.
- **Automatic paper trading** — opens simulated positions on valid signals,
  auto-resolves win/loss at TP/SL (with a time stop), and tracks
  equity / ROI / win-rate / profit factor. All in `localStorage`.
- **Coins:** BTC, ETH, SOL, BNB, XRP, DOGE.

## Why "70% accurate" is shown as a *measured* number

No bot can guarantee a fixed accuracy in live markets — anything that promises
one is curve-fitting or lying. NEXUS instead **measures** its own hit-rate by
replaying the exact same model + trade plan over historical bars, and displays
that number live with its sample size. If the edge isn't there, signals are
suppressed rather than faked.

## Run it

It's a single file. Either:

- **Open directly:** double-click `index.html` (modern browser), **or**
- **Serve locally:** `python3 -m http.server` then visit
  `http://localhost:8000`, **or**
- **Host free:** push to GitHub and enable **GitHub Pages** (Settings → Pages →
  deploy from branch). The dashboard is mobile-first and installable as a PWA-
  style web app.

> Some browsers block `fetch` to Binance from a `file://` page (CORS). If data
> doesn't load, use the local-server or GitHub Pages option above.

## Settings

Capital, risk-per-trade %, probability threshold, sound/vibration alerts, auto
paper trading, and auto-refresh — all persisted locally.

## 📲 Telegram alerts (works even when the dashboard is closed)

The dashboard only runs while open in a browser. To get pinged 24/7, a
**GitHub Actions** job (`.github/workflows/alerts.yml`) runs the same engine
every ~5 minutes in the cloud and sends a Telegram message on **fresh** signals
(it won't repeat-spam the same signal). This must live on the **default branch
(`main`)** — GitHub only runs scheduled workflows from the default branch.

**One-time setup:**
1. In Telegram, message **@BotFather** → `/newbot` → copy the **bot token**.
2. Message **@userinfobot** (or @RawDataBot) → copy your numeric **chat id**.
3. Send your new bot any message once (so it can DM you).
4. In GitHub: **repo → Settings → Secrets and variables → Actions → New
   repository secret**, add two secrets:
   - `TELEGRAM_TOKEN` = the BotFather token
   - `TELEGRAM_CHAT_ID` = your chat id
5. **Actions** tab → **NEXUS Telegram Alerts** → **Run workflow** to test now.
   After that it runs automatically every ~5 min.

Secrets are stored encrypted by GitHub and never appear in code. (The old
`live_oracle.py` hardcoded a token — don't do that; rotate it via @BotFather.)

> Note: Binance geo-blocks some cloud IPs. The scanner falls back across
> several public kline hosts to stay reliable on GitHub's runners.

## Accuracy tuning

The engine is tuned for **fewer, stronger** signals (higher precision):
- Probability threshold **72%** (was 68%) — configurable in Settings.
- ADX floor **22** — only clear trends, no chop.
- **RVOL ≥ 1.0** — requires above-average volume (real participation).
- **1H timeframe must confirm** + at least 2 of 3 timeframes aligned.
- Backtest applies the same gates, so the displayed hit-rate stays honest.

Raise the threshold further (e.g. 78%) for an even higher win-rate at the cost
of fewer trades. Let paper trading validate any change first.

## Notes

- `live_oracle.py` is a separate, older bot kept for reference. **It contains a
  hardcoded Telegram token — revoke/rotate it via @BotFather and never commit
  secrets.** NEXUS uses no secrets at all.
