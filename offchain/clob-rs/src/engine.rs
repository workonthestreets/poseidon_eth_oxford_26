//! Matching Engine - Manages markets, positions, and balances
//!
//! Polymarket-style operations:
//! - BUY token: Pay USDC to acquire tokens
//! - SELL token: Sell tokens for USDC  
//! - SPLIT: $1 USDC → 1 YES + 1 NO token
//! - MERGE: 1 YES + 1 NO → $1 USDC

use crate::orderbook::MarketOrderBook;
use crate::types::*;
use parking_lot::RwLock;
use rust_decimal::Decimal;
use std::collections::HashMap;
use uuid::Uuid;

/// User account with balances and positions
#[derive(Debug, Default)]
pub struct UserAccount {
    pub balance: Decimal,                          // USDC balance
    pub locked_balance: Decimal,                   // USDC locked in open orders
    pub positions: HashMap<Uuid, Position>,        // market_id -> Position
}

impl UserAccount {
    pub fn available_balance(&self) -> Decimal {
        self.balance - self.locked_balance
    }
    
    pub fn get_position(&self, market_id: Uuid) -> Position {
        self.positions.get(&market_id).cloned().unwrap_or_default()
    }
    
    pub fn get_position_mut(&mut self, market_id: Uuid) -> &mut Position {
        self.positions.entry(market_id).or_default()
    }
}

/// Main matching engine
pub struct MatchingEngine {
    markets: RwLock<HashMap<Uuid, Market>>,
    orderbooks: RwLock<HashMap<Uuid, MarketOrderBook>>,
    users: RwLock<HashMap<String, UserAccount>>,
}

impl MatchingEngine {
    pub fn new() -> Self {
        Self {
            markets: RwLock::new(HashMap::new()),
            orderbooks: RwLock::new(HashMap::new()),
            users: RwLock::new(HashMap::new()),
        }
    }

    // ========== Market Management ==========

    pub fn create_market(&self, market: Market) -> Uuid {
        let id = market.id;
        self.markets.write().insert(id, market);
        self.orderbooks.write().insert(id, MarketOrderBook::new(id));
        id
    }

    pub fn get_market(&self, id: Uuid) -> Option<Market> {
        self.markets.read().get(&id).cloned()
    }

    pub fn list_markets(&self) -> Vec<Market> {
        self.markets.read().values().cloned().collect()
    }

    pub fn settle_market(&self, market_id: Uuid, outcome: bool) -> Result<(), String> {
        let settlement_price = if outcome { 100 } else { 0 };
        
        {
            let mut markets = self.markets.write();
            let market = markets.get_mut(&market_id)
                .ok_or("Market not found")?;
            
            if market.status != MarketStatus::Open {
                return Err("Market not open".to_string());
            }
            
            market.status = MarketStatus::Settled;
            market.settlement_price = Some(settlement_price);
        }

        // Settle all positions
        let users: Vec<String> = self.users.read().keys().cloned().collect();
        
        for user_id in users {
            let mut users = self.users.write();
            if let Some(account) = users.get_mut(&user_id) {
                if let Some(position) = account.positions.get(&market_id) {
                    // Calculate payout
                    let payout = if outcome {
                        // YES wins: YES tokens worth $1 each
                        Decimal::from(position.yes_tokens)
                    } else {
                        // NO wins: NO tokens worth $1 each
                        Decimal::from(position.no_tokens)
                    };
                    
                    account.balance += payout;
                    account.positions.remove(&market_id);
                }
            }
        }

        Ok(())
    }

    // ========== User Management ==========

    pub fn deposit(&self, user_id: &str, amount: Decimal) -> Decimal {
        let mut users = self.users.write();
        let account = users.entry(user_id.to_string()).or_default();
        account.balance += amount;
        account.balance
    }

    pub fn get_balance(&self, user_id: &str) -> Decimal {
        self.users.read()
            .get(user_id)
            .map(|a| a.balance)
            .unwrap_or_default()
    }

    pub fn get_available_balance(&self, user_id: &str) -> Decimal {
        self.users.read()
            .get(user_id)
            .map(|a| a.available_balance())
            .unwrap_or_default()
    }

    pub fn get_position(&self, user_id: &str, market_id: Uuid) -> Position {
        self.users.read()
            .get(user_id)
            .map(|a| a.get_position(market_id))
            .unwrap_or_default()
    }

    pub fn get_all_positions(&self, user_id: &str) -> HashMap<Uuid, Position> {
        self.users.read()
            .get(user_id)
            .map(|a| a.positions.clone())
            .unwrap_or_default()
    }

    // ========== Token Operations ==========

    /// Split: $1 USDC → 1 YES token + 1 NO token
    pub fn split(&self, user_id: &str, market_id: Uuid, amount: u64) -> Result<(), String> {
        let cost = Decimal::from(amount);
        
        let mut users = self.users.write();
        let account = users.entry(user_id.to_string()).or_default();
        
        if account.available_balance() < cost {
            return Err("Insufficient balance".to_string());
        }
        
        account.balance -= cost;
        let position = account.get_position_mut(market_id);
        position.add_yes(amount);
        position.add_no(amount);
        
        Ok(())
    }

