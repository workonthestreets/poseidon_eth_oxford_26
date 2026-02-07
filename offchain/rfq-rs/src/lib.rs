//! Maritime Shield RFQ Prediction Market Engine
//!
//! ══════════════════════════════════════════════════════════════════════════════
//! PREDICTION MARKET MECHANICS
//! ══════════════════════════════════════════════════════════════════════════════
//!
//! Core Rule: 1 YES share + 1 NO share = $1 collateral (ALWAYS)
//!
//! ## RFQ Auction Flow
//!
//! ```text
//! ┌─────────────────────────────────────────────────────────────────────────────┐
//! │                     PREDICTION MARKET RFQ FLOW                              │
//! ├─────────────────────────────────────────────────────────────────────────────┤
//! │                                                                             │
//! │  STEP 1: Alice (ship owner) creates REQUEST                                 │
//! │          "I want 100 YES shares for detention risk, max 60¢ each"           │
//! │          → System locks $60 from Alice                                      │
//! │                                                                             │
//! │  STEP 2: Bob (speculator) submits BID                                       │
//! │          "I'll take 100 NO shares at 40¢ each"                              │
//! │          → 40¢ + 60¢ = $1 ✓ (valid pair)                                    │
//! │          → System locks $40 from Bob                                        │
//! │                                                                             │
//! │  STEP 3: Alice ACCEPTS Bob's bid → EMISSION                                 │
//! │          → Alice receives 100 YES shares (cost: $60)                        │
//! │          → Bob receives 100 NO shares (cost: $40)                           │
//! │          → Vault holds $100 collateral (100 share pairs)                    │
//! │                                                                             │
//! │  STEP 4: Event occurs - Vessel IS detained (YES wins)                       │
//! │          → Alice redeems 100 YES → $100 payout (profit: $40)                │
//! │          → Bob's 100 NO shares → $0 (loss: $40)                             │
//! │                                                                             │
//! │  Alternative: Vessel passes inspection (NO wins)                            │
//! │          → Alice's YES shares → $0 (loss: $60)                              │
//! │          → Bob redeems 100 NO → $100 payout (profit: $60)                   │
//! │                                                                             │
//! └─────────────────────────────────────────────────────────────────────────────┘
//! ```
//!
//! ## Key Invariants
//!
//! 1. **Price Sum**: YES_price + NO_price = 100 cents ($1)
//! 2. **Share Equality**: Total YES shares = Total NO shares
//! 3. **Full Collateralization**: Total collateral = Total shares × $1
//! 4. **Binary Settlement**: Winner gets $1/share, loser gets $0
//!
//! ## On-Chain Integration (Flare Network)
//!
//! The off-chain RFQ engine handles:
//! - Request/bid matching
//! - Price discovery
//! - User management
//!
//! The on-chain vault (MaritimeRFQVault.sol) handles:
//! - Collateral custody (FLR deposits)
//! - Share emission (via signed messages)
//! - Settlement (oracle trigger)
//! - Payout distribution
//!
//! ```text
//! ┌──────────────────────────────────────────────────────────────────────────┐
//! │                        HYBRID ARCHITECTURE                               │
//! ├──────────────────────────────────────────────────────────────────────────┤
//! │                                                                          │
//! │   OFF-CHAIN (Rust)              │   ON-CHAIN (Flare/Solidity)           │
//! │   ─────────────────             │   ────────────────────────            │
//! │   • Requests & Bids             │   • FLR Deposits                      │
//! │   • Price Matching              │   • Share Emission (EIP-712)          │
//! │   • User Balances (shadow)      │   • Settlement (oracle)               │
//! │   • WebSocket Updates           │   • Payout Distribution               │
//! │                                 │   • FTSO Price Oracle                 │
//! │                                 │                                        │
//! │           ┌─────────────────────┼───────────────────────┐               │
//! │           │    Signed Emission  │                       │               │
//! │           └────────────────────►│   emitShares()        │               │
//! │                                 │                       │               │
//! └──────────────────────────────────────────────────────────────────────────┘
//! ```

pub mod types;
pub mod engine;
pub mod api;

pub use engine::AuctionEngine;
pub use types::*;
pub use api::{create_router, init_demo_markets, AppState, SharedState};
