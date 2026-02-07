//! RFQ Prediction Market Engine with Pre-Commitments
//!
//! Flow:
//! 1. Market created with departure_time
//! 2. Users place requests/bids BEFORE departure
//! 3. Bid accepted → PRE-COMMITMENT (locked, not yet emitted)
//! 4. At departure → All commitments EMITTED on-chain
//! 5. Settlement → Winners claim

use crate::types::*;
use parking_lot::RwLock;
use rustc_hash::FxHashMap;
use uuid::Uuid;

const REQUEST_EXPIRY_SECS: i64 = 86400;  // 24 hours
const BID_EXPIRY_SECS: i64 = 3600;       // 1 hour
const INITIAL_BALANCE: Cents = 100_000;  // $1000

pub struct AuctionEngine {
    markets: RwLock<FxHashMap<Uuid, Market>>,
    vaults: RwLock<FxHashMap<Uuid, Vault>>,
    requests: RwLock<FxHashMap<Uuid, Request>>,
    bids: RwLock<FxHashMap<Uuid, Bid>>,
    commitments: RwLock<FxHashMap<Uuid, Commitment>>,
    emissions: RwLock<Vec<Emission>>,
    users: RwLock<FxHashMap<String, UserAccount>>,
    emission_nonce: RwLock<u64>,
}

impl AuctionEngine {
    pub fn new() -> Self {
        Self {
            markets: RwLock::new(FxHashMap::default()),
            vaults: RwLock::new(FxHashMap::default()),
            requests: RwLock::new(FxHashMap::default()),
            bids: RwLock::new(FxHashMap::default()),
            commitments: RwLock::new(FxHashMap::default()),
            emissions: RwLock::new(Vec::new()),
            users: RwLock::new(FxHashMap::default()),
            emission_nonce: RwLock::new(0),
        }
    }

    // ════════════════════════════════════════════════════════════════════════════
    // MARKET
    // ════════════════════════════════════════════════════════════════════════════

    pub fn create_market(&self, input: CreateMarketInput) -> Result<Market, String> {
        if input.departure_time <= chrono::Utc::now() {
            return Err("Departure time must be in the future".to_string());
        }
        if input.settlement_time <= input.departure_time {
            return Err("Settlement must be after departure".to_string());
        }

        let mut market = Market::new(
            input.vessel_name,
            input.vessel_imo,
            input.description,
            input.departure_time,
            input.settlement_time,
        );
        market.departure_port = input.departure_port;
        market.destination_port = input.destination_port;

        let id = market.id;
        self.vaults.write().insert(id, Vault::new(id));
        self.markets.write().insert(id, market.clone());
        
        Ok(market)
    }

    pub fn get_market(&self, id: Uuid) -> Option<Market> {
        self.markets.read().get(&id).cloned()
    }

    pub fn list_markets(&self) -> Vec<Market> {
        self.markets.read().values().cloned().collect()
    }

    pub fn get_market_summary(&self, id: Uuid) -> Option<MarketSummary> {
        let market = self.markets.read().get(&id).cloned()?;
        let vault = self.vaults.read().get(&id).cloned().unwrap_or_else(|| Vault::new(id));
        
        let open_requests = self.requests.read()
            .values()
            .filter(|r| r.market_id == id && r.is_open())
            .count();
        
        let pending_commitments = self.commitments.read()
            .values()
            .filter(|c| c.market_id == id && c.status == CommitmentStatus::Pending)
            .count();

        Some(MarketSummary {
            market,
            vault,
            open_requests,
            pending_commitments,
        })
    }

    /// Update market with actual departure time from Datalastic
    pub fn update_departure(&self, market_id: Uuid, actual_departure: chrono::DateTime<chrono::Utc>) -> Result<(), String> {
        let mut markets = self.markets.write();
        let market = markets.get_mut(&market_id).ok_or("Market not found")?;
        
        market.actual_departure = Some(actual_departure);
        
        // If departure confirmed, activate market
        if market.status == MarketStatus::Pending {
            market.status = MarketStatus::Active;
        }
        
        Ok(())
    }