    /// Merge: 1 YES token + 1 NO token → $1 USDC
    pub fn merge(&self, user_id: &str, market_id: Uuid, amount: u64) -> Result<(), String> {
        let mut users = self.users.write();
        let account = users.entry(user_id.to_string()).or_default();
        
        let position = account.get_position_mut(market_id);
        
        if position.yes_tokens < amount || position.no_tokens < amount {
            return Err("Insufficient tokens".to_string());
        }
        
        position.yes_tokens -= amount;
        position.no_tokens -= amount;
        account.balance += Decimal::from(amount);
        
        Ok(())
    }

    // ========== Order Management ==========

    pub fn submit_order(&self, order: Order) -> Result<(Order, Vec<Trade>, Decimal), String> {
        // Validate market
        {
            let markets = self.markets.read();
            let market = markets.get(&order.market_id)
                .ok_or("Market not found")?;
            if !market.is_active() {
                return Err("Market not active".to_string());
            }
        }

        // Calculate and lock collateral
        let collateral = self.calculate_collateral(&order)?;
        
        {
            let mut users = self.users.write();
            let account = users.entry(order.user_id.clone()).or_default();
            
            match order.order_side {
                OrderSide::Buy => {
                    // Need USDC to buy tokens
                    if account.available_balance() < collateral {
                        return Err(format!(
                            "Insufficient balance. Need ${}, have ${}",
                            collateral,
                            account.available_balance()
                        ));
                    }
                    account.locked_balance += collateral;
                }
                OrderSide::Sell => {
                    // Need tokens to sell
                    let position = account.get_position(order.market_id);
                    let tokens = match order.token_side {
                        TokenSide::Yes => position.yes_tokens,
                        TokenSide::No => position.no_tokens,
                    };
                    if tokens < order.quantity {
                        return Err(format!(
                            "Insufficient {:?} tokens. Need {}, have {}",
                            order.token_side,
                            order.quantity,
                            tokens
                        ));
                    }
                    // Lock the tokens (remove from available)
                    let pos = account.get_position_mut(order.market_id);
                    match order.token_side {
                        TokenSide::Yes => pos.yes_tokens -= order.quantity,
                        TokenSide::No => pos.no_tokens -= order.quantity,
                    }
                }
            }
        }

        // Submit to orderbook
        let (result_order, trades) = {
            let mut orderbooks = self.orderbooks.write();
            let book = orderbooks.get_mut(&order.market_id)
                .ok_or("Orderbook not found")?;
            book.submit_order(order)
        };

        // Process trades
        for trade in &trades {
            self.process_trade(trade)?;
        }

        // Handle unfilled portion
        {
            let mut users = self.users.write();
            let account = users.get_mut(&result_order.user_id).unwrap();
            
            match result_order.order_side {
                OrderSide::Buy => {
                    // Calculate how much was actually used
                    let filled_cost = Decimal::from(result_order.filled_qty as u64 * result_order.price as u64) / Decimal::from(100);
                    let unused = collateral - filled_cost;
                    
                    if result_order.is_filled() || result_order.order_type == OrderType::Market {
                        // Fully filled or market order: unlock all remaining
                        account.locked_balance -= collateral;
                        account.balance -= filled_cost;
                    } else {
                        // Partial fill: keep unfilled portion locked
                        let unfilled_collateral = Decimal::from(result_order.remaining_qty() as u64 * result_order.price as u64) / Decimal::from(100);
                        account.locked_balance -= filled_cost;
                        account.balance -= filled_cost;
                        // unfilled_collateral stays locked
                    }
                }
                OrderSide::Sell => {
                    // Tokens already removed, return unfilled tokens
                    if !result_order.is_filled() && result_order.order_type == OrderType::Market {
                        let unfilled = result_order.remaining_qty();
                        let pos = account.get_position_mut(result_order.market_id);
                        match result_order.token_side {
                            TokenSide::Yes => pos.yes_tokens += unfilled,
                            TokenSide::No => pos.no_tokens += unfilled,
                        }
                    }
                }
            }
        }

        Ok((result_order, trades, collateral))
    }

    fn calculate_collateral(&self, order: &Order) -> Result<Decimal, String> {
        Ok(match order.order_side {
            OrderSide::Buy => {
                // Cost = price * quantity / 100 (convert cents to dollars)
                Decimal::from(order.price as u64 * order.quantity) / Decimal::from(100)
            }
            OrderSide::Sell => {
                // No USDC needed, but need tokens
                Decimal::ZERO
            }
        })
    }

    fn process_trade(&self, trade: &Trade) -> Result<(), String> {
        let mut users = self.users.write();
        
        // Cost of trade in dollars
        let trade_value = Decimal::from(trade.price as u64 * trade.quantity) / Decimal::from(100);
        
        // Buyer receives tokens, pays USDC
        {
            let buyer = users.entry(trade.buyer_user_id.clone()).or_default();
            let position = buyer.get_position_mut(trade.market_id);
            match trade.token_side {
                TokenSide::Yes => position.add_yes(trade.quantity),
                TokenSide::No => position.add_no(trade.quantity),
            }
        }
        
        // Seller receives USDC
        {
            let seller = users.entry(trade.seller_user_id.clone()).or_default();
            seller.balance += trade_value;
        }
        
        Ok(())
    }

