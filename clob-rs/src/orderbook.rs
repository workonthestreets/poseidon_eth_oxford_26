//! Polymarket-style CLOB Orderbook
//!
//! Each token (YES/NO) has its own orderbook with BUY and SELL sides.
//! - BUY orders: Users want to acquire tokens, paying USDC
//! - SELL orders: Users want to sell tokens, receiving USDC
//!
//! Matching: BUY orders match with SELL orders when buy_price >= sell_price

use crate::types::*;
use std::collections::{BTreeMap, HashMap, VecDeque};
use uuid::Uuid;

/// Price level with FIFO queue of orders
#[derive(Debug, Clone)]
pub struct Level {
    pub orders: VecDeque<Order>,
    pub total_qty: Quantity,
}

impl Level {
    pub fn new() -> Self {
        Self {
            orders: VecDeque::new(),
            total_qty: 0,
        }
    }

    pub fn add_order(&mut self, order: Order) {
        self.total_qty += order.remaining_qty();
        self.orders.push_back(order);
    }

    pub fn peek_front(&self) -> Option<&Order> {
        self.orders.front()
    }

    pub fn peek_front_mut(&mut self) -> Option<&mut Order> {
        self.orders.front_mut()
    }

    pub fn pop_front(&mut self) -> Option<Order> {
        if let Some(order) = self.orders.pop_front() {
            self.total_qty = self.total_qty.saturating_sub(order.remaining_qty());
            Some(order)
        } else {
            None
        }
    }

    pub fn remove_order(&mut self, order_id: Uuid) -> Option<Order> {
        if let Some(pos) = self.orders.iter().position(|o| o.id == order_id) {
            let order = self.orders.remove(pos)?;
            self.total_qty = self.total_qty.saturating_sub(order.remaining_qty());
            Some(order)
        } else {
            None
        }
    }

    pub fn update_qty_after_fill(&mut self, filled: Quantity) {
        self.total_qty = self.total_qty.saturating_sub(filled);
    }

    pub fn is_empty(&self) -> bool {
        self.orders.is_empty()
    }

    pub fn order_count(&self) -> u32 {
        self.orders.len() as u32
    }
}

/// Single token orderbook (for YES or NO token)
#[derive(Debug)]
pub struct SingleTokenBook {
    pub token: TokenSide,
    pub market_id: Uuid,
    
    // BUY orders: keyed by price, higher price = better bid
    // BTreeMap with price as key, ordered descending for bids
    pub bids: BTreeMap<Price, Level>,
    
    // SELL orders: keyed by price, lower price = better ask
    // BTreeMap with price as key, ordered ascending for asks  
    pub asks: BTreeMap<Price, Level>,
    
    // Order lookup: order_id -> (side, price)
    pub order_index: HashMap<Uuid, (OrderSide, Price)>,
    
    pub last_price: Option<Price>,
    pub trades: Vec<Trade>,
}

impl SingleTokenBook {
    pub fn new(token: TokenSide, market_id: Uuid) -> Self {
        Self {
            token,
            market_id,
            bids: BTreeMap::new(),
            asks: BTreeMap::new(),
            order_index: HashMap::new(),
            last_price: None,
            trades: Vec::new(),
        }
    }

    /// Submit an order, attempt to match, return (order, trades)
    pub fn submit_order(&mut self, mut order: Order) -> (Order, Vec<Trade>) {
        let mut trades = Vec::new();

        match order.order_type {
            OrderType::Limit => self.match_limit_order(&mut order, &mut trades),
            OrderType::Market => self.match_market_order(&mut order, &mut trades),
        }

        // If not fully filled and limit order, add to book
        if !order.is_filled() && order.order_type == OrderType::Limit {
            self.add_to_book(order.clone());
        }

        (order, trades)
    }