    // ════════════════════════════════════════════════════════════════════════════
    // REQUEST
    // ════════════════════════════════════════════════════════════════════════════

    pub fn create_request(&self, input: CreateRequestInput) -> Result<Request, String> {
        // Validate
        if input.max_price < 1 || input.max_price > 99 {
            return Err("Price must be 1-99 cents".to_string());
        }
        if input.quantity == 0 {
            return Err("Quantity must be > 0".to_string());
        }

        // Check market accepts commitments
        {
            let markets = self.markets.read();
            let market = markets.get(&input.market_id).ok_or("Market not found")?;
            if !market.is_accepting_commitments() {
                return Err("Market not accepting commitments (may have departed)".to_string());
            }
        }

        // Lock funds
        let max_collateral = input.max_price as Cents * input.quantity;
        {
            let mut users = self.users.write();
            let user = users
                .entry(input.user_id.clone())
                .or_insert_with(|| UserAccount::new(input.user_id.clone(), input.wallet.clone(), INITIAL_BALANCE));

            if input.wallet.is_some() {
                user.wallet = input.wallet.clone();
            }

            if !user.lock_funds(max_collateral) {
                return Err(format!("Insufficient balance. Need {}, have {}", max_collateral, user.balance));
            }
        }

        let request = Request::new(
            input.market_id,
            input.user_id,
            input.wallet,
            input.side,
            input.quantity,
            input.min_fill_quantity,
            input.max_price,
            REQUEST_EXPIRY_SECS,
        );

        self.requests.write().insert(request.id, request.clone());
        Ok(request)
    }

    pub fn get_request(&self, id: Uuid) -> Option<Request> {
        self.requests.read().get(&id).cloned()
    }

    pub fn get_request_with_bids(&self, id: Uuid) -> Option<RequestWithBids> {
        let request = self.requests.read().get(&id).cloned()?;
        let bids: Vec<Bid> = self.bids.read()
            .values()
            .filter(|b| b.request_id == id && b.is_pending())
            .cloned()
            .collect();
        
        let total_committed = self.commitments.read()
            .values()
            .filter(|c| c.request_id == id)
            .map(|c| c.quantity)
            .sum();

        Some(RequestWithBids { request, bids, total_committed })
    }

    pub fn get_market_requests(&self, market_id: Uuid) -> Vec<Request> {
        self.requests.read()
            .values()
            .filter(|r| r.market_id == market_id && r.is_open())
            .cloned()
            .collect()
    }

    pub fn cancel_request(&self, request_id: Uuid, user_id: &str) -> Result<Request, String> {
        let mut requests = self.requests.write();
        let request = requests.get_mut(&request_id).ok_or("Request not found")?;

        if request.user_id != user_id {
            return Err("Unauthorized".to_string());
        }
        if !request.is_open() {
            return Err("Request not open".to_string());
        }

        let refund = request.max_price as Cents * request.remaining_qty();
        request.cancel();
        let request_clone = request.clone();
        drop(requests);

        // Refund
        if let Some(user) = self.users.write().get_mut(user_id) {
            user.unlock_funds(refund);
        }

        // Cancel pending bids
        let bid_ids: Vec<Uuid> = self.bids.read()
            .values()
            .filter(|b| b.request_id == request_id && b.status == BidStatus::Pending)
            .map(|b| b.id)
            .collect();

        for bid_id in bid_ids {
            let _ = self.cancel_bid_internal(bid_id);
        }

        Ok(request_clone)
    }

    // ════════════════════════════════════════════════════════════════════════════
    // BID
    // ════════════════════════════════════════════════════════════════════════════

