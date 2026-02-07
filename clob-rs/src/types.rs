//! Core types for the Maritime CLOB (Polymarket-style)
//! 
//! Each outcome token (YES/NO) has its own orderbook with BUY and SELL sides.
//! Prices are in cents (1-99), representing the token price.
//! 
//! Key operations:
//! - BUY YES: Pay USDC to acquire YES tokens
//! - SELL YES: Sell YES tokens for USDC
//! - BUY NO: Pay USDC to acquire NO tokens
//! - SELL NO: Sell NO tokens for USDC
//! - SPLIT: $1 USDC → 1 YES + 1 NO token
//! - MERGE: 1 YES + 1 NO token → $1 USDC

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use std::cmp::Ordering;

/// Price in cents (1-99 for prediction markets)
pub type Price = u8;

/// Quantity of shares/tokens
pub type Quantity = u64;

/// Token type - which outcome token
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum TokenSide {
    Yes,  // YES outcome token
    No,   // NO outcome token
}

impl TokenSide {
    pub fn opposite(&self) -> TokenSide {
        match self {
            TokenSide::Yes => TokenSide::No,
            TokenSide::No => TokenSide::Yes,
        }
    }
}

/// Order side - BUY or SELL
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum OrderSide {
    Buy,   // Buying tokens (paying USDC)
    Sell,  // Selling tokens (receiving USDC)
}

impl OrderSide {
    pub fn opposite(&self) -> OrderSide {
        match self {
            OrderSide::Buy => OrderSide::Sell,
            OrderSide::Sell => OrderSide::Buy,
        }
    }
}

/// Order type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum OrderType {
    Limit,
    Market,
}

/// Order status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum OrderStatus {
    Open,
    Partial,
    Filled,
    Cancelled,
}

/// A single order in the book
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub id: Uuid,
    pub user_id: String,
    pub market_id: Uuid,
    pub token_side: TokenSide,  // YES or NO token
    pub order_side: OrderSide,  // BUY or SELL
    pub order_type: OrderType,
    pub price: Price,           // Price per token (1-99 cents)
    pub quantity: Quantity,     // Number of tokens
    pub filled_qty: Quantity,   // How much has been filled
    pub status: OrderStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Order {
    pub fn new(
        user_id: String,
        market_id: Uuid,
        token_side: TokenSide,
        order_side: OrderSide,
        order_type: OrderType,
        price: Price,
        quantity: Quantity,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            user_id,
            market_id,
            token_side,
            order_side,
            order_type,
            price,
            quantity,
            filled_qty: 0,
            status: OrderStatus::Open,
            created_at: now,
            updated_at: now,
        }
    }

    #[inline]
    pub fn remaining_qty(&self) -> Quantity {
        self.quantity - self.filled_qty
    }

    #[inline]
    pub fn is_filled(&self) -> bool {
        self.filled_qty >= self.quantity
    }

    pub fn fill(&mut self, qty: Quantity) {
        self.filled_qty += qty;
        self.updated_at = Utc::now();
        if self.is_filled() {
            self.status = OrderStatus::Filled;
        } else {
            self.status = OrderStatus::Partial;
        }
    }

    pub fn cancel(&mut self) {
        self.status = OrderStatus::Cancelled;
        self.updated_at = Utc::now();
    }
    
    /// Cost to place this order (USDC needed)
    pub fn required_collateral(&self) -> Decimal {
        match self.order_side {
            OrderSide::Buy => {
                // Buying: need price * quantity cents = price * quantity / 100 dollars
                Decimal::from(self.price as u64 * self.quantity) / Decimal::from(100)
            }
            OrderSide::Sell => {
                // Selling: need to have the tokens (no USDC collateral needed)
                Decimal::ZERO
            }
        }
    }
}

/// Key for price-time priority ordering
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct BidOrderKey {
    pub price: Price,
    pub timestamp: DateTime<Utc>,
    pub order_id: Uuid,
}

/// For BIDS: higher price = better (willing to pay more)
impl Ord for BidOrderKey {
    fn cmp(&self, other: &Self) -> Ordering {
        other.price.cmp(&self.price)  // Higher price first
            .then_with(|| self.timestamp.cmp(&other.timestamp))  // Earlier time first
            .then_with(|| self.order_id.cmp(&other.order_id))
    }
}

