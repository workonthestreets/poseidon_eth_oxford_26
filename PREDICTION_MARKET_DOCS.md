# Prediction Market Documentation Reference

## Sources
- Polymarket: https://docs.polymarket.com/quickstart/overview
- Opinion.trade: https://docs.opinion.trade/

---

## KEY INSIGHT: YES and NO are INDEPENDENT Orderbooks

### Answer to "Does buying NO influence YES histogram?"

**NO - They are completely independent.**

From Polymarket docs:
> "Polymarket outcomes shares are binary outcomes (ie "YES" and "NO") using Gnosis' Conditional Token Framework (CTF). They are **distinct ERC1155 tokens** related to a parent condition and backed by the same collateral."

Each token (YES and NO) has:
- Its own ERC1155 token ID (positionId)
- Its own orderbook with BUY and SELL sides
- Independent price discovery

**Buying NO tokens does NOT affect the YES orderbook histogram.**
**Selling YES tokens does NOT affect the NO orderbook histogram.**

---

## How Prices Work

From Polymarket:
> "Shares in event outcomes are always priced between 0.00 and 1.00 USDC, and every pair of event outcomes (i.e. each pair of "YES" + "NO" shares) is **fully collateralized by $1.00 USDC**."

Key points:
- YES price + NO price does NOT need to equal $1.00 in the orderbooks
- They are separate markets with separate prices
- Arbitrage keeps them roughly balanced (if YES=40¢ and NO=40¢, arbitrageurs can profit)

---

## Token Operations

### Split (Minting)
- **Input**: 1 USDC
- **Output**: 1 YES token + 1 NO token
- Function: `splitPosition()` on CTF contract
- Anyone can split at any time

### Merge (Burning)
- **Input**: 1 YES token + 1 NO token
- **Output**: 1 USDC
- Function: `mergePositions()` on CTF contract
- Requires owning both tokens

### Redeem (Settlement)
- After market resolves:
  - If YES wins: 1 YES token → $1 USDC, NO tokens → $0
  - If NO wins: 1 NO token → $1 USDC, YES tokens → $0

---

## Order Types

### Limit Order
- Rests in orderbook until filled or cancelled
- Provides liquidity
- GTC (Good Till Cancelled) - default
- GTD (Good Till Date) - expires at specified time

### Market Order
- Executes immediately at best available price
- Takes liquidity
- FOK (Fill or Kill) - all or nothing
- FAK (Fill and Kill) - partial fill ok, rest cancelled

---

## Orderbook Structure (Per Token)

Each token (YES, NO) has:
```
┌─────────────────────────────┐
│         ASKS (SELL)         │  ← Users selling this token
│  Price ↓  |  Qty  |  Total  │
│   52¢     |  100  |  $52    │
│   51¢     |  200  |  $102   │
│   50¢     |  150  |  $75    │  ← Best Ask
├─────────────────────────────┤
│         SPREAD: 2¢          │
├─────────────────────────────┤
│   48¢     |  200  |  $96    │  ← Best Bid
│   47¢     |  150  |  $70    │
│   45¢     |  300  |  $135   │
│         BIDS (BUY)          │  ← Users buying this token
└─────────────────────────────┘
```

---

## Trading Flow

### To BUY YES tokens:
1. Place BUY order on YES orderbook
2. Matches against SELL orders on YES orderbook
3. You pay USDC, receive YES tokens

### To SELL YES tokens:
1. Must own YES tokens first (via split or previous purchase)
2. Place SELL order on YES orderbook
3. Matches against BUY orders on YES orderbook
4. You give YES tokens, receive USDC

### NO tokens work identically but independently

---

## Arbitrage Opportunity

If YES = 40¢ and NO = 40¢:
1. Buy 1 YES @ 40¢ = $0.40
2. Buy 1 NO @ 40¢ = $0.40
3. Total cost: $0.80
4. Guaranteed payout: $1.00 (one wins)
5. Profit: $0.20 (25% return)

This arbitrage keeps prices roughly balanced around YES + NO ≈ $1.00

---

## Implementation Notes for MaritimeShield

### Current (Correct) Implementation:
- YES and NO have separate `SingleTokenBook` instances
- Each has independent `bids` and `asks` BTreeMaps
- Buying YES only affects YES orderbook
- Buying NO only affects NO orderbook

### UI Display:
- Show two separate orderbook views (YES and NO)
- Each shows its own BUY/SELL depth
- Depth histogram is per-token, not combined

### What NOT to do:
- ❌ Don't merge YES bids with NO asks
- ❌ Don't show NO orders in YES histogram
- ❌ Don't convert "buy NO" to "sell YES"

---

## API Endpoints Reference

### Polymarket CLOB API
- Base: `https://clob.polymarket.com`
- `POST /order` - Place order
- `DELETE /order/{id}` - Cancel order
- `GET /book` - Get orderbook
- `GET /price` - Get mid price

### WebSocket
- `wss://ws-subscriptions-clob.polymarket.com`
- Subscribe to orderbook updates
- Subscribe to trade notifications

---

## Resolution

Markets resolve via oracle (UMA for Polymarket):
1. Oracle submits outcome (YES or NO won)
2. Winning tokens redeemable for $1.00 each
3. Losing tokens worth $0.00
4. Users call `redeemPositions()` to claim

---

## Key Differences from Traditional Exchanges

| Traditional | Prediction Market |
|-------------|-------------------|
| One asset | Two assets (YES/NO) |
| Buy/Sell same thing | Buy/Sell different tokens |
| No expiry | Resolves at event |
| No guaranteed payout | Winner gets $1.00 |
| Can't create shares | Can split USDC into shares |