    /// Match a limit order against the opposite side
    fn match_limit_order(&mut self, order: &mut Order, trades: &mut Vec<Trade>) {
        let opposite_book = match order.order_side {
            OrderSide::Buy => &mut self.asks,  // Buyer matches against asks
            OrderSide::Sell => &mut self.bids, // Seller matches against bids
        };

        let mut empty_levels = Vec::new();

        // Get prices to check based on order side
        let prices_to_check: Vec<Price> = match order.order_side {
            OrderSide::Buy => {
                // For buy: check asks from lowest to highest, stop when ask > buy price
                opposite_book.keys().copied().collect()
            }
            OrderSide::Sell => {
                // For sell: check bids from highest to lowest, stop when bid < sell price
                opposite_book.keys().rev().copied().collect()
            }
        };

        for opp_price in prices_to_check {
            if order.is_filled() {
                break;
            }

            // Check if prices cross
            let prices_cross = match order.order_side {
                OrderSide::Buy => order.price >= opp_price,  // Buyer willing to pay >= ask
                OrderSide::Sell => order.price <= opp_price, // Seller willing to accept <= bid
            };

            if !prices_cross {
                break;
            }

            if let Some(level) = opposite_book.get_mut(&opp_price) {
                while !order.is_filled() && !level.is_empty() {
                    let resting_order = match level.peek_front() {
                        Some(o) => o,
                        None => break,
                    };

                    let fill_qty = order.remaining_qty().min(resting_order.remaining_qty());
                    if fill_qty == 0 {
                        break;
                    }

                    // Determine buyer and seller
                    let (buyer_id, buyer_user, seller_id, seller_user) = match order.order_side {
                        OrderSide::Buy => (
                            order.id,
                            order.user_id.clone(),
                            resting_order.id,
                            resting_order.user_id.clone(),
                        ),
                        OrderSide::Sell => (
                            resting_order.id,
                            resting_order.user_id.clone(),
                            order.id,
                            order.user_id.clone(),
                        ),
                    };

                    let trade = Trade::new(
                        self.market_id,
                        self.token,
                        buyer_id,
                        seller_id,
                        buyer_user,
                        seller_user,
                        opp_price,  // Trade at resting order's price (price improvement for taker)
                        fill_qty,
                    );

                    // Update incoming order
                    order.fill(fill_qty);

                    // Update resting order
                    if let Some(resting) = level.peek_front_mut() {
                        resting.fill(fill_qty);
                    }
                    level.update_qty_after_fill(fill_qty);

                    self.last_price = Some(opp_price);
                    self.trades.push(trade.clone());
                    trades.push(trade);

                    // Remove filled resting order
                    let should_remove = level.peek_front().map(|r| r.is_filled()).unwrap_or(false);
                    if should_remove {
                        if let Some(removed) = level.pop_front() {
                            self.order_index.remove(&removed.id);
                        }
                    } else {
                        break;
                    }
                }

                if level.is_empty() {
                    empty_levels.push(opp_price);
                }
            }
        }

        // Clean up empty levels
        for price in empty_levels {
            opposite_book.remove(&price);
        }
    }

    /// Match a market order (takes whatever liquidity is available)
    fn match_market_order(&mut self, order: &mut Order, trades: &mut Vec<Trade>) {
        let original_price = order.price;
        order.price = match order.order_side {
            OrderSide::Buy => 99,  // Willing to pay up to 99¢
            OrderSide::Sell => 1,  // Willing to accept down to 1¢
        };
        self.match_limit_order(order, trades);
        order.price = original_price;
    }

    /// Add order to the book
    fn add_to_book(&mut self, order: Order) {
        let (book, side) = match order.order_side {
            OrderSide::Buy => (&mut self.bids, OrderSide::Buy),
            OrderSide::Sell => (&mut self.asks, OrderSide::Sell),
        };

        self.order_index.insert(order.id, (side, order.price));
        book.entry(order.price)
            .or_insert_with(Level::new)
            .add_order(order);
    }

    /// Cancel an order
    pub fn cancel_order(&mut self, order_id: Uuid, user_id: &str) -> Option<Order> {
        let (side, price) = self.order_index.remove(&order_id)?;

        let book = match side {
            OrderSide::Buy => &mut self.bids,
            OrderSide::Sell => &mut self.asks,
        };

        if let Some(level) = book.get_mut(&price) {
            if let Some(mut order) = level.remove_order(order_id) {
                if order.user_id == user_id {
                    order.cancel();
                    if level.is_empty() {
                        book.remove(&price);
                    }
                    return Some(order);
                }
            }
        }
        None
    }