    pub fn submit_bid(&self, input: CreateBidInput) -> Result<Bid, String> {
        let request = self.requests.read()
            .get(&input.request_id)
            .cloned()
            .ok_or("Request not found")?;

        // Validate
        if !request.is_open() {
            return Err("Request not open".to_string());
        }
        if input.bidder_id == request.user_id {
            return Err("Cannot bid on own request".to_string());
        }
        if input.price < 1 || input.price > 99 {
            return Err("Price must be 1-99 cents".to_string());
        }
        if input.quantity == 0 || input.quantity > request.remaining_qty() {
            return Err(format!("Quantity must be 1-{}", request.remaining_qty()));
        }

        // Check minimum fill
        if let Some(min) = request.min_fill_quantity {
            if input.quantity < min && input.quantity < request.remaining_qty() {
                return Err(format!("Minimum fill is {} shares", min));
            }
        }

        // Check price acceptable
        let requester_price = 100 - input.price;
        if requester_price > request.max_price {
            return Err(format!("Requester max is {}¢, bid requires {}¢", request.max_price, requester_price));
        }

        // Lock bidder funds
        let collateral = input.price as Cents * input.quantity;
        {
            let mut users = self.users.write();
            let user = users
                .entry(input.bidder_id.clone())
                .or_insert_with(|| UserAccount::new(input.bidder_id.clone(), input.bidder_wallet.clone(), INITIAL_BALANCE));

            if input.bidder_wallet.is_some() {
                user.wallet = input.bidder_wallet.clone();
            }

            if !user.lock_funds(collateral) {
                return Err(format!("Insufficient balance. Need {}, have {}", collateral, user.balance));
            }
        }

        let bid = Bid::new(&request, input.bidder_id, input.bidder_wallet, input.quantity, input.price, BID_EXPIRY_SECS);
        self.bids.write().insert(bid.id, bid.clone());
        Ok(bid)
    }

    pub fn get_bid(&self, id: Uuid) -> Option<Bid> {
        self.bids.read().get(&id).cloned()
    }

    pub fn get_request_bids(&self, request_id: Uuid) -> Vec<Bid> {
        self.bids.read()
            .values()
            .filter(|b| b.request_id == request_id && b.is_pending())
            .cloned()
            .collect()
    }

    pub fn cancel_bid(&self, bid_id: Uuid, user_id: &str) -> Result<Bid, String> {
        let mut bids = self.bids.write();
        let bid = bids.get_mut(&bid_id).ok_or("Bid not found")?;

        if bid.bidder_id != user_id {
            return Err("Unauthorized".to_string());
        }
        if bid.status != BidStatus::Pending {
            return Err("Bid not pending".to_string());
        }

        let collateral = bid.collateral_locked;
        bid.status = BidStatus::Cancelled;
        let bid_clone = bid.clone();
        drop(bids);

        if let Some(user) = self.users.write().get_mut(user_id) {
            user.unlock_funds(collateral);
        }

        Ok(bid_clone)
    }

    fn cancel_bid_internal(&self, bid_id: Uuid) -> Result<(), String> {
        let mut bids = self.bids.write();
        let bid = bids.get_mut(&bid_id).ok_or("Bid not found")?;

        if bid.status != BidStatus::Pending {
            return Ok(());
        }

        let bidder_id = bid.bidder_id.clone();
        let collateral = bid.collateral_locked;
        bid.status = BidStatus::Cancelled;
        drop(bids);

        if let Some(user) = self.users.write().get_mut(&bidder_id) {
            user.unlock_funds(collateral);
        }

        Ok(())
    }

    // ════════════════════════════════════════════════════════════════════════════
    // ACCEPT BID → CREATE PRE-COMMITMENT
    // ════════════════════════════════════════════════════════════════════════════

