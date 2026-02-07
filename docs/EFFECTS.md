# Effects.md – Updated for Hackathon Submission

## Project: Maritime Risk Markets
**Team Role:** Architecture & Effect Documentation  
**Purpose:** Document effectful and pure components, data flows, and oracle interactions for developers and judges.

---

## 1. System Overview

The system is a hybrid Web2/Web3 prediction market for maritime operational risks. Users can hedge against:

- Vessel casualty / sinking  
- FCS (Port / Regulatory) clearance delays  
- Voyage time overruns  

The architecture separates **pure logic** (deterministic calculations) from **effectful operations** (API calls, blockchain interactions, UI updates).

**Current Layered Architecture:**

UI / Frontend → Market Adapter → Oracle / FDC → DA Verification → Core Logic → Backend / Logging → Smart Contract → Token / Collateral

**Notes:**  
- Backend currently accepts mock JSON; easily switchable to live API without changing core logic.  
- Frontend implements user-facing functionality; no on-chain order matching (CLOB-style UX only).  

---

## 2. Layer Descriptions & Responsibilities

### 2.1 UI / Frontend (Web2)
- Collects user input: vessel selection, risk market, hedge amount  
- Displays: payouts, market positions, vessel location map, risk probabilities  
- Sends structured data to Market Adapter  
- Effectful: user interactions, network calls

**Sample Input Structure:**  
user: Alice  
vessel: MAERSK CHENNAI  
risk_type: voyage_time  
amount: 5000

---

### 2.2 Market Adapter
- Translates UI input into structured data for oracle queries and core logic  
- Handles API requests to Datalastic (e.g., `/vessel_inradius`)  
- Returns validated JSON, or mock data if API unavailable  
- Effectful: API requests, error handling, mock data generation

**Sample API request:**  
GET https://api.datalastic.com/api/v0/vessel_inradius?api-key=KEY&lat=51.90&lon=4.50&radius=50

**Sample API response fields:**  
- imo  
- lat  
- lon  
- speed  
- course  
- heading  
- nav_status  
- destination  
- last_position_UTC  

---

### 2.3 Oracle / FDC
- On-chain data provider for verified event outcomes  
- Supplies:  
  - Event verification (PSC clearance, casualties)  
  - Price feeds for collateral  
  - Mark-to-Market valuations  
- Effectful: blockchain reads, verification, fallback to mock data if API unavailable

**FDC Fallback:**  
- Primary: live API data via FDC  
- Fallback: static mock data submitted through FDC schema  
- Ensures contracts can resolve markets reliably even without live API

---

### 2.4 DA (Data Availability / Verification)
- Web3-enabled verification layer  
- Aggregates multiple sources (API + FDC)  
- Checks data integrity, resolves conflicts, flags anomalies  
- Supplies validated input to core logic  
- Effectful: data verification, anomaly detection, integrity enforcement

---

### 2.5 Core Logic (Pure Functions)
- Computes payouts deterministically based on validated input  
- Stateless, auditable, testable

**Example calculation:**  
payout = amount * multiplier * max(0, actualDays - plannedDays)

- Inputs: validated data  
- Outputs: deterministic payout numbers  
- Pure: same input → same output

---

### 2.6 Backend / Logging
- Handles effectful operations such as:  
  - Logging computations and transactions  
  - Sending updates to frontend  
  - Preparing contract submission

---

### 2.7 Smart Contract (Flare)
- Handles on-chain settlement and collateral management  
- Receives validated input from backend  
- Locks collateral, mints outcome tokens, executes payouts  
- Effectful: blockchain writes, state transitions

---

### 2.8 Token / Collateral Layer
- Represents user positions in stable tokens (e.g., USDC)  
- Tracks margin, collateral, and payouts  
- Effectful: fund transfers, liquidations, updates to UI

---

## 3. Data Flow & Arrow Labels

| From | To | Arrow Label / Description |
|------|----|---------------------------|
| UI / Frontend | Market Adapter | Submit structured risk data |
| Market Adapter | Oracle / FDC | Fetch vessel & event data |
| Oracle / FDC | DA | Verified events & price feeds |
| DA | Core Logic | Validated, deterministic input |
| Core Logic | Backend / Logging | Payout computations |
| Backend / Logging | Smart Contract | Submit resolution transaction |
| Smart Contract | Token / Collateral | Update balances / mint outcome tokens |
| Token / Collateral | UI / Frontend | Display updated positions |

---

## 4. Notes

- **Web2 Layers:** UI, Market Adapter, Backend Logging  
- **Web3 Layers:** Oracle / FDC, DA, Smart Contract, Token  
- **Effectful Operations:** network calls, blockchain writes, logging  
- **Pure Operations:** core logic / deterministic payout calculation  

- **Insider risk / malicious actors:** DA verification detects conflicts, anomalies, and potential fraud. Smart contracts enforce transparent settlement and margin rules.  

- **Mocking & Testing:**  
  - API responses and Oracle submissions can be mocked during hackathon  
  - Core logic remains deterministic; only effectful layers interact with external systems  

---

## 5. Bounty-Specific Feedback on Flare Protocols

- **FDC Implementation:** smooth integration into Web3 layer; allows verified inputs to smart contracts without trusting off-chain sources  
- **Strengths:** easy to swap JSON mock for live API; separation of pure and effectful layers is clear; deterministic core logic simplifies testing  
- **Challenges:** fallback patterns require explicit FDC submission; documentation could provide more end-to-end examples  
- **Assessment:** FDC is suitable for real-world maritime event settlement; effectful operations are minimized and controlled, fulfilling the Flare bounty criteria

---

**End of Effects.md**
