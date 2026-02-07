# Maritime Risk Markets on Flare

A decentralized prediction market system for maritime operational risk, enabling transparent, oracle-backed trading on shipping events such as vessel casualties, regulatory clearance delays, and voyage duration.

Built during a hackathon with a focus on clean system architecture, oracle reliability, and Web2 → Web3 interoperability using Flare’s FDC protocol.

---

## Problem

Maritime logistics faces significant uncertainty:
- Vessel casualties and sinkings
- Delays due to port and FCS clearance
- Voyage time overruns caused by congestion, weather, or rerouting

These risks are currently opaque, difficult to hedge, and inaccessible to most market participants.

---

## Solution

We introduce vessel-specific risk markets where users can trade on the probability of defined maritime events using oracle-backed settlement on Flare.

Each vessel has three active risk markets:
1. Casualty / Sinking Risk
2. FCS (Port / Regulatory) Clearance Risk
3. Voyage Time Risk

Markets are powered by off-chain maritime data and resolved on-chain using Flare Data Connector (FDC).

---

## High-Level Architecture

The system is modular and layered to separate concerns clearly. A more visually-friendly version of this flowchart will be shown in the presentation.

UI / Frontend (Web2)
↓
Market Adapter (Order-Book UI Abstraction)
↓
Oracle Request Layer (Flare FDC)
↓
Data Availability & Verification (DA)
↓
Pure Core Logic (Deterministic)
↓
Effectual Backend Layer
↓
Smart Contracts (Flare)
↓
Token Collateral & Settlement

---

## Architecture Breakdown

### 1. Frontend (Web2)

The frontend provides a CLOB-style market interface as a UI abstraction.

**Clarification:**
> This is not an on-chain CLOB, because it doesn't need to be. The frontend implements order-book-style UX only and outputs normalized user intents.

Features:
- Vessel selector (name, IMO)
- Three risk markets per vessel
- Price ladder and depth display
- Market and limit order inputs
- Vessel location map (lat/lon)
- Real-time market state rendering

---

### 2. Market Adapter

- Translates frontend actions into structured market intents
- Normalizes orders across risk markets
- Prepares oracle queries and settlement parameters

No trade matching occurs here.

---

### 3. Oracle Layer (Flare Data Connector – FDC)

FDC bridges off-chain maritime data into Web3 settlement logic.

Responsibilities:
- Fetch vessel data (location, speed, status, timestamps)
- Validate responses via FDC attestation
- Provide cryptographically verifiable inputs to smart contracts

**Oracle Fallback Strategy**
- Primary: Live API data routed through FDC
- Fallback: Static JSON submitted through the same FDC schema

Fallback preserves:
- Oracle verification
- Contract interface
- Easy swap to live APIs without architectural changes

---

### 4. Data Availability & Verification (DA)

- Validates oracle payloads
- Ensures completeness and schema correctness
- Prevents malformed data from reaching settlement logic

This layer can use Web2 or Web3 primitives depending on deployment.

---

### 5. Core Logic (Pure Functions)

- Risk probability calculations
- Payout multiplier computation
- Market resolution conditions

**Properties:**
- Stateless
- Deterministic
- Auditable and testable

---

### 6. Effectual Backend Layer

Handles side effects only:
- UI updates
- Logging
- Oracle request coordination
- Contract calls

Business logic resides in the pure core logic layer.

---

### 7. Smart Contracts (Flare)

- Market creation
- User positions
- Oracle-based resolution
- Payout settlement

Contracts consume **FDC-verified data only**, ensuring trust-minimized settlement.

---

### 8. Token Collateral Layer

- Users post collateral to enter markets
- Funds are escrowed until resolution
- Payouts distributed based on outcomes

---

## Data Sources

### Hackathon Status
- Static JSON fixtures emulate API responses
- Hot-swappable for live API integration without refactoring

### Production Mode
- Replace JSON with live maritime APIs
- No changes required to oracle flow, core logic, or contracts

---

## Security & Market Integrity

- Oracle-based settlement reduces manipulation
- Deterministic core logic prevents discretionary resolution
- DA layer protects against malformed data
- Architecture limits insider influence from vessel operators

---

## Flare Protocol Usage & Feedback (Bounty Section)

### Strengths
- FDC attestation model fits prediction markets naturally
- Clear separation of data retrieval and settlement
- Easy to mock JSON and later swap real data without contract changes

### Challenges
- FDC documentation could use more end-to-end examples
- Fallback patterns are not fully detailed
- More local FDC simulation tooling would speed development

**Overall Assessment:**  
FDC is a strong primitive for real-world event settlement. It encourages clean architecture and reduces oracle trust assumptions, especially suitable for physical-world events like shipping.

---

## Future Work

- Live API integration
- On-chain order matching
- Expanded risk categories
- Liquidity incentives
- DAO-based market governance

---

## Conclusion

This project demonstrates how real-world maritime risk can be transformed into transparent, oracle-backed financial markets using Flare’s infrastructure. By cleanly separating UI, data, logic, and settlement, the system is hackathon-ready and production-capable.