    pub fn accept_bid(&self, bid_id: Uuid, user_id: &str) -> Result<AcceptBidResult, String> {
        // Get and validate bid
        let bid = {
            let mut bids = self.bids.write();
            let bid = bids.get_mut(&bid_id).ok_or("Bid not found")?;

            if bid.requester_id != user_id {
                return Err("Only requester can accept".to_string());
            }
            if !bid.is_pending() {
                return Err("Bid not pending".to_string());
            }

            bid.status = BidStatus::Accepted;
            bid.clone()
        };

        // Update request
        let request = {
            let mut requests = self.requests.write();
            let request = requests.get_mut(&bid.request_id).ok_or("Request not found")?;

            if !request.is_open() {
                return Err("Request not open".to_string());
            }

            request.fill(bid.quantity);
            request.clone()
        };

        // Create pre-commitment
        let commitment = Commitment::new(&request, &bid);
        let commitment_id = commitment.id;

        // Update user balances: move from locked to committed
        let requester_collateral = bid.requester_price as Cents * bid.quantity;
        let bidder_collateral = bid.price as Cents * bid.quantity;

        {
            let mut users = self.users.write();

            // Requester
            if let Some(user) = users.get_mut(&request.user_id) {
                user.commit_funds(requester_collateral);
                // Refund excess
                let excess = (request.max_price - bid.requester_price) as Cents * bid.quantity;
                if excess > 0 {
                    user.unlock_funds(excess);
                }
                let pos = user.get_position_mut(request.market_id);
                match request.side {
                    Side::Yes => pos.commit_yes(bid.quantity, requester_collateral),
                    Side::No => pos.commit_no(bid.quantity, requester_collateral),
                }
            }

            // Bidder
            if let Some(user) = users.get_mut(&bid.bidder_id) {
                user.commit_funds(bidder_collateral);
                let pos = user.get_position_mut(request.market_id);
                match bid.side {
                    Side::Yes => pos.commit_yes(bid.quantity, bidder_collateral),
                    Side::No => pos.commit_no(bid.quantity, bidder_collateral),
                }
            }
        }

        // Update vault
        {
            let mut vaults = self.vaults.write();
            if let Some(vault) = vaults.get_mut(&request.market_id) {
                vault.commit(bid.quantity, commitment.total_collateral);
            }
        }

        // Update market stats
        {
            let mut markets = self.markets.write();
            if let Some(market) = markets.get_mut(&request.market_id) {
                market.last_yes_price = Some(commitment.yes_price);
                market.last_no_price = Some(commitment.no_price);
                market.total_volume += commitment.total_collateral;
                market.total_committed_shares += bid.quantity;
            }
        }

        // Store commitment
        self.commitments.write().insert(commitment_id, commitment.clone());

        let remaining = request.remaining_qty();
        let message = if remaining > 0 {
            format!("Partial fill: {} committed, {} remaining. Request still open.", bid.quantity, remaining)
        } else {
            format!("Request fully filled: {} shares committed.", bid.quantity)
        };

        Ok(AcceptBidResult {
            bid,
            commitment,
            request_remaining: remaining,
            message,
        })
    }

    pub fn deny_bid(&self, bid_id: Uuid, user_id: &str) -> Result<Bid, String> {
        let mut bids = self.bids.write();
        let bid = bids.get_mut(&bid_id).ok_or("Bid not found")?;

        if bid.requester_id != user_id {
            return Err("Only requester can deny".to_string());
        }
        if !bid.is_pending() {
            return Err("Bid not pending".to_string());
        }

        let bidder_id = bid.bidder_id.clone();
        let collateral = bid.collateral_locked;
        bid.status = BidStatus::Denied;
        let bid_clone = bid.clone();
        drop(bids);

        if let Some(user) = self.users.write().get_mut(&bidder_id) {
            user.unlock_funds(collateral);
        }

        Ok(bid_clone)
    }

    // ════════════════════════════════════════════════════════════════════════════
    // EMISSION - Triggered at departure
    // ════════════════════════════════════════════════════════════════════════════

    /// Get all pending commitments for a market (ready to emit at departure)
    pub fn get_pending_commitments(&self, market_id: Uuid) -> Vec<Commitment> {
        self.commitments.read()
            .values()
            .filter(|c| c.market_id == market_id && c.status == CommitmentStatus::Pending)
            .cloned()
            .collect()
    }

