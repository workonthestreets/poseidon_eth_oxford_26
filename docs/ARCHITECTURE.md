# MaritimeShield Architecture Guide

## Connecting Rust CLOB with Web3 Smart Contracts

This document outlines the full architecture for integrating the off-chain Rust CLOB with on-chain Ethereum/Polygon smart contracts, following the Polymarket model.

---

## Table of Contents
1. [System Overview](#system-overview)
2. [Architecture Diagram](#architecture-diagram)
3. [Smart Contract Layer](#smart-contract-layer)
4. [Rust CLOB Layer](#rust-clob-layer)
5. [Integration Bridge](#integration-bridge)
6. [Oracle Integration](#oracle-integration)
7. [Data Flow](#data-flow)
8. [Implementation Roadmap](#implementation-roadmap)
9. [Security Considerations](#security-considerations)

---

## System Overview

MaritimeShield uses a **hybrid architecture** similar to Polymarket:

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Settlement** | Solidity (Polygon) | Token custody, minting, redemption |
| **Matching** | Rust CLOB | Order matching, price discovery |
| **Oracle** | Chainlink + AIS Data | Demurrage verification |
| **Frontend** | Web3 + REST API | User interaction |

**Why Hybrid?**
- On-chain matching is too slow (~2s blocks) and expensive (~$0.01-0.10 per trade)
- Off-chain CLOB provides <10μs matching latency
- On-chain settlement ensures trustless custody and redemption

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER INTERFACE                                  │
│                         (Web3 Wallet + REST API)                            │
└─────────────────────────────────────────────────────────────────────────────┘
                │                                           │
                │ Sign Orders (EIP-712)                     │ View Orderbook
                ▼                                           ▼
┌───────────────────────────────┐       ┌───────────────────────────────────┐
│      OPERATOR SERVICE         │       │         RUST CLOB SERVER          │
│   (Bridge between layers)     │◄─────►│    (Order Matching Engine)        │
│                               │       │                                   │
│  • Validate signatures        │       │  • Price-time priority matching   │
│  • Submit settlements         │       │  • Orderbook management           │
│  • Batch transactions         │       │  • WebSocket real-time updates    │
│  • Monitor chain state        │       │  • Trade history                  │
└───────────────────────────────┘       └───────────────────────────────────┘
                │                                           
                │ Settlement Transactions                   
                ▼                                           
┌─────────────────────────────────────────────────────────────────────────────┐
│                        POLYGON BLOCKCHAIN                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │  CTF Contract   │  │  Exchange       │  │  Oracle Contract            │  │
│  │  (ERC1155)      │  │  Contract       │  │  (Chainlink + AIS)          │  │
│  │                 │  │                 │  │                             │  │
│  │ • splitPosition │  │ • fillOrder     │  │ • reportOutcome             │  │
│  │ • mergePosition │  │ • matchOrders   │  │ • resolveMarket             │  │
│  │ • redeemPosition│  │ • cancelOrder   │  │ • disputeResolution         │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ AIS Data Feed
                                    ▼
                    ┌───────────────────────────────┐
                    │     MARITIME DATA ORACLE      │
                    │                               │
                    │  • AIS vessel tracking        │
                    │  • Port arrival timestamps    │
                    │  • Berth assignment times     │
                    │  • Demurrage calculation      │
                    └───────────────────────────────┘
```

---

## Smart Contract Layer

### 1. Conditional Token Framework (CTF) - ERC1155

Based on Gnosis CTF, manages outcome tokens.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

contract MaritimeCTF is ERC1155 {
    address public collateralToken;  // USDC
    
    struct Condition {
        bytes32 questionId;
        address oracle;
        uint256 outcomeSlotCount;  // Always 2 for binary
        bool resolved;
        uint256 payoutNumerator;   // 0 = NO wins, 1 = YES wins
    }
    
    mapping(bytes32 => Condition) public conditions;
    
    // Split $1 USDC into 1 YES + 1 NO token
    function splitPosition(
        IERC20 collateral,
        bytes32 conditionId,
        uint256 amount
    ) external {
        // Transfer USDC from user
        collateral.transferFrom(msg.sender, address(this), amount);
        
        // Mint YES tokens (positionId derived from conditionId + indexSet=1)
        uint256 yesTokenId = getPositionId(conditionId, 1);
        _mint(msg.sender, yesTokenId, amount, "");
        
        // Mint NO tokens (positionId derived from conditionId + indexSet=2)  
        uint256 noTokenId = getPositionId(conditionId, 2);
        _mint(msg.sender, noTokenId, amount, "");
    }
    
    // Merge 1 YES + 1 NO back into $1 USDC
    function mergePositions(
        IERC20 collateral,
        bytes32 conditionId,
        uint256 amount
    ) external {
        uint256 yesTokenId = getPositionId(conditionId, 1);
        uint256 noTokenId = getPositionId(conditionId, 2);
        
        // Burn both tokens
        _burn(msg.sender, yesTokenId, amount);
        _burn(msg.sender, noTokenId, amount);
        
        // Return USDC
        collateral.transfer(msg.sender, amount);
    }
    
    // Redeem winning tokens after resolution
    function redeemPositions(
        IERC20 collateral,
        bytes32 conditionId,
        uint256 amount
    ) external {
        Condition storage cond = conditions[conditionId];
        require(cond.resolved, "Not resolved");
        
        uint256 winningTokenId;
        if (cond.payoutNumerator == 1) {
            winningTokenId = getPositionId(conditionId, 1);  // YES
        } else {
            winningTokenId = getPositionId(conditionId, 2);  // NO
        }
        
        // Burn winning tokens
        _burn(msg.sender, winningTokenId, amount);
        
        // Pay out $1 per token
        collateral.transfer(msg.sender, amount);
    }
    
    function getPositionId(bytes32 conditionId, uint256 indexSet) 
        public pure returns (uint256) 
    {
        return uint256(keccak256(abi.encodePacked(conditionId, indexSet)));
    }
}
```

### 2. Exchange Contract

Handles atomic settlement of matched orders.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract MaritimeExchange {
    MaritimeCTF public ctf;
    IERC20 public usdc;
    address public operator;  // Rust CLOB operator
    
    struct Order {
        address maker;
        uint256 tokenId;      // YES or NO token
        bool isBuy;           // true = buying tokens, false = selling
        uint256 price;        // In basis points (5000 = 50¢)
        uint256 amount;
        uint256 nonce;
        uint256 expiry;
        bytes signature;      // EIP-712 signature
    }
    
    mapping(bytes32 => uint256) public filledAmounts;
    
    // Called by operator to settle matched orders
    function fillOrder(
        Order calldata takerOrder,
        Order calldata makerOrder,
        uint256 fillAmount
    ) external onlyOperator {
        // Verify signatures (EIP-712)
        require(verifySignature(takerOrder), "Invalid taker sig");
        require(verifySignature(makerOrder), "Invalid maker sig");
        
        // Verify orders match
        require(takerOrder.tokenId == makerOrder.tokenId, "Token mismatch");
        require(takerOrder.isBuy != makerOrder.isBuy, "Same side");
        
        uint256 price = makerOrder.price;  // Maker's price
        uint256 cost = (fillAmount * price) / 10000;
        
        if (takerOrder.isBuy) {
            // Taker buys tokens: pays USDC, receives tokens
            usdc.transferFrom(takerOrder.maker, makerOrder.maker, cost);
            ctf.safeTransferFrom(makerOrder.maker, takerOrder.maker, 
                                 takerOrder.tokenId, fillAmount, "");
        } else {
            // Taker sells tokens: gives tokens, receives USDC
            ctf.safeTransferFrom(takerOrder.maker, makerOrder.maker,
                                 takerOrder.tokenId, fillAmount, "");
            usdc.transferFrom(makerOrder.maker, takerOrder.maker, cost);
        }
        
        emit OrderFilled(takerOrder.maker, makerOrder.maker, 
                        takerOrder.tokenId, fillAmount, price);
    }
    
    // Batch settlement for efficiency
    function batchFillOrders(
        Order[] calldata takerOrders,
        Order[] calldata makerOrders,
        uint256[] calldata fillAmounts
    ) external onlyOperator {
        for (uint i = 0; i < takerOrders.length; i++) {
            fillOrder(takerOrders[i], makerOrders[i], fillAmounts[i]);
        }
    }
}
```

### 3. Oracle Contract

Receives demurrage data from AIS oracle.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@chainlink/contracts/src/v0.8/ChainlinkClient.sol";

contract MaritimeOracle is ChainlinkClient {
    MaritimeCTF public ctf;
    
    struct Market {
        bytes32 conditionId;
        string vesselIMO;
        uint256 expectedArrival;
        uint256 demurrageThresholdHours;
        bool resolved;
    }
    
    mapping(bytes32 => Market) public markets;
    
    // Called by Chainlink node with AIS data
    function reportOutcome(
        bytes32 marketId,
        uint256 anchorageArrivalTime,
        uint256 berthArrivalTime
    ) external onlyOracle {
        Market storage market = markets[marketId];
        require(!market.resolved, "Already resolved");
        
        // Calculate waiting time
        uint256 waitingHours = (berthArrivalTime - anchorageArrivalTime) / 3600;
        
        // Determine outcome: YES if demurrage occurred
        bool yesWins = waitingHours > market.demurrageThresholdHours;
        
        // Resolve the condition
        ctf.reportPayouts(market.conditionId, yesWins ? 1 : 0);
        market.resolved = true;
        
        emit MarketResolved(marketId, yesWins, waitingHours);
    }
    
    // Request AIS data from Chainlink
    function requestResolution(bytes32 marketId) external {
        Market storage market = markets[marketId];
        require(block.timestamp >= market.expectedArrival, "Too early");
        
        Chainlink.Request memory req = buildChainlinkRequest(
            jobId,
            address(this),
            this.reportOutcome.selector
        );
        req.add("vesselIMO", market.vesselIMO);
        sendChainlinkRequest(req, fee);
    }
}
```

---

## Rust CLOB Layer

The Rust server handles all order matching off-chain for speed.

### Current Components

| File | Purpose |
|------|---------|
| `types.rs` | Order, Trade, Market structs |
| `orderbook.rs` | BTreeMap-based orderbook per token |
| `engine.rs` | Matching engine, user accounts |
| `api.rs` | REST + WebSocket API |

### Required Additions for Web3

```rust
// src/web3.rs - New module for blockchain interaction

use ethers::{
    prelude::*,
    types::{Address, U256, Bytes},
};

pub struct Web3Bridge {
    provider: Provider<Http>,
    exchange_contract: Address,
    ctf_contract: Address,
    operator_wallet: LocalWallet,
}

impl Web3Bridge {
    // Verify EIP-712 signature from user
    pub fn verify_order_signature(&self, order: &SignedOrder) -> bool {
        let domain = eip712_domain("MaritimeExchange", 1, self.chain_id);
        let typed_data = order.to_eip712(&domain);
        let recovered = typed_data.recover_signer(&order.signature);
        recovered == order.maker
    }
    
    // Submit matched trades to blockchain
    pub async fn settle_trades(&self, trades: Vec<Trade>) -> Result<TxHash> {
        let contract = Exchange::new(self.exchange_contract, self.provider.clone());
        
        // Batch for gas efficiency
        let (taker_orders, maker_orders, amounts) = self.prepare_batch(&trades);
        
        let tx = contract
            .batch_fill_orders(taker_orders, maker_orders, amounts)
            .send()
            .await?;
            
        Ok(tx.tx_hash())
    }
    
    // Monitor on-chain events
    pub async fn watch_deposits(&self) -> impl Stream<Item = DepositEvent> {
        let filter = self.ctf_contract
            .event::<SplitEvent>()
            .from_block(BlockNumber::Latest);
        filter.subscribe().await.unwrap()
    }
}
```

### Cargo.toml Additions

```toml
[dependencies]
# Existing deps...

# Web3 Integration
ethers = { version = "2.0", features = ["rustls", "ws"] }
ethers-signers = "2.0"

# EIP-712 signing
eip-712 = "0.2"
```

---

## Integration Bridge

### Order Flow (User → Settlement)

```
1. USER SIGNS ORDER (Frontend)
   ├── Connect wallet (MetaMask/WalletConnect)
   ├── Approve USDC spending on Exchange contract
   ├── Sign EIP-712 typed data order
   └── Submit signed order to Rust CLOB API

2. CLOB VALIDATES & MATCHES (Rust Server)
   ├── Verify EIP-712 signature
   ├── Check user has sufficient USDC allowance
   ├── Add to orderbook OR match immediately
   ├── Broadcast orderbook update via WebSocket
   └── Queue matched trades for settlement

3. OPERATOR SETTLES (Bridge Service)
   ├── Batch matched trades (every N seconds or M trades)
   ├── Submit batchFillOrders() to Exchange contract
   ├── Wait for confirmation
   └── Update CLOB with settlement status

4. ON-CHAIN SETTLEMENT (Polygon)
   ├── Verify all signatures
   ├── Transfer USDC between parties
   ├── Transfer ERC1155 tokens between parties
   └── Emit events for indexing
```

### EIP-712 Order Structure

```typescript
// Frontend signing
const domain = {
  name: "MaritimeExchange",
  version: "1",
  chainId: 137,  // Polygon
  verifyingContract: EXCHANGE_ADDRESS
};

const types = {
  Order: [
    { name: "maker", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "isBuy", type: "bool" },
    { name: "price", type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" }
  ]
};

const signature = await signer._signTypedData(domain, types, order);
```

---

## Oracle Integration

### Maritime Data Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   AIS Provider  │────►│  Chainlink Node  │────►│  Oracle Contract│
│  (MarineTraffic)│     │  (Custom Adapter)│     │  (On-chain)     │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                        │                        │
        │ Raw AIS Data           │ Verified Data          │ Resolution
        │ • Position updates     │ • Anchorage arrival    │ • YES/NO outcome
        │ • Port entries         │ • Berth arrival        │ • Trigger payouts
        │ • Berth assignments    │ • Waiting time calc    │
```

### Chainlink External Adapter

```javascript
// chainlink-adapter/index.js
const { Requester, Validator } = require('@chainlink/external-adapter');
const MarineTraffic = require('./marine-traffic-api');

const execute = async (input) => {
  const { vesselIMO, marketId } = input.data;
  
  // Fetch AIS data
  const vesselData = await MarineTraffic.getVesselHistory(vesselIMO);
  
  // Find anchorage and berth arrivals
  const anchorageArrival = vesselData.events.find(e => 
    e.type === 'ANCHORAGE_ARRIVAL'
  );
  const berthArrival = vesselData.events.find(e => 
    e.type === 'BERTH_ARRIVAL'
  );
  
  return {
    jobRunID: input.id,
    data: {
      marketId,
      anchorageArrivalTime: anchorageArrival.timestamp,
      berthArrivalTime: berthArrival.timestamp,
    },
    statusCode: 200
  };
};

module.exports = { execute };
```

---

## Data Flow

### Complete Trading Lifecycle

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           MARKET CREATION                                   │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  1. Admin creates market in Oracle contract                                │
│     └─► prepareCondition(questionId, oracle, outcomeSlotCount=2)          │
│                                                                            │
│  2. Rust CLOB receives market info                                         │
│     └─► Creates orderbook for YES and NO tokens                           │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                           TOKEN MINTING                                     │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  1. User approves USDC on CTF contract                                     │
│                                                                            │
│  2. User calls splitPosition(conditionId, amount)                          │
│     └─► Deposits 100 USDC                                                  │
│     └─► Receives 100 YES tokens + 100 NO tokens                           │
│                                                                            │
│  3. Rust CLOB detects SplitEvent                                           │
│     └─► Updates user's token balances in memory                           │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                              TRADING                                        │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  1. User signs EIP-712 order: "Sell 50 YES @ 60¢"                         │
│                                                                            │
│  2. Rust CLOB validates signature and adds to orderbook                    │
│                                                                            │
│  3. Another user signs: "Buy 50 YES @ 60¢"                                │
│                                                                            │
│  4. Rust CLOB matches orders instantly (<10μs)                            │
│     └─► Trade: 50 YES @ 60¢                                               │
│     └─► Broadcast via WebSocket                                           │
│                                                                            │
│  5. Operator batches trade and submits to Exchange contract                │
│     └─► fillOrder(takerOrder, makerOrder, 50)                             │
│     └─► On-chain: Buyer pays 30 USDC, receives 50 YES tokens              │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                            RESOLUTION                                       │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  1. Vessel arrives at port                                                 │
│     └─► AIS records anchorage arrival: T1                                 │
│     └─► AIS records berth arrival: T2                                     │
│                                                                            │
│  2. Chainlink node fetches AIS data                                        │
│     └─► Waiting time = T2 - T1 = 36 hours                                 │
│     └─► Threshold = 24 hours                                              │
│     └─► Result: DEMURRAGE OCCURRED (YES wins)                             │
│                                                                            │
│  3. Oracle contract resolves market                                        │
│     └─► reportPayouts(conditionId, [1, 0])  // YES=1, NO=0               │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                            REDEMPTION                                       │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  1. YES token holders call redeemPositions()                               │
│     └─► Burns YES tokens                                                   │
│     └─► Receives $1 USDC per token                                        │
│                                                                            │
│  2. NO token holders                                                       │
│     └─► Tokens are worthless ($0)                                         │
│     └─► Can still merge with YES if they have both                        │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Roadmap

### Phase 1: Smart Contracts (2-3 weeks)
- [ ] Deploy CTF contract (fork Gnosis CTF)
- [ ] Deploy Exchange contract with EIP-712 validation
- [ ] Deploy Oracle contract stub
- [ ] Write comprehensive tests
- [ ] Deploy to Polygon Mumbai testnet

### Phase 2: Rust Web3 Integration (2-3 weeks)
- [ ] Add `ethers-rs` dependency
- [ ] Implement EIP-712 signature verification
- [ ] Add on-chain event monitoring
- [ ] Build settlement batching logic
- [ ] Create operator service

### Phase 3: Frontend Web3 (1-2 weeks)
- [ ] Add wallet connection (wagmi/RainbowKit)
- [ ] Implement EIP-712 order signing
- [ ] Add USDC approval flow
- [ ] Add split/merge/redeem UI
- [ ] Show on-chain balances

### Phase 4: Oracle Integration (2-3 weeks)
- [ ] Build Chainlink external adapter
- [ ] Integrate AIS data provider (MarineTraffic API)
- [ ] Deploy Chainlink node (or use existing)
- [ ] Test resolution flow end-to-end

### Phase 5: Production (1-2 weeks)
- [ ] Security audit
- [ ] Deploy to Polygon mainnet
- [ ] Set up monitoring and alerting
- [ ] Load testing

---

## Security Considerations

### Smart Contract Security
- Use OpenZeppelin contracts where possible
- Implement reentrancy guards
- Add pause functionality for emergencies
- Multi-sig for admin functions
- Time-locks for upgrades

### Operator Security
- Operator can only settle valid signed orders
- Cannot steal funds (only moves between consenting parties)
- Rate limiting on settlements
- Monitoring for unusual activity

### Oracle Security
- Multiple AIS data sources for redundancy
- Challenge period before resolution is final
- Dispute resolution mechanism (UMA-style)
- Slashing for malicious oracle behavior

### User Security
- Never store private keys
- Validate all signatures on-chain
- Set reasonable order expiry times
- Show clear warnings for large trades

---

## Technology Stack Summary

| Component | Technology | Why |
|-----------|------------|-----|
| Blockchain | Polygon | Low fees, fast blocks, EVM compatible |
| Tokens | ERC1155 | Multi-token standard, gas efficient |
| CLOB | Rust | <10μs latency, memory safe |
| Signing | EIP-712 | Human-readable, replay-safe |
| Oracle | Chainlink | Decentralized, battle-tested |
| AIS Data | MarineTraffic | Industry standard, comprehensive |
| Frontend | React + wagmi | Modern Web3 UX |

---

## References

- [Polymarket CTF Docs](https://docs.polymarket.com/developers/CTF/overview)
- [Gnosis Conditional Token Framework](https://docs.gnosis.io/conditionaltokens/)
- [EIP-712: Typed Structured Data Hashing](https://eips.ethereum.org/EIPS/eip-712)
- [Chainlink External Adapters](https://docs.chain.link/chainlink-nodes/external-adapters/external-adapters)
- [ethers-rs Documentation](https://docs.rs/ethers/latest/ethers/)
