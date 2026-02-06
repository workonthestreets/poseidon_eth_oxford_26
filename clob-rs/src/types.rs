//! Core types for the Maritime CLOB
//! 
//! Prediction market shares: YES + NO always = $1.00 at resolution
//! Prices are in cents (1-99), representing probability

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use std::cmp::Ordering;

/// Price in cents (1-99 for prediction markets)
/// Represents implied probability: 35 = 35% chance
pub type Price = u8;

/// Quantity of shares
pub type Quantity = u64;

/// Order side - what outcome the user wants to BUY
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Side {
    Yes,  // Buying YES shares (betting demurrage WILL occur)
    No,   // Buying NO shares (betting demurrage WON'T occur)
}

impl Side {
    pub fn opposite(&self) -> Side {
        match self {
            Side::Yes => Side::No,
            Side::No => Side::Yes,
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
    pub side: Side,
    pub order_type: OrderType,
    pub price: Price,           // Price willing to pay (1-99 cents)
    pub quantity: Quantity,     // Original quantity
    pub filled_qty: Quantity,   // How much has been filled
    pub status: OrderStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Order {
    pub fn new(
        user_id: String,
        market_id: Uuid,
        side: Side,
        order_type: OrderType,
        price: Price,
        quantity: Quantity,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            user_id,
            market_id,
            side,
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
        } else if self.filled_qty > 0 {
            self.status = OrderStatus::Partial;
        }
    }

    pub fn cancel(&mut self) {
        self.status = OrderStatus::Cancelled;
        self.updated_at = Utc::now();
    }
}

/// Key for ordering in the book: (price, time)
/// For bids: higher price = better (descending)
/// For asks: lower price = better (ascending)
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub struct OrderKey {
    pub price: Price,
    pub timestamp: i64,  // nanos since epoch for ordering
    pub order_id: Uuid,
}

impl OrderKey {
    pub fn new(price: Price, created_at: DateTime<Utc>, order_id: Uuid) -> Self {
        Self {
            price,
            timestamp: created_at.timestamp_nanos_opt().unwrap_or(0),
            order_id,
        }
    }
}

/// Ordering for BID side (YES buyers): higher price first, then earlier time
impl Ord for OrderKey {
    fn cmp(&self, other: &Self) -> Ordering {
        // Higher price = better for bids
        other.price.cmp(&self.price)
            .then_with(|| self.timestamp.cmp(&other.timestamp))
            .then_with(|| self.order_id.cmp(&other.order_id))
    }
}

impl PartialOrd for OrderKey {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

/// A trade execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub id: Uuid,
    pub market_id: Uuid,
    pub yes_order_id: Uuid,
    pub no_order_id: Uuid,
    pub yes_user_id: String,
    pub no_user_id: String,
    pub price: Price,           // YES price (NO price = 100 - price)
    pub quantity: Quantity,
    pub timestamp: DateTime<Utc>,
}

impl Trade {
    pub fn new(
        market_id: Uuid,
        yes_order_id: Uuid,
        no_order_id: Uuid,
        yes_user_id: String,
        no_user_id: String,
        price: Price,
        quantity: Quantity,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            market_id,
            yes_order_id,
            no_order_id,
            yes_user_id,
            no_user_id,
            price,
            quantity,
            timestamp: Utc::now(),
        }
    }

    /// Collateral locked for this trade (always $1 per share in prediction markets)
    pub fn collateral_locked(&self) -> Decimal {
        Decimal::from(self.quantity)
    }
}

/// Price level summary for orderbook display
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceLevel {
    pub price: Price,
    pub quantity: Quantity,
    pub order_count: u32,
}

/// Orderbook snapshot for API responses
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBookSnapshot {
    pub market_id: Uuid,
    pub yes_bids: Vec<PriceLevel>,  // Sorted by price descending
    pub yes_asks: Vec<PriceLevel>,  // Sorted by price ascending (derived from NO bids)
    pub last_price: Option<Price>,
    pub spread: Option<u8>,
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_order_creation() {
        let order = Order::new(
            "user1".to_string(),
            Uuid::new_v4(),
            Side::Yes,
            OrderType::Limit,
            35,
            100,
        );
        
        assert_eq!(order.remaining_qty(), 100);
        assert!(!order.is_filled());
        assert_eq!(order.status, OrderStatus::Open);
    }

    #[test]
    fn test_order_fill() {
        let mut order = Order::new(
            "user1".to_string(),
            Uuid::new_v4(),
            Side::Yes,
            OrderType::Limit,
            35,
            100,
        );
        
        order.fill(50);
        assert_eq!(order.remaining_qty(), 50);
        assert_eq!(order.status, OrderStatus::Partial);
        
        order.fill(50);
        assert_eq!(order.remaining_qty(), 0);
        assert_eq!(order.status, OrderStatus::Filled);
    }

    #[test]
    fn test_price_validation() {
        // Price must be 1-99 for prediction markets
        let price: Price = 35;
        assert!(price >= 1 && price <= 99);
    }
}