    /// Emit all pending commitments for a market (called at departure)
    pub fn emit_commitments(&self, market_id: Uuid) -> Result<Vec<Emission>, String> {
        let market = self.markets.read().get(&market_id).cloned()
            .ok_or("Market not found")?;

        if !market.should_emit() {
            return Err("Market not ready for emission (departure not confirmed)".to_string());
        }

        let pending: Vec<Uuid> = self.commitments.read()
            .values()
            .filter(|c| c.market_id == market_id && c.status == CommitmentStatus::Pending)
            .map(|c| c.id)
            .collect();

        let mut emissions = Vec::new();

        for commitment_id in pending {
            if let Ok(emission) = self.emit_single_commitment(commitment_id) {
                emissions.push(emission);
            }
        }

        // Activate market
        {
            let mut markets = self.markets.write();
            if let Some(m) = markets.get_mut(&market_id) {
                m.status = MarketStatus::Active;
                m.total_emitted_shares = m.total_committed_shares;
            }
        }

        Ok(emissions)
    }

    fn emit_single_commitment(&self, commitment_id: Uuid) -> Result<Emission, String> {
        let mut commitments = self.commitments.write();
        let commitment = commitments.get_mut(&commitment_id).ok_or("Commitment not found")?;

        if commitment.status != CommitmentStatus::Pending {
            return Err("Commitment not pending".to_string());
        }

        // Need wallets for on-chain emission
        let yes_wallet = commitment.yes_wallet.clone()
            .ok_or("YES user wallet not set")?;
        let no_wallet = commitment.no_wallet.clone()
            .ok_or("NO user wallet not set")?;

        // Get nonce
        let nonce = {
            let mut n = self.emission_nonce.write();
            *n += 1;
            *n
        };

        commitment.status = CommitmentStatus::Emitted;
        commitment.emission_nonce = Some(nonce);
        commitment.emitted_at = Some(chrono::Utc::now());

        let emission = Emission {
            id: Uuid::new_v4(),
            commitment_id,
            market_id: commitment.market_id,
            yes_user_id: commitment.yes_user_id.clone(),
            yes_wallet,
            yes_price: commitment.yes_price,
            no_user_id: commitment.no_user_id.clone(),
            no_wallet,
            no_price: commitment.no_price,
            quantity: commitment.quantity,
            total_collateral: commitment.total_collateral,
            nonce,
            deadline: chrono::Utc::now() + chrono::Duration::hours(24),
            signature: String::new(), // To be signed by operator
            emitted_at: chrono::Utc::now(),
            tx_hash: None,
        };

        drop(commitments);

        // Update vault
        {
            let mut vaults = self.vaults.write();
            if let Some(vault) = vaults.get_mut(&emission.market_id) {
                vault.emit(emission.quantity, emission.total_collateral);
            }
        }

        // Update user positions
        {
            let mut users = self.users.write();
            
            if let Some(user) = users.get_mut(&emission.yes_user_id) {
                user.emit_funds(emission.yes_price as Cents * emission.quantity);
                let pos = user.get_position_mut(emission.market_id);
                pos.emit_yes(emission.quantity);
            }

            if let Some(user) = users.get_mut(&emission.no_user_id) {
                user.emit_funds(emission.no_price as Cents * emission.quantity);
                let pos = user.get_position_mut(emission.market_id);
                pos.emit_no(emission.quantity);
            }
        }

        // Store emission
        self.emissions.write().push(emission.clone());

        Ok(emission)
    }

    pub fn get_emissions(&self, market_id: Uuid) -> Vec<Emission> {
        self.emissions.read()
            .iter()
            .filter(|e| e.market_id == market_id)
            .cloned()
            .collect()
    }

    // ════════════════════════════════════════════════════════════════════════════
    // USER
    // ════════════════════════════════════════════════════════════════════════════

    pub fn get_or_create_user(&self, user_id: &str) -> UserAccount {
        let users = self.users.read();
        if let Some(user) = users.get(user_id) {
            return user.clone();
        }
        drop(users);

        self.users.write()
            .entry(user_id.to_string())
            .or_insert_with(|| UserAccount::new(user_id.to_string(), None, INITIAL_BALANCE))
            .clone()
    }