    /// Get snapshot of this token's orderbook
    pub fn get_snapshot(&self) -> TokenOrderBook {
        // Bids: sorted by price descending (highest first)
        let mut bids: Vec<PriceLevel> = self.bids
            .iter()
            .map(|(&price, level)| PriceLevel {
                price,
                quantity: level.total_qty,
                order_count: level.order_count(),
            })
            .collect();
        bids.sort_by(|a, b| b.price.cmp(&a.price));

        // Asks: sorted by price ascending (lowest first)
        let mut asks: Vec<PriceLevel> = self.asks
            .iter()
            .map(|(&price, level)| PriceLevel {
                price,
                quantity: level.total_qty,
                order_count: level.order_count(),
            })
            .collect();
        asks.sort_by(|a, b| a.price.cmp(&b.price));

        let best_bid = bids.first().map(|l| l.price);
        let best_ask = asks.first().map(|l| l.price);
        let spread = match (best_bid, best_ask) {
            (Some(bid), Some(ask)) if ask > bid => Some(ask - bid),
            _ => None,
        };

        TokenOrderBook {
            token: self.token,
            bids,
            asks,
            best_bid,
            best_ask,
            spread,
            last_price: self.last_price,
        }
    }

    pub fn best_bid(&self) -> Option<Price> {
        self.bids.keys().max().copied()
    }

    pub fn best_ask(&self) -> Option<Price> {
        self.asks.keys().min().copied()
    }
}

/// Complete market orderbook with YES and NO token books
#[derive(Debug)]
pub struct MarketOrderBook {
    pub market_id: Uuid,
    pub yes_book: SingleTokenBook,
    pub no_book: SingleTokenBook,
}

impl MarketOrderBook {
    pub fn new(market_id: Uuid) -> Self {
        Self {
            market_id,
            yes_book: SingleTokenBook::new(TokenSide::Yes, market_id),
            no_book: SingleTokenBook::new(TokenSide::No, market_id),
        }
    }

    /// Submit an order to the appropriate token book
    pub fn submit_order(&mut self, order: Order) -> (Order, Vec<Trade>) {
        match order.token_side {
            TokenSide::Yes => self.yes_book.submit_order(order),
            TokenSide::No => self.no_book.submit_order(order),
        }
    }

    /// Cancel an order
    pub fn cancel_order(&mut self, order_id: Uuid, user_id: &str) -> Option<Order> {
        // Try YES book first, then NO book
        self.yes_book.cancel_order(order_id, user_id)
            .or_else(|| self.no_book.cancel_order(order_id, user_id))
    }

    /// Get full orderbook snapshot
    pub fn get_snapshot(&self) -> OrderBookSnapshot {
        OrderBookSnapshot {
            market_id: self.market_id,
            yes: self.yes_book.get_snapshot(),
            no: self.no_book.get_snapshot(),
            timestamp: chrono::Utc::now(),
        }
    }

