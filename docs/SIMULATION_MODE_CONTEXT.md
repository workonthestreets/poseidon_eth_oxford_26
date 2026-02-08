# Simulation Mode - Product Demo Feature

## Overview
Create a simulation button/panel that allows stepping through 4 discrete timestamps to demonstrate the full product lifecycle: share emission, settlement, and hedging mechanisms.

## The 4 Stages

| Stage | Name | Description |
|-------|------|-------------|
| 1 | **Pre-departure** | Auction open, users place bids via RFQ, prices discovered |
| 2 | **Departure** | Auction closes, shares emitted to matched bids, positions locked |
| 3 | **Event Occurs** | Maritime event happens (PSC detention, casualty, or safe passage) |
| 4 | **Settlement** | Outcome revealed, payouts calculated, winners can claim |

## UI Components Needed

### Controls
- Timeline slider OR "Next Stage" / "Previous Stage" buttons
- Current stage indicator (visual progress bar)
- Reset button to restart simulation

### Stage 1: Pre-departure
- Auction status: OPEN
- RFQ form active
- Show mock bids coming in
- Display: probability, best bid, total pool growing

### Stage 2: Departure
- Auction status: CLOSED
- Show `commitPositions()` executing
- Display: shares emitted to users (YES/NO positions)
- Show position breakdown (who holds what)

### Stage 3: Event Occurs
- Alert/modal showing the event
- Options: "PSC Detention Occurred!" or "Vessel Passed Inspection"
- Show oracle data being submitted
- Visual drama (animation, color change)

### Stage 4: Settlement
- Show `settle()` execution with outcome
- Display payout calculations:
  - Winners: amount they receive
  - Losers: shares worthless
  - Protocol fee: 2% deducted
- Claim button becomes active
- Show `claim()` transactions

## Implementation Approaches

### Option A: Client-Side Simulation (Recommended for Demo)
- All state changes in React
- No gas costs
- Instant transitions
- Pre-defined mock data for each stage
- Good for: presentations, hackathon demos

### Option B: On-Chain Simulation
- Actually call contract functions
- Use Hardhat local node or Coston2 testnet
- Real transactions (costs gas on testnet)
- More realistic but slower
- Good for: technical validation, testing

## Mock Data Per Stage

### Sample Vessel: MV Pacific Sentinel
- Route: Shanghai → Rotterdam
- Market: PSC Clearance (82% probability)

### Stage 1 Data
```
Auction: OPEN
Best Bid: $0.84
Total Pool: $125,000
Bids: 47
Time Remaining: 18h 23m
```

### Stage 2 Data
```
Auction: CLOSED
Shares Emitted: 148,809 total
- User A: 5,000 YES @ $0.84 (paid $4,200)
- User B: 3,000 NO @ $0.16 (paid $480)
- User C: 2,000 YES @ $0.82 (paid $1,640)
```

### Stage 3 Data
```
EVENT: PSC Inspection Result
Outcome: DETAINED (YES wins)
Source: Tokyo MOU Database
Deficiency Count: 12
Detention Duration: 5 days
```

### Stage 4 Data
```
Settlement: YES WINS
Payouts:
- User A: 5,000 shares × $1.00 = $5,000 (profit: $800)
- User B: 3,000 shares × $0.00 = $0 (loss: $480)
- User C: 2,000 shares × $1.00 = $2,000 (profit: $360)
Protocol Fee: 2% = $140
```

## Technical Notes

- Contract functions needed: `createMarket()`, `commitPositions()`, `settle()`, `claim()`
- Oracle functions: `submitPSCInspectionManual()` for demo data
- UI state: `simulationStage: 1 | 2 | 3 | 4`
- Consider adding "Auto-play" mode that advances every 5 seconds

## Priority
- Implement after core functionality is complete
- Great for hackathon judging demos
- Can be toggled on/off via settings or URL param (?demo=true)