    pub fn cancel_order(&self, market_id: Uuid, order_id: Uuid, user_id: &str) -> Result<Order, String> {
        let order = {
            let mut orderbooks = self.orderbooks.write();
            let book = orderbooks.get_mut(&market_id)
                .ok_or("Market not found")?;
            book.cancel_order(order_id, user_id)
                .ok_or("Order not found or not owned by user")?
        };

        // Unlock collateral or return tokens
        {
            let mut users = self.users.write();
            let account = users.get_mut(user_id)
                .ok_or("User not found")?;
            
            match order.order_side {
                OrderSide::Buy => {
                    let locked = Decimal::from(order.remaining_qty() as u64 * order.price as u64) / Decimal::from(100);
                    account.locked_balance -= locked;
                }
                OrderSide::Sell => {
                    let position = account.get_position_mut(market_id);
                    match order.token_side {
                        TokenSide::Yes => position.yes_tokens += order.remaining_qty(),
                        TokenSide::No => position.no_tokens += order.remaining_qty(),
                    }
                }
            }
        }

        Ok(order)
    }

    // ========== Orderbook Access ==========

    pub fn get_orderbook(&self, market_id: Uuid) -> Option<OrderBookSnapshot> {
        self.orderbooks.read()
            .get(&market_id)
            .map(|book| book.get_snapshot())
    }

    pub fn get_trades(&self, market_id: Uuid, limit: usize) -> Vec<Trade> {
        self.orderbooks.read()
            .get(&market_id)
            .map(|book| book.get_trades(limit))
            .unwrap_or_default()
    }
}

impl Default for MatchingEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_and_merge() {
        let engine = MatchingEngine::new();
        
        // Create market
        let market = Market::new(
            "Test Vessel".to_string(),
            "1234567".to_string(),
            "A → B".to_string(),
            chrono::Utc::now(),
            24,
            Decimal::from(100000),
        );
        let market_id = engine.create_market(market);
        
        // Deposit
        engine.deposit("alice", Decimal::from(100));
        
        // Split $10 into 10 YES + 10 NO
        engine.split("alice", market_id, 10).unwrap();
        
        let position = engine.get_position("alice", market_id);
        assert_eq!(position.yes_tokens, 10);
        assert_eq!(position.no_tokens, 10);
        assert_eq!(engine.get_balance("alice"), Decimal::from(90));
        
        // Merge 5 pairs back
        engine.merge("alice", market_id, 5).unwrap();
        
        let position = engine.get_position("alice", market_id);
        assert_eq!(position.yes_tokens, 5);
        assert_eq!(position.no_tokens, 5);
        assert_eq!(engine.get_balance("alice"), Decimal::from(95));
    }

    #[test]
    fn test_buy_sell_flow() {
        let engine = MatchingEngine::new();
        
        let market = Market::new(
            "Test Vessel".to_string(),
            "1234567".to_string(),
            "A → B".to_string(),
            chrono::Utc::now(),
            24,
            Decimal::from(100000),
        );
        let market_id = engine.create_market(market);
        
        // Alice deposits and splits to get tokens
        engine.deposit("alice", Decimal::from(100));
        engine.split("alice", market_id, 50).unwrap();
        
        // Bob deposits USDC
        engine.deposit("bob", Decimal::from(100));
        
        // Alice sells 30 YES tokens at 60¢
        let sell_order = Order::new(
            "alice".to_string(),
            market_id,
            TokenSide::Yes,
            OrderSide::Sell,
            OrderType::Limit,
            60,
            30,
        );
        engine.submit_order(sell_order).unwrap();
        
        // Bob buys 30 YES tokens at 60¢
        let buy_order = Order::new(
            "bob".to_string(),
            market_id,
            TokenSide::Yes,
            OrderSide::Buy,
            OrderType::Limit,
            60,
            30,
        );
        let (result, trades, _) = engine.submit_order(buy_order).unwrap();
        
        assert_eq!(result.status, OrderStatus::Filled);
        assert_eq!(trades.len(), 1);
        
        // Check positions
        let alice_pos = engine.get_position("alice", market_id);
        assert_eq!(alice_pos.yes_tokens, 20); // Had 50, sold 30
        
        let bob_pos = engine.get_position("bob", market_id);
        assert_eq!(bob_pos.yes_tokens, 30); // Bought 30
        
        // Check balances
        // Alice: 100 - 50 (split) + 18 (sold 30 @ 60¢) = 68
        assert_eq!(engine.get_balance("alice"), Decimal::from(68));
        // Bob: 100 - 18 (bought 30 @ 60¢) = 82
        assert_eq!(engine.get_balance("bob"), Decimal::from(82));
    }
}