    /// Get trades for this market
    pub fn get_trades(&self, limit: usize) -> Vec<Trade> {
        let mut all_trades: Vec<Trade> = self.yes_book.trades.iter()
            .chain(self.no_book.trades.iter())
            .cloned()
            .collect();
        all_trades.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        all_trades.truncate(limit);
        all_trades
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_order(
        user: &str,
        token: TokenSide,
        side: OrderSide,
        price: Price,
        qty: Quantity,
    ) -> Order {
        Order::new(
            user.to_string(),
            Uuid::new_v4(),
            token,
            side,
            OrderType::Limit,
            price,
            qty,
        )
    }

    #[test]
    fn test_buy_sell_matching() {
        let market_id = Uuid::new_v4();
        let mut book = MarketOrderBook::new(market_id);

        // Alice sells 100 YES tokens at 50¢
        let mut sell_order = create_test_order("alice", TokenSide::Yes, OrderSide::Sell, 50, 100);
        sell_order.market_id = market_id;
        let (sell_result, _) = book.submit_order(sell_order);
        assert_eq!(sell_result.status, OrderStatus::Open);

        // Bob buys 100 YES tokens at 50¢
        let mut buy_order = create_test_order("bob", TokenSide::Yes, OrderSide::Buy, 50, 100);
        buy_order.market_id = market_id;
        let (buy_result, trades) = book.submit_order(buy_order);

        assert_eq!(buy_result.status, OrderStatus::Filled);
        assert_eq!(trades.len(), 1);
        assert_eq!(trades[0].price, 50);
        assert_eq!(trades[0].quantity, 100);
        assert_eq!(trades[0].buyer_user_id, "bob");
        assert_eq!(trades[0].seller_user_id, "alice");
    }

    #[test]
    fn test_price_improvement() {
        let market_id = Uuid::new_v4();
        let mut book = MarketOrderBook::new(market_id);

        // Alice sells 100 YES tokens at 45¢
        let mut sell_order = create_test_order("alice", TokenSide::Yes, OrderSide::Sell, 45, 100);
        sell_order.market_id = market_id;
        book.submit_order(sell_order);

        // Bob buys at 50¢ - should get price improvement to 45¢
        let mut buy_order = create_test_order("bob", TokenSide::Yes, OrderSide::Buy, 50, 100);
        buy_order.market_id = market_id;
        let (_, trades) = book.submit_order(buy_order);

        assert_eq!(trades[0].price, 45); // Trade at seller's price (better for buyer)
    }

    #[test]
    fn test_separate_yes_no_books() {
        let market_id = Uuid::new_v4();
        let mut book = MarketOrderBook::new(market_id);

        // Place order in YES book
        let mut yes_order = create_test_order("alice", TokenSide::Yes, OrderSide::Buy, 40, 100);
        yes_order.market_id = market_id;
        book.submit_order(yes_order);

        // Place order in NO book
        let mut no_order = create_test_order("bob", TokenSide::No, OrderSide::Buy, 60, 100);
        no_order.market_id = market_id;
        book.submit_order(no_order);

        let snapshot = book.get_snapshot();
        
        // YES book should have 1 bid
        assert_eq!(snapshot.yes.bids.len(), 1);
        assert_eq!(snapshot.yes.bids[0].price, 40);
        
        // NO book should have 1 bid
        assert_eq!(snapshot.no.bids.len(), 1);
        assert_eq!(snapshot.no.bids[0].price, 60);
    }

    #[test]
    fn test_partial_fill() {
        let market_id = Uuid::new_v4();
        let mut book = MarketOrderBook::new(market_id);

        // Alice sells 50 YES at 45¢
        let mut sell_order = create_test_order("alice", TokenSide::Yes, OrderSide::Sell, 45, 50);
        sell_order.market_id = market_id;
        book.submit_order(sell_order);

        // Bob buys 100 YES at 50¢ - only gets 50 filled
        let mut buy_order = create_test_order("bob", TokenSide::Yes, OrderSide::Buy, 50, 100);
        buy_order.market_id = market_id;
        let (result, trades) = book.submit_order(buy_order);

        assert_eq!(result.filled_qty, 50);
        assert_eq!(result.status, OrderStatus::Partial);
        assert_eq!(trades.len(), 1);

        // Remaining 50 should be in bids
        let snapshot = book.get_snapshot();
        assert_eq!(snapshot.yes.bids.len(), 1);
        assert_eq!(snapshot.yes.bids[0].quantity, 50);
    }

    #[test]
    fn test_order_cancellation() {
        let market_id = Uuid::new_v4();
        let mut book = MarketOrderBook::new(market_id);

        let mut order = create_test_order("alice", TokenSide::Yes, OrderSide::Buy, 40, 100);
        order.market_id = market_id;
        let order_id = order.id;
        book.submit_order(order);

        // Verify order is in book
        let snapshot = book.get_snapshot();
        assert_eq!(snapshot.yes.bids.len(), 1);

        // Cancel order
        let cancelled = book.cancel_order(order_id, "alice");
        assert!(cancelled.is_some());
        assert_eq!(cancelled.unwrap().status, OrderStatus::Cancelled);

        // Verify order is removed
        let snapshot = book.get_snapshot();
        assert_eq!(snapshot.yes.bids.len(), 0);
    }
}
