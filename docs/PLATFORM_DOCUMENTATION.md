# MaritimeShield Platform Documentation

## Maritime Demurrage Insurance Prediction Market

A hybrid CLOB + on-chain prediction market for hedging maritime demurrage risk.

---

## Table of Contents

1. [Platform Overview](#platform-overview)
2. [Core Mechanics](#core-mechanics)
3. [Demurrage Definition & Timing](#demurrage-definition--timing)
4. [Technical Architecture](#technical-architecture)
5. [CLOB Implementation](#clob-implementation)
6. [API Reference](#api-reference)
7. [Share Minting & Settlement](#share-minting--settlement)

---

## Platform Overview

### What is MaritimeShield?

MaritimeShield is a prediction market platform where:
- **Shippers/Cargo Owners** can hedge against demurrage costs by buying YES shares
- **Speculators** can profit by taking the other side based on route/port analysis
- **Market Makers** provide liquidity and earn the bid-ask spread

### The Problem We Solve

Demurrage costs the maritime industry **$3-5B annually**. Traditional insurance is:
- Slow to underwrite
- Expensive (high premiums)
- Opaque pricing

Prediction markets offer:
- Instant hedging
- Market-driven pricing (reflects real-time risk)
- Transparent, auditable settlement

---

## Core Mechanics

### How Shares Work

**Prediction market shares are NOT emitted by an issuer.** They're created through **Complete Set Minting**:

```
User deposits $1 collateral → System mints 1 YES + 1 NO share
```

This works because **YES + NO always = $1** at resolution:
- If demurrage occurs: YES = $1, NO = $0
- If on time: YES = $0, NO = $1

### Key Insight: Buying NO = Selling YES

```
Since YES + NO always = $1.00

Buying NO at 65¢  =  Selling YES at 35¢
Buying YES at 35¢ =  Selling NO at 65¢

THEY ARE THE SAME THING!
```

### Order Matching Rule

```
YES buyer @ X¢  +  NO buyer @ Y¢  =  MATCH if X + Y >= 100

Example:
- You: Buy NO @ 65¢
- Someone: Buy YES @ 35¢
- Check: 65 + 35 = 100 ✓ MATCH!
- Result: $1 collateral locked, you get NO, they get YES
```

### Who Creates Markets?

1. **Platform** creates the market definition (vessel, route, expiry, oracle)
2. **Traders** create shares when they trade (a YES buyer + NO buyer together create a complete set)
3. **Market price** reflects collective wisdom about demurrage probability

### Incentives for Counterparties

| Player | Motivation | Action |
|--------|------------|--------|
| **Shipper** | Risk reduction (insurance) | Buy YES to hedge demurrage exposure |
| **Speculator** | Profit from superior information | Take opposite side if they disagree with price |
| **Market Maker** | Earn bid-ask spread | Quote both sides, risk-neutral |

---

## Demurrage Definition & Timing

> **This is the crux of demurrage contracts. If you get start and end wrong, your market is unhedgeable.**

### Real-World Truth

**Demurrage = penalty paid when laytime is exceeded.**

In shipping reality, demurrage depends on:
- **NOR** (Notice of Readiness)
- **Laytime rules** (weather, weekends, congestion clauses)
- **Berth vs anchorage definitions**
- **Charter type** (voyage vs time charter)

⚠️ **Actual demurrage invoices are not public data.**

### The Correct Abstraction for a Prediction Market

We define **our own demurrage clock**, explicitly in the contract:

> "Demurrage" in MaritimeShield = **observable waiting time beyond a predefined allowance**

This is *intentional*, not a compromise.

---

### The Parametric Timeline

#### 1️⃣ Start Time (T₀): When the Clock Starts

**✅ RECOMMENDED: Arrival at Anchorage**

**Start time = first AIS timestamp when vessel enters port anchorage zone**

**Definition:**
- Vessel crosses predefined geofence
- Speed < threshold (e.g. < 1 knot)
- Status = "At anchor" or equivalent

**Why this is best:**
- Objective
- Globally observable via AIS
- No legal ambiguity
- Strong correlation with congestion-driven demurrage

**⚠️ Alternatives (not recommended for MVP):**
- Notice of Readiness (NOR) - not public data
- Pilot station arrival - inconsistent globally

---

#### 2️⃣ End Time (T₁): When the Clock Stops

**✅ RECOMMENDED: Berth Arrival**

**End time = AIS timestamp when vessel is first "moored" or "berthed"**

Common signals:
- Status changes to "Moored"
- Speed = 0
- Position inside berth geofence

This matches:
- Start of cargo operations
- End of congestion-related waiting

---

#### 3️⃣ The Parametric Demurrage Formula

```
WaitingTime = EndTime − StartTime
DemurrageTriggered = WaitingTime > Allowance
```

Where **Allowance** is defined in the contract (e.g., 24h, 48h).

---

### Example: A Perfect Contract Specification

> **Market:** "Will tanker IMO 1234567 experience demurrage at Singapore?"

**Contract spec:**
- Start time: first anchorage timestamp
- End time: first berth timestamp
- Allowance: 48 hours
- Observation window: 1–7 March 2026
- Outcome:
  - YES → WaitingTime > 48h
  - NO → WaitingTime ≤ 48h

**Settlement:**
- Oracle fetches AIS-derived timestamps
- Computes WaitingTime
- Posts YES/NO on-chain

This is:
- ✅ Objective
- ✅ Auditable
- ✅ Hedgeable
- ✅ Judge-friendly

---

### Why This Works Economically

Oil majors and traders already think in:
- "expected waiting days"
- "congestion risk"
- "port delay exposure"

We are not redefining reality — we are **standardising it**.

Even if the *legal demurrage invoice* differs:
- The risk proxy is still correct
- The hedge still pays when pain occurs

That's how **parametric insurance** works.

---

### What You Must NEVER Do

❌ "Demurrage starts when charterer decides"
❌ "Demurrage ends when paperwork clears"
❌ "Demurrage as per contract terms"

Those kill:
- transparency
- oracle credibility
- tradability

---

### One-Sentence Rule

> **In markets, demurrage is a clock — not a legal argument.**

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (UI)                        │
│              React/Vanilla JS + WebSocket                   │
├─────────────────────────────────────────────────────────────┤
│                      API Layer (Rust)                       │
│              REST + WebSocket via Axum                      │
├─────────────────────────────────────────────────────────────┤
│                    Matching Engine                          │
│         Order routing, position tracking                    │
├─────────────────────────────────────────────────────────────┤
│                      Order Book                             │
│        BTreeMap, price-time priority, O(log n)             │
├─────────────────────────────────────────────────────────────┤
│                     Core Types                              │
│           Order, Trade, Market, Position                    │
└─────────────────────────────────────────────────────────────┘
```

### Why Hybrid CLOB + On-Chain?

| Component | Location | Reason |
|-----------|----------|--------|
| Order Matching | Off-chain (Rust) | Speed (~1-10μs latency) |
| Collateral/Minting | On-chain | Trustless, auditable |
| Settlement | On-chain | Immutable, oracle-verified |

---

## CLOB Implementation

### Technology Choice: Rust

| Language | Latency | Use Case |
|----------|---------|----------|
| **Rust** | ~1-10μs | Production, crypto exchanges |
| C++ | ~1-10μs | Traditional HFT |
| Go | ~10-50μs | Good balance |
| TypeScript | ~1-5ms | Hackathon/MVP only |

### Project Structure

```
clob-rs/
├── Cargo.toml          # Dependencies
├── src/
│   ├── types.rs        # Order, Trade, Market types
│   ├── orderbook.rs    # BTreeMap-based order book
│   ├── engine.rs       # Matching engine
│   ├── api.rs          # REST + WebSocket API
│   ├── lib.rs          # Library exports
│   └── main.rs         # Server entry point
└── benches/
    └── matching_bench.rs
```

### Key Features

- **Price-Time Priority**: O(log n) insert, O(1) best price access
- **Dual Order Book**: YES bids match NO bids when prices cross
- **Thread-Safe**: parking_lot RwLock for concurrent access
- **Real-time Updates**: WebSocket broadcasting

### Running the CLOB

```bash
cd clob-rs
source ~/.cargo/env
cargo run --release
# Server starts on http://localhost:8080
```

---

## API Reference

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/markets` | List all markets |
| GET | `/api/markets/:id` | Get market + orderbook |
| POST | `/api/markets` | Create market (admin) |
| POST | `/api/orders` | Submit order |
| DELETE | `/api/orders/:id` | Cancel order |
| GET | `/api/users/:id/balance` | Get user balance |
| POST | `/api/users/:id/deposit` | Deposit funds |
| POST | `/api/markets/:id/settle` | Settle market (oracle) |

### WebSocket

Connect to `ws://localhost:8080/ws` and subscribe:

```json
{"type": "SUBSCRIBE", "marketId": "uuid-here"}
```

Receive real-time updates:
- `ORDER_BOOK` - Orderbook snapshots
- `TRADE` - New trades
- `MARKET_UPDATE` - Market status changes

### Submit Order Request

```json
{
  "market_id": "uuid",
  "user_id": "user123",
  "side": "YES",        // or "NO"
  "order_type": "LIMIT", // or "MARKET"
  "price": 35,          // 1-99 cents
  "quantity": 100
}
```

---

## Share Minting & Settlement

### Complete Set Minting

```
┌──────────────┐         ┌──────────────┐
│   YOU        │         │  COUNTERPARTY │
│  Pay: $65    │         │  Pay: $35     │
│  Get: 1 NO   │         │  Get: 1 YES   │
└──────────────┘         └──────────────┘
        │                        │
        └────────┬───────────────┘
                 ▼
        ┌──────────────┐
        │ Collateral   │
        │ Pool: $1.00  │
        └──────────────┘
```

### Settlement Flow

1. **Oracle** determines outcome (AIS data → demurrage occurred?)
2. **Contract** resolves: YES = $1 or NO = $1
3. **Winners** redeem shares for $1 each
4. **Losers** get $0

### The Math Always Works

```
Collateral Pool: $100
YES shares: 100 (held by Alice)
NO shares: 100 (held by Bob)

If YES wins:
- Alice redeems 100 YES × $1 = $100
- Bob redeems 100 NO × $0 = $0

Pool after: $0 ✓ (always solvent)
```

---

## Price Discovery

### Initial Probability Sources

1. **Historical demurrage rates** for the route
2. **Port congestion data** (MarineTraffic, AIS)
3. **Weather forecasts**
4. **Vessel reliability scores**
5. **Seasonal adjustments**

### Formula

```rust
probability = historical_rate 
    + congestion_adjustment 
    + weather_adjustment 
    + reliability_adjustment 
    + seasonal_adjustment
```

### After Market Opens

**Traders with better information** move the price to the "true" probability:
- Shipper knows cargo delayed → Buys YES
- Analyst sees port clearing → Buys NO
- Insider info on vessel issues → Buys YES

**Final price reflects aggregate knowledge** of all participants.

---

## Session Development Log

### Completed Components

1. ✅ TypeScript MVP (Node.js + Express + WebSocket)
2. ✅ Professional UI (dark theme, maritime style)
3. ✅ **Rust CLOB** (production-grade, 15/15 tests passing)
   - BTreeMap-based orderbook
   - Price-time priority matching
   - Axum REST + WebSocket API
   - Thread-safe with parking_lot

### Test Results

```
running 15 tests
test engine::tests::test_create_market ... ok
test engine::tests::test_deposit_and_balance ... ok
test engine::tests::test_matching ... ok
test engine::tests::test_settlement ... ok
test engine::tests::test_submit_order ... ok
test orderbook::tests::test_better_price_first ... ok
test orderbook::tests::test_cancel_order ... ok
test orderbook::tests::test_match_when_prices_cross ... ok
test orderbook::tests::test_no_match_when_prices_dont_cross ... ok
test orderbook::tests::test_partial_fill ... ok
test orderbook::tests::test_price_time_priority ... ok
test orderbook::tests::test_snapshot ... ok
test types::tests::test_order_creation ... ok
test types::tests::test_order_fill ... ok
test types::tests::test_price_validation ... ok

test result: ok. 15 passed; 0 failed
```

---

---

## How We Solve the Liquidity Problem

### The Problem with General Platforms (Polymarket)

```
Shipper: "I want to hedge $50K demurrage risk on MSC Oscar"

Polymarket: "We don't have that market. Even if we did..."
  • WHO would take the other side?
  • Retail speculators don't understand shipping
  • No specialized market makers
  • Zero liquidity → wide spreads → unusable

Result: Shipper goes back to expensive traditional insurance
```

### Our Solution: Natural Two-Sided Market

**WHO WANTS YES (Demurrage Insurance):**
| Participant | Why They Buy YES |
|-------------|------------------|
| Cargo owners | Hedging delay costs |
| Charterers | Contractual demurrage liability |
| Freight forwarders | Customer SLA risk |
| Commodity traders | Delivery timing risk |

*They ALREADY pay for this via traditional insurance! Market: $3-5B annually*

**WHO WANTS NO (Provides Liquidity):**
| Participant | Why They Sell YES / Buy NO | Edge |
|-------------|---------------------------|------|
| **Ship owners** | Natural hedge - if no demurrage, they profit | Private info on vessel reliability |
| **Port operators** | Know their congestion | Operational data |
| **Traditional insurers** | More efficient than underwriting | Actuarial models |
| **Trading firms** | Arbitrage, spread capture | Sophisticated risk analysis |
| **Data-driven MMs** | Algorithmic pricing | AIS, port APIs |

### Why This Creates Liquidity (Unlike Polymarket)

| Factor | Polymarket | MaritimeShield |
|--------|------------|----------------|
| **Expertise** | General public, no shipping knowledge | Domain experts with information edge |
| **Natural counterparties** | None | Shipowners, ports, insurers |
| **Data integration** | None | AIS, port congestion, weather |
| **Existing demand** | Must create from scratch | $3-5B insurance market exists |
| **Pricing clarity** | Subjective outcomes | Parametric AIS-based resolution |

### Liquidity Incentive Mechanisms

1. **Maker Rebates**: Limit orders that add liquidity get 0.5% rebate
2. **Taker Fees → LP Pool**: 0.5-1% fee redistributed to liquidity providers
3. **Insurance Premium Recycling**: Insurers deposit, sell YES, keep NO
4. **Data Provider Integration**: AIS companies run MM bots (monetize data)
5. **Shipowner Natural Hedge**: Sell YES on their own vessels

### Example: How a $100K Hedge Gets Filled

```
Charterer wants to hedge $100K demurrage exposure on MSC Oscar
Market price: YES @ 35¢ (35% implied probability)

WHO FILLS THE ORDER:
┌────────────────────────────────────────────────────────────┐
│  Trading firm MM (algorithmic)     │  40%  │  $40K       │
│  Shipowner (knows vessel reliable) │  30%  │  $30K       │
│  Insurer (reinsurance play)        │  20%  │  $20K       │
│  Data-driven MM (using AIS)        │  10%  │  $10K       │
└────────────────────────────────────────────────────────────┘

Cost to charterer: $35,000 for $100K max payout

OUTCOME A - Demurrage occurs:
  Charterer: +$100K payout - $35K cost = +$65K (offsets real loss)
  Counterparties: -$65K net (but they knew the risk)

OUTCOME B - On time:
  Charterer: -$35K (but no demurrage cost anyway)
  Counterparties: +$35K profit (reward for taking risk)
```

### Bootstrap Strategy

| Phase | Action | Goal |
|-------|--------|------|
| 1. Internal | Platform seeds $50-100K/market | Prove mechanics |
| 2. Partnerships | 2-3 trading firms with 1% rebate | Professional liquidity |
| 3. Insurers | Onboard marine insurers | Deep institutional liquidity |
| 4. Organic | LP tokens, yield farming | Self-sustaining |

---

## Next Steps

- [ ] Add AIS edge case handling (diversion, re-anchoring, weather holds)
- [ ] Define allowance thresholds for liquid markets
- [ ] Draft contract wording for legal/trader trust
- [ ] Implement on-chain settlement (Solidity/Solana)
- [ ] Add oracle integration for AIS data
- [ ] Build market maker SDK for trading firms
- [ ] Partner with AIS data providers (MarineTraffic, VesselFinder)

---

*Last updated: Session in progress*