impl PartialOrd for BidOrderKey {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// Key for ask ordering
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct AskOrderKey {
    pub price: Price,
    pub timestamp: DateTime<Utc>,
    pub order_id: Uuid,
}

/// For ASKS: lower price = better (willing to sell for less)
impl Ord for AskOrderKey {
    fn cmp(&self, other: &Self) -> Ordering {
        self.price.cmp(&other.price)  // Lower price first
            .then_with(|| self.timestamp.cmp(&other.timestamp))  // Earlier time first
            .then_with(|| self.order_id.cmp(&other.order_id))
    }
}

impl PartialOrd for AskOrderKey {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// A trade execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub id: Uuid,
    pub market_id: Uuid,
    pub token_side: TokenSide,   // Which token was traded
    pub buyer_order_id: Uuid,
    pub seller_order_id: Uuid,
    pub buyer_user_id: String,
    pub seller_user_id: String,
    pub price: Price,            // Execution price
    pub quantity: Quantity,      // Number of tokens traded
    pub timestamp: DateTime<Utc>,
}

impl Trade {
    pub fn new(
        market_id: Uuid,
        token_side: TokenSide,
        buyer_order_id: Uuid,
        seller_order_id: Uuid,
        buyer_user_id: String,
        seller_user_id: String,
        price: Price,
        quantity: Quantity,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            market_id,
            token_side,
            buyer_order_id,
            seller_order_id,
            buyer_user_id,
            seller_user_id,
            price,
            quantity,
            timestamp: Utc::now(),
        }
    }

    /// Total value of trade in cents
    pub fn value_cents(&self) -> u64 {
        self.price as u64 * self.quantity
    }
}

/// Price level summary for orderbook display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceLevel {
    pub price: Price,
    pub quantity: Quantity,
    pub order_count: u32,
}

/// Single token orderbook snapshot (YES or NO)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenOrderBook {
    pub token: TokenSide,
    pub bids: Vec<PriceLevel>,  // Buy orders - sorted by price descending
    pub asks: Vec<PriceLevel>,  // Sell orders - sorted by price ascending
    pub best_bid: Option<Price>,
    pub best_ask: Option<Price>,
    pub spread: Option<u8>,
    pub last_price: Option<Price>,
}

/// Full orderbook snapshot for API responses
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBookSnapshot {
    pub market_id: Uuid,
    pub yes: TokenOrderBook,
    pub no: TokenOrderBook,
    pub timestamp: DateTime<Utc>,
}

/// Market definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Market {
    pub id: Uuid,
    pub vessel_name: String,
    pub vessel_imo: String,
    pub route: String,
    pub expected_arrival: DateTime<Utc>,
    pub demurrage_threshold_hours: u32,
    pub max_payout_usd: Decimal,
    pub status: MarketStatus,
    pub settlement_price: Option<Price>,  // 0 or 100 at resolution
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum MarketStatus {
    Open,
    Closed,
    Settled,
}

impl Market {
    pub fn new(
        vessel_name: String,
        vessel_imo: String,
        route: String,
        expected_arrival: DateTime<Utc>,
        demurrage_threshold_hours: u32,
        max_payout_usd: Decimal,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            vessel_name,
            vessel_imo,
            route,
            expected_arrival,
            demurrage_threshold_hours,
            max_payout_usd,
            status: MarketStatus::Open,
            settlement_price: None,
            created_at: Utc::now(),
        }
    }

    pub fn is_active(&self) -> bool {
        self.status == MarketStatus::Open
    }
}

/// User's token holdings for a market
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Position {
    pub yes_tokens: u64,  // YES tokens owned
    pub no_tokens: u64,   // NO tokens owned
}

impl Position {
    pub fn add_yes(&mut self, qty: u64) {
        self.yes_tokens += qty;
    }
    
    pub fn add_no(&mut self, qty: u64) {
        self.no_tokens += qty;
    }
    
    pub fn remove_yes(&mut self, qty: u64) -> bool {
        if self.yes_tokens >= qty {
            self.yes_tokens -= qty;
            true
        } else {
            false
        }
    }
    
    pub fn remove_no(&mut self, qty: u64) -> bool {
        if self.no_tokens >= qty {
            self.no_tokens -= qty;
            true
        } else {
            false
        }
    }
}