    pub fn get_user_summary(&self, user_id: &str) -> UserSummary {
        let account = self.get_or_create_user(user_id);

        let open_requests: Vec<Request> = self.requests.read()
            .values()
            .filter(|r| r.user_id == user_id && r.is_open())
            .cloned()
            .collect();

        let pending_bids: Vec<Bid> = self.bids.read()
            .values()
            .filter(|b| b.bidder_id == user_id && b.is_pending())
            .cloned()
            .collect();

        let pending_commitments: Vec<Commitment> = self.commitments.read()
            .values()
            .filter(|c| (c.yes_user_id == user_id || c.no_user_id == user_id) && c.status == CommitmentStatus::Pending)
            .cloned()
            .collect();

        let markets = self.markets.read();
        let positions: Vec<PositionSummary> = account.positions
            .iter()
            .filter(|(_, pos)| pos.total_yes() > 0 || pos.total_no() > 0)
            .map(|(market_id, pos)| {
                let vessel_name = markets.get(market_id)
                    .map(|m| m.vessel_name.clone())
                    .unwrap_or_default();
                PositionSummary {
                    market_id: *market_id,
                    vessel_name,
                    committed_yes: pos.committed_yes,
                    committed_no: pos.committed_no,
                    emitted_yes: pos.emitted_yes,
                    emitted_no: pos.emitted_no,
                }
            })
            .collect();

        UserSummary {
            user_id: user_id.to_string(),
            wallet: account.wallet,
            balance: account.balance,
            locked_balance: account.locked_balance,
            committed_balance: account.committed_balance,
            positions,
            open_requests,
            pending_bids,
            pending_commitments,
        }
    }

    pub fn set_user_wallet(&self, user_id: &str, wallet: String) {
        let mut users = self.users.write();
        let user = users
            .entry(user_id.to_string())
            .or_insert_with(|| UserAccount::new(user_id.to_string(), None, INITIAL_BALANCE));
        user.wallet = Some(wallet);
    }

    pub fn add_funds(&self, user_id: &str, amount: Cents) -> Cents {
        let mut users = self.users.write();
        let account = users
            .entry(user_id.to_string())
            .or_insert_with(|| UserAccount::new(user_id.to_string(), None, INITIAL_BALANCE));
        account.balance += amount;
        account.balance
    }

    // ════════════════════════════════════════════════════════════════════════════
    // SETTLEMENT
    // ════════════════════════════════════════════════════════════════════════════

    pub fn settle_market(&self, market_id: Uuid, outcome: bool) -> Result<Market, String> {
        let market = {
            let mut markets = self.markets.write();
            let market = markets.get_mut(&market_id).ok_or("Market not found")?;

            if market.status == MarketStatus::Settled {
                return Err("Already settled".to_string());
            }

            market.settle(outcome);
            market.clone()
        };

        // Cancel open requests
        let request_ids: Vec<(Uuid, String)> = self.requests.read()
            .values()
            .filter(|r| r.market_id == market_id && r.is_open())
            .map(|r| (r.id, r.user_id.clone()))
            .collect();

        for (id, user_id) in request_ids {
            let _ = self.cancel_request(id, &user_id);
        }

        // Distribute payouts
        self.distribute_payouts(market_id, outcome);

        Ok(market)
    }

    fn distribute_payouts(&self, market_id: Uuid, outcome: bool) {
        let vault = self.vaults.read().get(&market_id).cloned();
        let total_collateral = vault.map(|v| v.emitted_collateral).unwrap_or(0);
        let total_shares = vault.map(|v| v.emitted_shares).unwrap_or(0);

        if total_shares == 0 {
            return;
        }

        let mut users = self.users.write();

        for account in users.values_mut() {
            if let Some(position) = account.positions.remove(&market_id) {
                let winning_shares = if outcome { position.emitted_yes } else { position.emitted_no };
                if winning_shares > 0 {
                    let payout = (total_collateral * winning_shares) / total_shares;
                    account.balance += payout;
                }
            }
        }
    }

