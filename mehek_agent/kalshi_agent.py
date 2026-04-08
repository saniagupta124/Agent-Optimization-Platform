"""
Mehek's Kalshi Trading Agent — powered by Traeco SDK.

Runs a real trading loop against the Kalshi prediction market API, with every
Claude LLM call tracked by the Traeco SDK for cost visibility.

Spans:
  market_scanner      → calls real Kalshi API, picks best opportunities
  sentiment_analyzer  → Claude haiku: is this market mispriced?
  trade_decision      → Claude sonnet: structured buy/sell/hold decision
  risk_checker        → Claude haiku: validates trade vs. bankroll & risk params

Usage:
    export ANTHROPIC_API_KEY=sk-ant-...
    export KALSHI_API_KEY=your-kalshi-key        # from kalshi.com API settings
    export TRAECO_API_KEY=tk_live_...            # from Traeco dashboard → Setup
    export TRAECO_API_URL=http://localhost:8000  # defaults to hosted API
    python mehek_agent/kalshi_agent.py

Security: ANTHROPIC_API_KEY and KALSHI_API_KEY never leave this machine.
Only token counts, costs, model names, and span names are sent to Traeco.
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime

import httpx
from anthropic import Anthropic

# Add sdk/ to path so "from traeco import ..." works when running from repo root
_sdk_dir = os.path.join(os.path.dirname(__file__), "..", "sdk")
if _sdk_dir not in sys.path:
    sys.path.insert(0, os.path.abspath(_sdk_dir))

from traeco import init, span, wrap

# ── Traeco initialisation ─────────────────────────────────────────────────────

_TRAECO_KEY = os.environ.get("TRAECO_API_KEY", "")
_TRAECO_URL = os.environ.get("TRAECO_API_URL", "https://api.traeco.ai")

init(
    api_key=_TRAECO_KEY,
    agent_name="mehek_agent",
    host=_TRAECO_URL,
    debug=bool(os.environ.get("TRAECO_DEBUG")),
)

# ── Anthropic client (ANTHROPIC_API_KEY required) ─────────────────────────────

_anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
if not _anthropic_key:
    print("[kalshi_agent] ERROR: ANTHROPIC_API_KEY environment variable not set.")
    sys.exit(1)

client = wrap(Anthropic(api_key=_anthropic_key))

# ── Kalshi API ────────────────────────────────────────────────────────────────

_KALSHI_KEY = os.environ.get("KALSHI_API_KEY", "")
_KALSHI_BASE = "https://trading-api.kalshi.com/trade-api/v2"

_SIMULATED_MARKETS = [
    {
        "ticker": "BTC-50K-MAY",
        "title": "Will Bitcoin exceed $50,000 by end of May 2026?",
        "yes_bid": 0.42,
        "yes_ask": 0.44,
        "volume": 185_000,
        "open_interest": 42_000,
        "days_to_close": 23,
        "category": "crypto",
    },
    {
        "ticker": "FED-RATE-CUT-JUN",
        "title": "Will the Fed cut rates at the June 2026 FOMC meeting?",
        "yes_bid": 0.30,
        "yes_ask": 0.32,
        "volume": 420_000,
        "open_interest": 98_000,
        "days_to_close": 65,
        "category": "macro",
    },
    {
        "ticker": "SP500-5500-Q2",
        "title": "Will the S&P 500 close above 5,500 at Q2 end?",
        "yes_bid": 0.57,
        "yes_ask": 0.59,
        "volume": 310_000,
        "open_interest": 71_000,
        "days_to_close": 55,
        "category": "equities",
    },
    {
        "ticker": "ETH-3K-APR",
        "title": "Will Ethereum exceed $3,000 before April 30, 2026?",
        "yes_bid": 0.26,
        "yes_ask": 0.28,
        "volume": 98_000,
        "open_interest": 18_000,
        "days_to_close": 23,
        "category": "crypto",
    },
    {
        "ticker": "RECESSION-2026",
        "title": "Will the US enter a recession in 2026?",
        "yes_bid": 0.18,
        "yes_ask": 0.20,
        "volume": 760_000,
        "open_interest": 180_000,
        "days_to_close": 270,
        "category": "macro",
    },
    {
        "ticker": "NVIDIA-EARNINGS-BEAT",
        "title": "Will NVIDIA beat Q1 2026 earnings estimates?",
        "yes_bid": 0.66,
        "yes_ask": 0.68,
        "volume": 230_000,
        "open_interest": 55_000,
        "days_to_close": 38,
        "category": "equities",
    },
]


def _kalshi_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {_KALSHI_KEY}", "Content-Type": "application/json"}


def _fetch_kalshi_markets(limit: int = 20) -> list[dict]:
    """
    Fetch active markets from the real Kalshi API.
    Falls back to simulated data if the API is unavailable or key is not set.
    """
    if not _KALSHI_KEY:
        return _SIMULATED_MARKETS

    backoff = 1
    for attempt in range(3):
        try:
            r = httpx.get(
                f"{_KALSHI_BASE}/markets",
                headers=_kalshi_headers(),
                params={"limit": limit, "status": "open"},
                timeout=10,
            )
            if r.status_code == 429:
                time.sleep(backoff)
                backoff *= 2
                continue
            if r.status_code == 200:
                raw_markets = r.json().get("markets", [])
                if not raw_markets:
                    return _SIMULATED_MARKETS
                # Normalise to the shape the rest of the code expects
                normalised = []
                for m in raw_markets:
                    close_ts = m.get("close_time") or m.get("expiration_time", "")
                    try:
                        close_dt = datetime.fromisoformat(close_ts.replace("Z", "+00:00"))
                        days_left = max(0, (close_dt - datetime.utcnow().replace(tzinfo=close_dt.tzinfo)).days)
                    except Exception:
                        days_left = 30
                    normalised.append({
                        "ticker": m.get("ticker", "UNKNOWN"),
                        "title": m.get("title", m.get("subtitle", "Unknown market")),
                        "yes_bid": float(m.get("yes_bid", 0)) / 100,   # Kalshi prices in cents
                        "yes_ask": float(m.get("yes_ask", 0)) / 100,
                        "volume": int(m.get("volume", 0)),
                        "open_interest": int(m.get("open_interest", 0)),
                        "days_to_close": days_left,
                        "category": m.get("category", "general"),
                    })
                return normalised
            print(f"[kalshi_agent] Kalshi API returned {r.status_code}, using simulated data.")
            return _SIMULATED_MARKETS
        except Exception as exc:
            if attempt < 2:
                time.sleep(backoff)
                backoff *= 2
            else:
                print(f"[kalshi_agent] Kalshi API unavailable ({exc}), using simulated data.")
    return _SIMULATED_MARKETS


def _fetch_portfolio_balance() -> float:
    """Return portfolio balance in USD. Returns 1000.0 if API unavailable."""
    if not _KALSHI_KEY:
        return 1_000.0
    try:
        r = httpx.get(
            f"{_KALSHI_BASE}/portfolio/balance",
            headers=_kalshi_headers(),
            timeout=8,
        )
        if r.status_code == 200:
            data = r.json()
            # Kalshi balance is in cents
            return float(data.get("balance", 100_000)) / 100
    except Exception:
        pass
    return 1_000.0


# ── Agent spans ───────────────────────────────────────────────────────────────

@span("market_scanner")
def scan_markets() -> list[dict]:
    """Fetch live Kalshi markets and rank by opportunity score."""
    markets = _fetch_kalshi_markets(limit=20)

    def opportunity(m: dict) -> float:
        mid = (m["yes_bid"] + m["yes_ask"]) / 2
        spread = m["yes_ask"] - m["yes_bid"]
        price_inefficiency = abs(mid - 0.5)
        volume_norm = min(m["volume"] / 500_000, 1.0)
        time_factor = max(0.1, 1 - m["days_to_close"] / 365)
        # Favour tight spreads (more liquid) and inefficient prices
        liquidity_bonus = max(0, 0.1 - spread) * 2
        return (price_inefficiency + liquidity_bonus) * volume_norm * time_factor

    ranked = sorted(markets, key=opportunity, reverse=True)
    top = ranked[:2]

    print(f"\n[market_scanner] Fetched {len(markets)} markets, selected top {len(top)}:")
    for m in top:
        mid = (m["yes_bid"] + m["yes_ask"]) / 2
        print(f"  {m['ticker']:35s}  mid={mid:.3f}  vol={m['volume']:,}")
    return top


@span("sentiment_analyzer")
def analyze_sentiment(market: dict) -> dict:
    """Claude haiku: assess market sentiment and estimate fair value."""
    mid = (market["yes_bid"] + market["yes_ask"]) / 2
    spread = market["yes_ask"] - market["yes_bid"]

    response = client.messages.create(
        model="claude-3-haiku-20240307",
        max_tokens=250,
        system=(
            "You are a quantitative analyst specialising in prediction markets. "
            "Given a market question and its current prices, analyse whether the market "
            "is fairly priced. Reply ONLY in valid JSON: "
            '{"sentiment": "bullish|bearish|neutral", "fair_value": 0.XX, '
            '"mispricing_confidence": 0-100, "rationale": "one sentence"}'
        ),
        messages=[
            {
                "role": "user",
                "content": (
                    f"Market: {market['title']}\n"
                    f"Yes bid: {market['yes_bid']:.3f}  Yes ask: {market['yes_ask']:.3f}  "
                    f"Mid: {mid:.3f}  Spread: {spread:.3f}\n"
                    f"Volume: ${market['volume']:,}  Days to close: {market['days_to_close']}\n"
                    f"Category: {market['category']}\n\n"
                    "Is this market mispriced? Provide your probability estimate."
                ),
            }
        ],
    )

    raw = response.content[0].text if response.content else "{}"
    try:
        # Strip markdown code fences if present
        clean = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        result = json.loads(clean)
    except json.JSONDecodeError:
        result = {
            "sentiment": "neutral",
            "fair_value": mid,
            "mispricing_confidence": 0,
            "rationale": raw[:100],
        }

    print(
        f"[sentiment_analyzer] {market['ticker']}: "
        f"sentiment={result.get('sentiment')}  fair_value={result.get('fair_value')}  "
        f"mispricing_confidence={result.get('mispricing_confidence')}%"
    )
    return {**market, "sentiment": result}


@span("trade_decision")
def make_trade_decision(market_with_sentiment: dict) -> dict:
    """Claude sonnet: structured buy/sell/hold decision with position sizing."""
    market = market_with_sentiment
    sentiment = market.get("sentiment", {})
    mid = (market["yes_bid"] + market["yes_ask"]) / 2

    response = client.messages.create(
        model="claude-3-5-sonnet-20241022",
        max_tokens=300,
        system=(
            "You are a systematic prediction market trader. "
            "Given market data and sentiment analysis, output a precise trading decision. "
            "Reply ONLY in valid JSON: "
            '{"action": "BUY|SELL|HOLD", "side": "yes|no", "size_usd": 50-500, '
            '"confidence": 0.0-1.0, "edge": 0.00, "reason": "one sentence"}'
        ),
        messages=[
            {
                "role": "user",
                "content": (
                    f"Market: {market['title']}\n"
                    f"Current mid: {mid:.3f}  Bid: {market['yes_bid']:.3f}  "
                    f"Ask: {market['yes_ask']:.3f}\n"
                    f"Analyst fair value: {sentiment.get('fair_value', mid):.3f}\n"
                    f"Sentiment: {sentiment.get('sentiment', 'neutral')}\n"
                    f"Mispricing confidence: {sentiment.get('mispricing_confidence', 0)}%\n"
                    f"Rationale: {sentiment.get('rationale', '')}\n\n"
                    "What is your trade decision? Only trade if edge > 0.03."
                ),
            }
        ],
    )

    raw = response.content[0].text if response.content else "{}"
    try:
        clean = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        decision = json.loads(clean)
    except json.JSONDecodeError:
        decision = {"action": "HOLD", "side": "yes", "size_usd": 0, "confidence": 0.0,
                    "edge": 0.0, "reason": raw[:100]}

    print(
        f"[trade_decision] {market['ticker']}: "
        f"action={decision.get('action')} side={decision.get('side')} "
        f"size=${decision.get('size_usd')} confidence={decision.get('confidence'):.2f} "
        f"edge={decision.get('edge', 0):.3f}"
    )
    return {**market, "decision": decision}


@span("risk_checker")
def check_risk(market_with_decision: dict, bankroll: float) -> dict:
    """Claude haiku: validate proposed trade against bankroll and risk parameters."""
    market = market_with_decision
    decision = market.get("decision", {})

    max_trade = min(500, bankroll * 0.05)   # never risk more than 5% of bankroll per trade

    response = client.messages.create(
        model="claude-3-haiku-20240307",
        max_tokens=200,
        system=(
            "You are a risk manager for a prediction market trading desk. "
            f"Rules: max single-trade size ${max_trade:.0f}, min confidence 0.55, "
            "min edge 0.03, never trade on HOLD signals. "
            "Reply ONLY in valid JSON: "
            '{"approved": true|false, "adjusted_size_usd": N, "risk_note": "one sentence"}'
        ),
        messages=[
            {
                "role": "user",
                "content": (
                    f"Market: {market['title']}\n"
                    f"Proposed action: {decision.get('action', 'HOLD')} {decision.get('side', 'yes')}\n"
                    f"Proposed size: ${decision.get('size_usd', 0)}\n"
                    f"Trader confidence: {decision.get('confidence', 0):.2f}\n"
                    f"Edge: {decision.get('edge', 0):.3f}\n"
                    f"Bankroll: ${bankroll:.2f}\n\n"
                    "Validate this trade."
                ),
            }
        ],
    )

    raw = response.content[0].text if response.content else "{}"
    try:
        clean = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
        risk = json.loads(clean)
    except json.JSONDecodeError:
        risk = {"approved": False, "adjusted_size_usd": 0, "risk_note": raw[:100]}

    status = "APPROVED" if risk.get("approved") else "REJECTED"
    print(
        f"[risk_checker] {market['ticker']}: {status}  "
        f"adjusted_size=${risk.get('adjusted_size_usd')}  note={risk.get('risk_note', '')[:60]}"
    )
    return {**market, "risk": risk}


# ── Main loop ─────────────────────────────────────────────────────────────────

def run_loop(iterations: int | None = None) -> None:
    """Run the full scan → analyze → decide → risk-check cycle."""
    loop = 0

    print("=" * 65)
    print("Mehek's Kalshi Trading Agent — powered by Traeco")
    print(f"Traeco API  : {_TRAECO_URL}")
    print(f"SDK key     : {'set' if _TRAECO_KEY else 'NOT SET (traces not shipped)'}")
    print(f"Kalshi key  : {'set (live data)' if _KALSHI_KEY else 'NOT SET (simulated data)'}")
    print("=" * 65)

    running_profit_estimate = 0.0

    while True:
        loop += 1
        print(f"\n{'=' * 65}")
        print(f"Loop #{loop}  {datetime.utcnow().strftime('%H:%M:%S UTC')}")
        print("=" * 65)

        # Fetch bankroll once per loop
        bankroll = _fetch_portfolio_balance()
        print(f"[portfolio] bankroll = ${bankroll:.2f}")

        markets = scan_markets()
        loop_profit_estimate = 0.0

        for market in markets:
            with_sentiment = analyze_sentiment(market)
            with_decision = make_trade_decision(with_sentiment)
            with_risk = check_risk(with_decision, bankroll)

            risk = with_risk.get("risk", {})
            decision = with_risk.get("decision", {})
            if risk.get("approved") and decision.get("action") != "HOLD":
                size = risk.get("adjusted_size_usd", 0) or 0
                edge = decision.get("edge", 0) or 0
                loop_profit_estimate += size * edge
                print(
                    f"  >> TRADE LOGGED: {decision.get('action')} {decision.get('side')} "
                    f"${size:.0f} on {market['ticker']} "
                    f"(est. profit ${size * edge:.2f})"
                )
            else:
                print(f"  >> NO TRADE: {market['ticker']} — "
                      f"{'rejected by risk' if not risk.get('approved') else 'HOLD signal'}")

        running_profit_estimate += loop_profit_estimate
        print(f"\n[loop #{loop}] est. profit this loop: ${loop_profit_estimate:.2f}  "
              f"| running total: ${running_profit_estimate:.2f}")
        print(f"[loop #{loop}] LLM costs shipping to Traeco dashboard in background")

        if iterations is not None and loop >= iterations:
            break

        print(f"[loop #{loop}] sleeping 60s before next scan...")
        time.sleep(60)


if __name__ == "__main__":
    run_loop()
