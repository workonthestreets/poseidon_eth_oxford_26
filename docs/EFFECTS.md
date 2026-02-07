# Effects.md Draft 2 Saturday Morning

## Project: Maritime Hedging Prediction Market
**Team Role:** Architecture & Effect Documentation  
**Purpose:** Capture all effectful and pure components of the system, data flows, and API interactions for judges and developers.

---

## 1. System Overview

The system is a hybrid Web2/Web3 prediction market for maritime logistics risks. Users can hedge against events such as:

- Port State Control (PSC) Detention  
- Dry Dock Delays  
- Voyage Delays  
- Port Congestion  
- Engine Failure / Sinking  

The architecture separates **pure logic** (deterministic computations) from **effectful operations** (API calls, blockchain interactions, UI updates).

**Layered Architecture:**

UI / Frontend → Market Adapter → Oracle / FDC → DA Verification → Core Logic → Backend / Logging → Smart Contract / FTSO → Token / Collateral

---

## 2. Layer Descriptions & Responsibilities

### 2.1 UI / Frontend (Web2)
- Collects user inputs (vessel IMO, selected risk, amount to hedge)  
- Displays payouts, market positions, vessel locations, and risk probabilities  
- Sends structured JSON to the Market Adapter  
- Effectful: user interactions, network requests

Sample JSON input:

{ "user": "Alice", "vessel": "MAERSK CHENNAI", "risk_type": "demurrage", "amount": 5000 }

---

### 2.2 Market Adapter
- Translates UI input into API calls and structured data  
- Handles Web2 API requests (e.g., Datalastic `/vessel_inradius`)  
- Converts responses into validated JSON for downstream layers  
- Effectful: fetching real-time vessel locations, handling API errors, returning mock JSON when needed

Example API call:

curl "https://api.datalastic.com/api/v0/vessel_inradius?api-key=KEY&lat=51.90&lon=4.50&radius=10"

Example API response:

[ { "imo": "9525338", "lat": 6.303473, "lon": 103.456789, "speed": 12.5 }, { "imo": "9525339", "lat": 6.303000, "lon": 103.457000, "speed": 11.8 } ]

---

### 2.3 Oracle / FDC
- On-chain event and price feed provider  
- Provides:
  - Verified event outcomes (e.g., PSC inspection results)  
  - Price feeds for collateral valuation (via FTSO)  
  - Continuous Mark-to-Market valuations  
- Effectful: reads blockchain data, validates events, supplies pricing

---

### 2.4 DA (Data Aggregator / Verification Layer)
- Web3-enabled layer  
- Aggregates data from multiple sources (API + Oracle)  
- Verifies integrity and resolves conflicts  
- Provides validated input for core logic  
- Effectful: data verification and risk checking

---

### 2.5 Core Logic (Pure Functions)
- Deterministic computation of payouts based on validated input  
- Sample function:

function computeDemurragePayout(amount, delayDays, rate) { return amount * delayDays * rate; }

- Inputs: validated JSON with event parameters  
- Outputs: deterministic payout numbers  
- Pure: same input → same output

---

### 2.6 Backend / Logging
- Handles effectful operations like:
  - Logging computations and transactions  
  - Sending updates to the frontend/UI  
  - Preparing data for smart contract submission  

---

### 2.7 Smart Contract / FTSO
- Handles on-chain settlement and collateral management  
- Interacts with backend for:
  - Locking collateral  
  - Minting outcome tokens  
  - Executing payouts based on resolved events  
- Effectful: writes to blockchain, triggers state transitions

---

### 2.8 Token / Collateral Layer
- Represents user positions in a stable token or USDC  
- Tracks margin, collateral, and payout balances  
- Effectful: fund movements, liquidation checks, token transfers

---

## 3. Data Flow & Arrow Labels

| From | To | Arrow Label / Description |
|------|----|---------------------------|
| UI / Frontend | Market Adapter | Submit risk JSON |
| Market Adapter | Oracle / FDC | Fetch vessel & event data |
| Oracle / FDC | DA | Validated events & price feeds |
| DA | Core Logic | Verified JSON input |
| Core Logic | Backend / Logging | Payout calculation |
| Backend / Logging | Smart Contract / FTSO | Submit settlement transaction |
| Smart Contract / FTSO | Token / Collateral | Update balances / mint tokens |
| Token / Collateral | UI / Frontend | Display updated positions |

---

## 4. Notes

- **Web2 layers:** UI / Market Adapter / Backend Logging  
- **Web3 layers:** Oracle / DA / Smart Contract / Token  
- **Effectful operations:** anything that interacts with the outside world, blockchain, API, or logs  
- **Pure operations:** Core logic (deterministic payout calculation)  

- **Insider risk / malicious actors:** DA verification layer checks for conflicting reports, anomalous data, and fraud attempts. Smart contracts enforce transparent settlement and margin rules.  

- **Mocking & Testing:**  
  - During hackathon, API responses and Oracle submissions can be mocked to simulate events.  
  - Core logic is always pure and deterministic; only the effectful layers interact with live data.  

---

**End of Effects.md**
