//! Maritime CLOB - High-Performance Central Limit Order Book
//! 
//! A Rust implementation of a prediction market CLOB for maritime
//! demurrage insurance.
//! 
//! # Architecture
//! 
//! ```text
//! ┌─────────────────────────────────────────────────────────────┐
//! │                        API Layer                            │
//! │              (REST + WebSocket via Axum)                    │
//! ├─────────────────────────────────────────────────────────────┤
//! │                    Matching Engine                          │
//! │         (Order routing, position tracking)                  │
//! ├─────────────────────────────────────────────────────────────┤
//! │                      Order Book                             │
//! │        (BTreeMap, price-time priority, O(log n))           │
//! ├─────────────────────────────────────────────────────────────┤
//! │                     Core Types                              │
//! │           (Order, Trade, Market, Position)                  │
//! └─────────────────────────────────────────────────────────────┘
//! ```
//! 
//! # Key Features
//! 
//! - **Prediction Market Mechanics**: YES + NO = $1.00
//! - **Price-Time Priority**: FIFO matching at each price level
//! - **Dual Order Book**: YES bids match with NO bids
//! - **Sub-millisecond Matching**: BTreeMap for O(log n) operations
//! - **Thread-Safe**: parking_lot RwLock for concurrent access
//! 
//! # Example
//! 
//! ```ignore
//! use maritime_clob::engine::create_engine;
//! use maritime_clob::types::{Market, Side, OrderType};
//! 
//! let engine = create_engine();
//! 
//! // Create a market
//! let market = Market::new(...);
//! let market_id = engine.create_market(market);
//! 
//! // Deposit funds
//! engine.deposit("user1", Decimal::from(1000));
//! 
//! // Submit order
//! let result = engine.submit_order(
//!     "user1".to_string(),
//!     market_id,
//!     Side::Yes,
//!     OrderType::Limit,
//!     35,  // 35 cents = 35% implied probability
//!     100, // 100 shares
//! );
//! ```

pub mod types;
pub mod orderbook;
pub mod engine;
pub mod api;

pub use types::*;
pub use orderbook::MarketOrderBook;
pub use engine::MatchingEngine;
pub use api::{create_router, init_demo_markets, AppState, SharedState};
