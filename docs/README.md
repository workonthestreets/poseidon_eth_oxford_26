# Maritime Risk Hedging – Hackathon Project

## Project Overview
Our project is a hybrid Web2/Web3 prediction market for maritime logistics risks, allowing hedgers and insurers to protect against events such as:

- Vessel casualty / sinking  
- FCS (Port / Regulatory) clearance delays  
- Voyage time overruns  

The platform uses **Flare's FDC protocol** to connect Web2 data sources with on-chain smart contracts, providing verified inputs for deterministic settlement.

---

## Why Auctions With Locked Quotes?

Instead of an open prediction market that trades continuously throughout a vessel's voyage, we chose **discrete auctions with locked quotes** for each risk market. This design mitigates **toxic flow** problems:

1. **Toxic flow risk:**  
   In a continuous market, insider actors (crew, port authorities, or insurers) could exploit non-public information to manipulate market prices before public events occur.  
   
2. **Discrete auctions:**  
   - Hedgers and insurers submit their risk positions within a defined window.  
   - Quotes are locked at submission, preventing reactive trading based on early hints or leaks.  
   - Settlement occurs once the event outcome is verified by FDC or DA layers.  

3. **Controlled liquidity and risk exposure:**  
   Auctions limit the number of participants per round, preventing extreme price swings from early insider actions.  

4. **Clear payout calculation:**  
   Locked quotes combined with deterministic core logic ensure predictable payouts, simplifying settlement in smart contracts.

---

## System Architecture

The architecture separates **pure logic** (deterministic calculations) from **effectful operations** (API calls, blockchain interactions, UI updates).  

**Layered Architecture:**  
UI / Frontend → Market Adapter → Oracle / FDC → DA Verification → Core Logic → Backend / Logging → Smart Contract → Token / Collateral

### Layer Details

**1. UI / Frontend (Web2)**  
- Collects user input: vessel, risk market, hedge amount  
- Displays vessel location, market positions, and payouts  
- Effectful: network requests, user interactions  

**2. Market Adapter**  
- Translates UI input into structured JSON for Oracle / FDC  
- Handles Datalastic API requests for vessel positions or returns mock JSON if unavailable  
- Effectful: API calls, error handling, fallback to mock data  

**3. Oracle / FDC**  
- Supplies verified event outcomes and price feeds  
- Provides Mark-to-Market and fallback submissions for unavailable API data  
- Effectful: blockchain reads, verification, and fallback handling  

**4. DA (Data Aggregator / Verification)**  
- Aggregates multiple sources, validates integrity, resolves conflicts  
- Effectful: verification, anomaly detection, fraud prevention  

**5. Core Logic (Pure Functions)**  
- Deterministic payout calculation: same input always produces same output  
- Inputs: validated JSON from DA  
- Outputs: computed payouts  

**6. Backend / Logging**  
- Sends updates to frontend, logs transactions, and prepares smart contract submission  
- Effectful: logging, data communication  

**7. Smart Contract (Flare)**  
- Manages settlement, collateral, and tokenized outcome positions  
- Receives validated inputs, executes payouts  
- Effectful: blockchain writes  

**8. Token / Collateral Layer**  
- Represents user positions in stable tokens (USDC)  
- Tracks margin, collateral, and payouts  
- Effectful: fund movements, liquidations, token transfers  

---

## Data Flow

| From | To | Description |
|------|----|-------------|
| UI / Frontend | Market Adapter | Submit structured auction positions |
| Market Adapter | Oracle / FDC | Fetch vessel & event data (or mock JSON) |
| Oracle / FDC | DA | Verified events & price feeds |
| DA | Core Logic | Validated deterministic input |
| Core Logic | Backend / Logging | Compute payouts |
| Backend / Logging | Smart Contract | Submit settlement transactions |
| Smart Contract | Token / Collateral | Update balances / mint tokens |
| Token / Collateral | UI / Frontend | Display updated positions |

---

## FDC Fallback Implementation

- **Primary:** live API submission through FDC for verified outcomes  
- **Fallback:** static mock JSON structured for FDC, ensuring market resolution even without live data  
- Core logic is unaffected; only the effectful layers switch between live and fallback inputs  

---

## Security and Anti-Manipulation Measures

- **Toxic flow mitigation:** discrete auction with locked quotes prevents early exploitation  
- **Insider risk monitoring:** DA layer flags anomalous or conflicting submissions  
- **Smart contract enforcement:** automated settlement and collateral management prevent manual tampering  

---

## Bounty Feedback: Flare Protocols

- FDC integration allowed verified event submission from Web2 to on-chain contracts seamlessly  
- Separation of effectful and pure layers made testing and fallback management easier  
- Implementing fallback handling required explicit FDC submission patterns, which could be clarified in future documentation
- While attempting to use Flare's Web2Json on the TestNet, we encountered significant difficulties on the server's end pertaining to DA validation
- Overall, FDC is well-suited for risk market settlement with minimized reliance on untrusted off-chain sources. Ideally, it would be better if the aforementioned problem were solved for ease-of-use.

---

## Current Status

- Frontend complete: vessel map, auction UI, risk markets, limit positions  
- Backend / smart contract: placeholders ready for integration with live API or JSON fallback  
- Core logic and effectful layers: fully separated and documented  
- Auctions implemented with locked quotes; ready for settlement once backend and smart contracts are live  

---

**End of README.md**
