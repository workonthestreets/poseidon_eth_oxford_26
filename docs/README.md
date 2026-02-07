# 🌊 Maritime Risk Markets  
### On-chain prediction markets for real-world maritime events, powered by Flare FDC

---

## 🧠 Overview

Maritime logistics underpins global trade, yet risk around vessel operations remains opaque, fragmented, and difficult to hedge. This project introduces **on-chain risk markets for maritime events**, enabling transparent, real-time price discovery around vessel-specific risks.

Using **Flare’s Flare Data Connector (FDC)**, we bridge Web2 maritime data into Web3 markets, allowing users to trade on outcomes such as:

- 🚢 **Casualty / Sinking Risk**
- 🛂 **FCS (Port & Customs) Clearance Risk**
- ⏱ **Voyage Time Risk**

Each vessel has its own set of risk markets, traded via a **CLOB-style market interface**, with settlement handled on-chain once verified real-world data is available.

This system is designed for:
- Traders and hedgers exposed to maritime risk  
- Logistics firms seeking transparent risk pricing  
- Insurers and reinsurers exploring on-chain primitives  
- Data-driven DeFi users interacting with real-world outcomes  

---

## 🧩 Core Idea

> **Real-world maritime events → verifiable data → on-chain settlement**

The key challenge is trustless verification of off-chain events. We solve this by anchoring maritime data to Flare using **FDC attestations**, enabling smart contracts to settle markets based on externally verified outcomes.

---

## 🏗 System Architecture

### High-Level Flow

Frontend (Web UI)
↓
Market Adapter (CLOB Interface)
↓
Oracle Request (Flare FDC)
↓
Data Attestation (DA Layer)
↓
Core Market Logic
↓
Backend / Settlement Layer
↓
Smart Contracts
↓
Token Collateral & Payouts

yaml
Copy code

### Component Breakdown

#### 1. Frontend (Web2)
- Vessel selection (name, IMO number)
- Risk market selection (3 markets per vessel)
- Order placement (limit & market orders)
- Price ladder and order book (CLOB-style)
- Vessel map and metadata display

The frontend is intentionally decoupled from backend logic, allowing seamless integration once oracle-backed settlement is live.

---

#### 2. Market Adapter
Acts as a translation layer between UI actions and on-chain logic:
- Normalizes orders
- Routes market interactions
- Abstracts oracle dependencies from the UI

---

#### 3. Flare Data Connector (FDC)
FDC is used to securely bridge Web2 maritime data into the blockchain environment.

**Role of FDC in our system:**
- Requests verifiable maritime data (e.g. vessel position, timestamps, clearance status)
- Produces cryptographic attestations
- Enables deterministic on-chain settlement logic

This is the core Web2 → Web3 bridge in the architecture.

---

#### 4. Data Attestation (DA) Layer
The DA layer verifies that:
- The data source is authentic
- The data matches the requested schema
- The attestation can be trusted by smart contracts

Only verified data is allowed to influence settlement.

---

#### 5. Core Logic & Settlement
Once attestations are confirmed:
- Market outcomes are resolved
- Winning positions are calculated
- Settlement instructions are passed to smart contracts

---

#### 6. Smart Contracts & Collateral Layer
- Manages collateral
- Enforces payout rules
- Guarantees non-custodial settlement
- Ensures deterministic resolution

---

## 🔁 Feedback Loops

The architecture intentionally includes feedback loops:

- Oracle updates can trigger market resolution
- Settlement events update frontend state
- Prices reflect collective risk perception over time

This mirrors real-world markets rather than static prediction bets.

---

## 📊 Data Handling Strategy

### Current Implementation
Due to hackathon time constraints and API limits, the system currently uses **structured JSON dummy data** that mirrors live maritime API responses.

### Design Intention
The data layer is fully abstracted. Switching from dummy data to live APIs requires:
- Replacing the data provider module
- Keeping schemas unchanged
- Plugging FDC requests into the same interface

This makes the transition from mock → production trivial.

---

## 🧪 Effectual Design Philosophy

The project follows an **effectual engineering approach**:

- Build the smallest credible end-to-end flow
- Design for replaceability, not perfection
- Prioritize verifiability over completeness
- Optimize for demo realism under constraints

Every mocked component has a clearly defined production counterpart.

---

## 🔗 Web2 ↔ Web3 Boundary

| Layer | Domain |
|-----|------|
| UI | Web2 |
| Market Adapter | Hybrid |
| FDC & DA | Web3 |
| Core Logic | Web3 |
| Smart Contracts | Web3 |
| Collateral | Web3 |

Flare FDC is the **critical trust boundary**, eliminating the need for centralized oracles.

---

## 🔥 Why Flare?

Flare is uniquely suited for this use case because:
- Native oracle infrastructure
- Deterministic data attestations
- Seamless smart contract integration
- Designed for real-world data

---

## 🧠 Flare FDC: Developer Feedback

### What Worked Well
- Clear conceptual model for data attestations  
- Strong separation between data providers and smart contracts  
- FDC’s design makes oracle logic auditable and composable  
- Well-suited for non-financial real-world data  

### Challenges
- Documentation could benefit from more end-to-end examples
- More reference architectures would help new teams onboard faster
- Testing flows involving attestations can be non-trivial under time pressure

### Overall Impression
Flare FDC is one of the most production-ready approaches to decentralized data verification we’ve seen. It significantly lowers the barrier to building serious Web2-integrated dApps without sacrificing trust assumptions.

We would strongly consider Flare for any future project requiring real-world data settlement.

---

## 🚀 Future Work
- Live integration with maritime data providers
- Full oracle-backed settlement
- Advanced market types
- Insurance-native risk instruments
- Cross-chain settlement extensions

---

## 🏁 Conclusion

This project demonstrates how **real-world maritime risk can be priced, traded, and settled on-chain** using Flare’s oracle infrastructure.

Even under hackathon constraints, the system is architected for realism, extensibility, and production viability.

---

Built with ❤️ for Flare.