    // ════════════════════════════════════════════════════════════════════════════
    // CLEANUP
    // ════════════════════════════════════════════════════════════════════════════

    pub fn cleanup_expired(&self) {
        // Expire requests
        let expired_requests: Vec<(Uuid, String)> = self.requests.read()
            .values()
            .filter(|r| r.is_open() && r.is_expired())
            .map(|r| (r.id, r.user_id.clone()))
            .collect();

        for (id, user_id) in expired_requests {
            let _ = self.cancel_request(id, &user_id);
        }

        // Expire bids
        let expired_bids: Vec<(Uuid, String)> = self.bids.read()
            .values()
            .filter(|b| b.status == BidStatus::Pending && b.is_expired())
            .map(|b| (b.id, b.bidder_id.clone()))
            .collect();

        for (id, user_id) in expired_bids {
            let _ = self.cancel_bid(id, &user_id);
        }
    }
}

impl Default for AuctionEngine {
    fn default() -> Self {
        Self::new()
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn test_market_input() -> CreateMarketInput {
        CreateMarketInput {
            vessel_name: "MAERSK CHENNAI".to_string(),
            vessel_imo: "9525338".to_string(),
            description: "Will vessel be detained?".to_string(),
            departure_time: chrono::Utc::now() + Duration::days(1),
            settlement_time: chrono::Utc::now() + Duration::days(7),
            departure_port: Some("Rotterdam".to_string()),
            destination_port: Some("Singapore".to_string()),
        }
    }

    #[test]
    fn test_pre_commitment_flow() {
        let engine = AuctionEngine::new();
        
        // Create market
        let market = engine.create_market(test_market_input()).unwrap();
        
        // Alice wants YES
        let request = engine.create_request(CreateRequestInput {
            market_id: market.id,
            user_id: "alice".to_string(),
            wallet: Some("0xAlice".to_string()),
            side: Side::Yes,
            quantity: 100,
            min_fill_quantity: None,
            max_price: 60,
        }).unwrap();

        // Bob bids NO at 40¢
        let bid = engine.submit_bid(CreateBidInput {
            request_id: request.id,
            bidder_id: "bob".to_string(),
            bidder_wallet: Some("0xBob".to_string()),
            quantity: 100,
            price: 40,
        }).unwrap();

        // Alice accepts → commitment created
        let result = engine.accept_bid(bid.id, "alice").unwrap();
        
        assert_eq!(result.commitment.status, CommitmentStatus::Pending);
        assert_eq!(result.commitment.quantity, 100);
        assert_eq!(result.commitment.yes_price, 60);
        assert_eq!(result.commitment.no_price, 40);

        // Check positions show committed (not emitted)
        let alice = engine.get_user_summary("alice");
        let alice_pos = alice.positions.iter().find(|p| p.market_id == market.id).unwrap();
        assert_eq!(alice_pos.committed_yes, 100);
        assert_eq!(alice_pos.emitted_yes, 0);

        // Vault shows committed
        let vault = engine.get_market_summary(market.id).unwrap().vault;
        assert_eq!(vault.committed_shares, 100);
        assert_eq!(vault.emitted_shares, 0);
    }

    #[test]
    fn test_partial_fill() {
        let engine = AuctionEngine::new();
        let market = engine.create_market(test_market_input()).unwrap();
        
        // Alice wants 200 YES
        let request = engine.create_request(CreateRequestInput {
            market_id: market.id,
            user_id: "alice".to_string(),
            wallet: Some("0xAlice".to_string()),
            side: Side::Yes,
            quantity: 200,
            min_fill_quantity: Some(50),
            max_price: 60,
        }).unwrap();

        // Bob bids for 80
        let bid1 = engine.submit_bid(CreateBidInput {
            request_id: request.id,
            bidder_id: "bob".to_string(),
            bidder_wallet: Some("0xBob".to_string()),
            quantity: 80,
            price: 45,
        }).unwrap();

        let result1 = engine.accept_bid(bid1.id, "alice").unwrap();
        assert_eq!(result1.request_remaining, 120);
        assert!(result1.message.contains("Partial fill"));

        // Carol bids for remaining
        let bid2 = engine.submit_bid(CreateBidInput {
            request_id: request.id,
            bidder_id: "carol".to_string(),
            bidder_wallet: Some("0xCarol".to_string()),
            quantity: 120,
            price: 42,
        }).unwrap();

        let result2 = engine.accept_bid(bid2.id, "alice").unwrap();
        assert_eq!(result2.request_remaining, 0);
        assert!(result2.message.contains("fully filled"));

        // Alice has 200 committed
        let alice = engine.get_user_summary("alice");
        let alice_pos = alice.positions.iter().find(|p| p.market_id == market.id).unwrap();
        assert_eq!(alice_pos.committed_yes, 200);
    }

    #[test]
    fn test_emission_at_departure() {
        let engine = AuctionEngine::new();
        
        // Create market with departure in the past (for testing)
        let mut input = test_market_input();
        input.departure_time = chrono::Utc::now() - Duration::hours(1);
        
        // We need to bypass the validation for this test
        let mut market = Market::new(
            input.vessel_name,
            input.vessel_imo,
            input.description,
            chrono::Utc::now() - Duration::hours(1), // Past
            chrono::Utc::now() + Duration::days(7),
        );
        let market_id = market.id;
        engine.vaults.write().insert(market_id, Vault::new(market_id));
        engine.markets.write().insert(market_id, market.clone());

        // Create commitment manually (since we can't use normal flow with past departure)
        let commitment = Commitment {
            id: Uuid::new_v4(),
            request_id: Uuid::new_v4(),
            bid_id: Uuid::new_v4(),
            market_id,
            yes_user_id: "alice".to_string(),
            yes_wallet: Some("0xAlice".to_string()),
            yes_price: 60,
            yes_collateral: 6000,
            no_user_id: "bob".to_string(),
            no_wallet: Some("0xBob".to_string()),
            no_price: 40,
            no_collateral: 4000,
            quantity: 100,
            total_collateral: 10000,
            yes_signature: None,
            no_signature: None,
            operator_signature: None,
            status: CommitmentStatus::Pending,
            committed_at: chrono::Utc::now(),
            emission_nonce: None,
            emitted_at: None,
            tx_hash: None,
        };
        engine.commitments.write().insert(commitment.id, commitment);

        // Setup users
        {
            let mut users = engine.users.write();
            let alice = users.entry("alice".to_string()).or_insert_with(|| 
                UserAccount::new("alice".to_string(), Some("0xAlice".to_string()), INITIAL_BALANCE));
            alice.committed_balance = 6000;
            alice.get_position_mut(market_id).commit_yes(100, 6000);

            let bob = users.entry("bob".to_string()).or_insert_with(|| 
                UserAccount::new("bob".to_string(), Some("0xBob".to_string()), INITIAL_BALANCE));
            bob.committed_balance = 4000;
            bob.get_position_mut(market_id).commit_no(100, 4000);
        }

        // Update vault
        engine.vaults.write().get_mut(&market_id).unwrap().commit(100, 10000);

        // Emit commitments
        let emissions = engine.emit_commitments(market_id).unwrap();
        assert_eq!(emissions.len(), 1);
        assert_eq!(emissions[0].quantity, 100);

        // Check emitted
        let vault = engine.get_market_summary(market_id).unwrap().vault;
        assert_eq!(vault.emitted_shares, 100);
        assert_eq!(vault.committed_shares, 0);

        // Check user positions
        let alice = engine.get_user_summary("alice");
        let alice_pos = alice.positions.iter().find(|p| p.market_id == market_id).unwrap();
        assert_eq!(alice_pos.emitted_yes, 100);
        assert_eq!(alice_pos.committed_yes, 0);
    }
}
