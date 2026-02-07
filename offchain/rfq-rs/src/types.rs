//! Core types for Maritime RFQ Prediction Market
//!
//! ══════════════════════════════════════════════════════════════════════════════
//! PREDICTION MARKET MECHANICS WITH PRE-COMMITMENT
//! ══════════════════════════════════════════════════════════════════════════════
//!
//! Flow:
//! 1. Market created for vessel voyage (departure time specified)
//! 2. Users place requests/bids BEFORE departure
//! 3. When bid accepted → PRE-COMMITMENT created (both parties locked in)
//! 4. At DEPARTURE TIME → Actual emission happens on-chain
//! 5. At SETTLEMENT → Oracle resolves, winner claims
//!
//! This allows trading before the voyage starts, with shares emitted
//! only when the ship actually departs.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub type Price = u8;      // 1-99 cents
pub type Quantity = u64;  // Number of shares
pub type Cents = u64;     // Money in cents

// ═══════════════════════════════════════════════════════════════════════════════
// SIDE (YES or NO)
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Side {
    Yes,
    No,
}

impl Side {
    pub fn opposite(&self) -> Side {
        match self {
            Side::Yes => Side::No,
            Side::No => Side::Yes,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MARKET - With departure time for emission trigger
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum MarketStatus {
    Pending,    // Before departure - accepting pre-commitments
    Active,     // After departure - shares emitted, trading continues
    Closed,     // No more trading
    Settled,    // Outcome determined
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Market {
    pub id: Uuid,
    pub on_chain_id: Option<u64>,
    
    // Vessel info
    pub vessel_name: String,
    pub vessel_imo: String,
    pub description: String,
    
    // Key timestamps
    pub departure_time: DateTime<Utc>,    // When shares get emitted
    pub settlement_time: DateTime<Utc>,   // When market resolves
    
    // Departure tracking (from Datalastic)
    pub departure_port: Option<String>,
    pub departure_port_unlocode: Option<String>,
    pub actual_departure: Option<DateTime<Utc>>,  // From API: atd_UTC
    pub destination_port: Option<String>,
    pub eta: Option<DateTime<Utc>>,
    
    pub status: MarketStatus,
    pub outcome: Option<bool>,
    pub created_at: DateTime<Utc>,
    
    // Statistics
    pub last_yes_price: Option<Price>,
    pub last_no_price: Option<Price>,
    pub total_volume: Cents,
    pub total_committed_shares: Quantity,  // Pre-committed (not yet emitted)
    pub total_emitted_shares: Quantity,    // Actually emitted on-chain
}

impl Market {
    pub fn new(
        vessel_name: String,
        vessel_imo: String,
        description: String,
        departure_time: DateTime<Utc>,
        settlement_time: DateTime<Utc>,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            on_chain_id: None,
            vessel_name,
            vessel_imo,
            description,
            departure_time,
            settlement_time,
            departure_port: None,
            departure_port_unlocode: None,
            actual_departure: None,
            destination_port: None,
            eta: None,
            status: MarketStatus::Pending,
            outcome: None,
            created_at: Utc::now(),
            last_yes_price: None,
            last_no_price: None,
            total_volume: 0,
            total_committed_shares: 0,
            total_emitted_shares: 0,
        }
    }

    pub fn is_accepting_commitments(&self) -> bool {
        self.status == MarketStatus::Pending && Utc::now() < self.departure_time
    }

    pub fn is_active(&self) -> bool {
        self.status == MarketStatus::Active || self.status == MarketStatus::Pending
    }

    pub fn should_emit(&self) -> bool {
        // Emit when departure time passed and we have commitments
        (self.status == MarketStatus::Pending && Utc::now() >= self.departure_time)
            || self.actual_departure.is_some()
    }

    pub fn activate(&mut self) {
        self.status = MarketStatus::Active;
    }

    pub fn settle(&mut self, outcome: bool) {
        self.status = MarketStatus::Settled;
        self.outcome = Some(outcome);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REQUEST - User wants to buy shares
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum RequestStatus {
    Open,           // Accepting bids
    PartiallyFilled,// Some bids accepted, still open
    Filled,         // Fully committed
    Cancelled,
    Expired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Request {
    pub id: Uuid,
    pub market_id: Uuid,
    pub user_id: String,
    pub wallet: Option<String>,
    pub side: Side,
    pub quantity: Quantity,
    pub min_fill_quantity: Option<Quantity>,  // Minimum per bid
    pub max_price: Price,
    pub filled_qty: Quantity,                 // Total committed
    pub status: RequestStatus,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

impl Request {
    pub fn new(
        market_id: Uuid,
        user_id: String,
        wallet: Option<String>,
        side: Side,
        quantity: Quantity,
        min_fill_quantity: Option<Quantity>,
        max_price: Price,
        expiry_seconds: i64,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            market_id,
            user_id,
            wallet,
            side,
            quantity,
            min_fill_quantity,
            max_price,
            filled_qty: 0,
            status: RequestStatus::Open,
            created_at: now,
            expires_at: now + chrono::Duration::seconds(expiry_seconds),
        }
    }

    pub fn remaining_qty(&self) -> Quantity {
        self.quantity - self.filled_qty
    }

    pub fn is_open(&self) -> bool {
        matches!(self.status, RequestStatus::Open | RequestStatus::PartiallyFilled) 
            && !self.is_expired()
    }

    pub fn is_expired(&self) -> bool {
        Utc::now() >= self.expires_at
    }

    pub fn fill(&mut self, qty: Quantity) {
        self.filled_qty += qty;
        if self.filled_qty >= self.quantity {
            self.status = RequestStatus::Filled;
        } else if self.filled_qty > 0 {
            self.status = RequestStatus::PartiallyFilled;
        }
    }

    pub fn cancel(&mut self) {
        self.status = RequestStatus::Cancelled;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// BID - Counterparty offer
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum BidStatus {
    Pending,
    Accepted,   // Pre-commitment created
    Denied,
    Expired,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bid {
    pub id: Uuid,
    pub request_id: Uuid,
    pub market_id: Uuid,
    pub bidder_id: String,
    pub bidder_wallet: Option<String>,
    pub requester_id: String,
    pub requester_wallet: Option<String>,
    pub side: Side,
    pub quantity: Quantity,
    pub price: Price,
    pub requester_price: Price,
    pub collateral_locked: Cents,
    pub status: BidStatus,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

impl Bid {
    pub fn new(
        request: &Request,
        bidder_id: String,
        bidder_wallet: Option<String>,
        quantity: Quantity,
        price: Price,
        expiry_seconds: i64,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            request_id: request.id,
            market_id: request.market_id,
            bidder_id,
            bidder_wallet,
            requester_id: request.user_id.clone(),
            requester_wallet: request.wallet.clone(),
            side: request.side.opposite(),
            quantity,
            price,
            requester_price: 100 - price,
            collateral_locked: price as Cents * quantity,
            status: BidStatus::Pending,
            created_at: now,
            expires_at: now + chrono::Duration::seconds(expiry_seconds),
        }
    }

    pub fn is_pending(&self) -> bool {
        self.status == BidStatus::Pending && !self.is_expired()
    }

    pub fn is_expired(&self) -> bool {
        Utc::now() >= self.expires_at
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRE-COMMITMENT - Agreement before departure
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum CommitmentStatus {
    Pending,      // Waiting for departure
    Emitted,      // Shares emitted on-chain
    Cancelled,    // Cancelled before departure (rare)
}

/// Pre-commitment: Both parties agreed, shares will be emitted at departure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Commitment {
    pub id: Uuid,
    pub request_id: Uuid,
    pub bid_id: Uuid,
    pub market_id: Uuid,
    
    // YES side
    pub yes_user_id: String,
    pub yes_wallet: Option<String>,
    pub yes_price: Price,
    pub yes_collateral: Cents,
    
    // NO side
    pub no_user_id: String,
    pub no_wallet: Option<String>,
    pub no_price: Price,
    pub no_collateral: Cents,
    
    // Commitment
    pub quantity: Quantity,
    pub total_collateral: Cents,
    
    // Signatures (for on-chain emission at departure)
    pub yes_signature: Option<String>,
    pub no_signature: Option<String>,
    pub operator_signature: Option<String>,
    
    pub status: CommitmentStatus,
    pub committed_at: DateTime<Utc>,
    
    // Emission tracking
    pub emission_nonce: Option<u64>,
    pub emitted_at: Option<DateTime<Utc>>,
    pub tx_hash: Option<String>,
}

impl Commitment {
    pub fn new(request: &Request, bid: &Bid) -> Self {
        let (yes_user_id, yes_wallet, yes_price, yes_collateral, 
             no_user_id, no_wallet, no_price, no_collateral) = 
            match request.side {
                Side::Yes => (
                    request.user_id.clone(),
                    request.wallet.clone(),
                    bid.requester_price,
                    bid.requester_price as Cents * bid.quantity,
                    bid.bidder_id.clone(),
                    bid.bidder_wallet.clone(),
                    bid.price,
                    bid.price as Cents * bid.quantity,
                ),
                Side::No => (
                    bid.bidder_id.clone(),
                    bid.bidder_wallet.clone(),
                    bid.price,
                    bid.price as Cents * bid.quantity,
                    request.user_id.clone(),
                    request.wallet.clone(),
                    bid.requester_price,
                    bid.requester_price as Cents * bid.quantity,
                ),
            };
        
        Self {
            id: Uuid::new_v4(),
            request_id: request.id,
            bid_id: bid.id,
            market_id: request.market_id,
            yes_user_id,
            yes_wallet,
            yes_price,
            yes_collateral,
            no_user_id,
            no_wallet,
            no_price,
            no_collateral,
            quantity: bid.quantity,
            total_collateral: yes_collateral + no_collateral,
            yes_signature: None,
            no_signature: None,
            operator_signature: None,
            status: CommitmentStatus::Pending,
            committed_at: Utc::now(),
            emission_nonce: None,
            emitted_at: None,
            tx_hash: None,
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMISSION - Shares actually created on-chain
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Emission {
    pub id: Uuid,
    pub commitment_id: Uuid,
    pub market_id: Uuid,
    
    pub yes_user_id: String,
    pub yes_wallet: String,
    pub yes_price: Price,
    
    pub no_user_id: String,
    pub no_wallet: String,
    pub no_price: Price,
    
    pub quantity: Quantity,
    pub total_collateral: Cents,
    
    pub nonce: u64,
    pub deadline: DateTime<Utc>,
    pub signature: String,
    
    pub emitted_at: DateTime<Utc>,
    pub tx_hash: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// USER ACCOUNT
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Position {
    pub committed_yes: Quantity,   // Pre-committed, not yet emitted
    pub committed_no: Quantity,
    pub emitted_yes: Quantity,     // Actually emitted on-chain
    pub emitted_no: Quantity,
    pub total_yes_cost: Cents,
    pub total_no_cost: Cents,
}

impl Position {
    pub fn commit_yes(&mut self, qty: Quantity, cost: Cents) {
        self.committed_yes += qty;
        self.total_yes_cost += cost;
    }

    pub fn commit_no(&mut self, qty: Quantity, cost: Cents) {
        self.committed_no += qty;
        self.total_no_cost += cost;
    }

    pub fn emit_yes(&mut self, qty: Quantity) {
        self.committed_yes = self.committed_yes.saturating_sub(qty);
        self.emitted_yes += qty;
    }

    pub fn emit_no(&mut self, qty: Quantity) {
        self.committed_no = self.committed_no.saturating_sub(qty);
        self.emitted_no += qty;
    }
    
    pub fn total_yes(&self) -> Quantity {
        self.committed_yes + self.emitted_yes
    }
    
    pub fn total_no(&self) -> Quantity {
        self.committed_no + self.emitted_no
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserAccount {
    pub user_id: String,
    pub wallet: Option<String>,
    pub balance: Cents,
    pub locked_balance: Cents,     // Locked in open requests/bids
    pub committed_balance: Cents,  // Locked in commitments (until emission)
    pub positions: rustc_hash::FxHashMap<Uuid, Position>,
}

impl UserAccount {
    pub fn new(user_id: String, wallet: Option<String>, initial_balance: Cents) -> Self {
        Self {
            user_id,
            wallet,
            balance: initial_balance,
            locked_balance: 0,
            committed_balance: 0,
            positions: Default::default(),
        }
    }

    pub fn available_balance(&self) -> Cents {
        self.balance
    }

    pub fn lock_funds(&mut self, amount: Cents) -> bool {
        if self.balance >= amount {
            self.balance -= amount;
            self.locked_balance += amount;
            true
        } else {
            false
        }
    }

    pub fn unlock_funds(&mut self, amount: Cents) {
        let unlock = amount.min(self.locked_balance);
        self.locked_balance -= unlock;
        self.balance += unlock;
    }

    pub fn commit_funds(&mut self, amount: Cents) {
        // Move from locked to committed
        let commit = amount.min(self.locked_balance);
        self.locked_balance -= commit;
        self.committed_balance += commit;
    }

    pub fn emit_funds(&mut self, amount: Cents) {
        // Committed funds are now actually spent (on-chain)
        self.committed_balance = self.committed_balance.saturating_sub(amount);
    }

    pub fn get_position_mut(&mut self, market_id: Uuid) -> &mut Position {
        self.positions.entry(market_id).or_default()
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VAULT
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Vault {
    pub market_id: Uuid,
    pub committed_collateral: Cents,   // Pre-committed
    pub emitted_collateral: Cents,     // On-chain
    pub committed_shares: Quantity,
    pub emitted_shares: Quantity,
}

impl Vault {
    pub fn new(market_id: Uuid) -> Self {
        Self {
            market_id,
            committed_collateral: 0,
            emitted_collateral: 0,
            committed_shares: 0,
            emitted_shares: 0,
        }
    }

    pub fn commit(&mut self, quantity: Quantity, collateral: Cents) {
        self.committed_shares += quantity;
        self.committed_collateral += collateral;
    }

    pub fn emit(&mut self, quantity: Quantity, collateral: Cents) {
        self.committed_shares = self.committed_shares.saturating_sub(quantity);
        self.committed_collateral = self.committed_collateral.saturating_sub(collateral);
        self.emitted_shares += quantity;
        self.emitted_collateral += collateral;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// API TYPES
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Deserialize)]
pub struct CreateMarketInput {
    pub vessel_name: String,
    pub vessel_imo: String,
    pub description: String,
    pub departure_time: DateTime<Utc>,
    pub settlement_time: DateTime<Utc>,
    pub departure_port: Option<String>,
    pub destination_port: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateRequestInput {
    pub market_id: Uuid,
    pub user_id: String,
    pub wallet: Option<String>,
    pub side: Side,
    pub quantity: Quantity,
    pub min_fill_quantity: Option<Quantity>,
    pub max_price: Price,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateBidInput {
    pub request_id: Uuid,
    pub bidder_id: String,
    pub bidder_wallet: Option<String>,
    pub quantity: Quantity,
    pub price: Price,
}

#[derive(Debug, Clone, Serialize)]
pub struct RequestWithBids {
    pub request: Request,
    pub bids: Vec<Bid>,
    pub total_committed: Quantity,
}

#[derive(Debug, Clone, Serialize)]
pub struct AcceptBidResult {
    pub bid: Bid,
    pub commitment: Commitment,
    pub request_remaining: Quantity,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct UserSummary {
    pub user_id: String,
    pub wallet: Option<String>,
    pub balance: Cents,
    pub locked_balance: Cents,
    pub committed_balance: Cents,
    pub positions: Vec<PositionSummary>,
    pub open_requests: Vec<Request>,
    pub pending_bids: Vec<Bid>,
    pub pending_commitments: Vec<Commitment>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PositionSummary {
    pub market_id: Uuid,
    pub vessel_name: String,
    pub committed_yes: Quantity,
    pub committed_no: Quantity,
    pub emitted_yes: Quantity,
    pub emitted_no: Quantity,
}

#[derive(Debug, Clone, Serialize)]
pub struct MarketSummary {
    pub market: Market,
    pub vault: Vault,
    pub open_requests: usize,
    pub pending_commitments: usize,
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATALASTIC INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════

/// Vessel data from Datalastic /vessel_pro endpoint
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VesselData {
    pub imo: String,
    pub name: String,
    pub mmsi: Option<String>,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub speed: Option<f64>,
    pub destination: Option<String>,
    pub dep_port: Option<String>,
    pub dep_port_unlocode: Option<String>,
    pub atd_utc: Option<DateTime<Utc>>,     // Actual departure time
    pub eta_utc: Option<DateTime<Utc>>,      // ETA
    pub nav_status: Option<String>,
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBSOCKET
// ═══════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", content = "data")]
pub enum WsMessage {
    NewRequest(Request),
    NewBid { request_id: Uuid, bid: Bid },
    BidAccepted { commitment: Commitment },
    BidDenied { bid_id: Uuid },
    RequestPartiallyFilled { request_id: Uuid, filled: Quantity, remaining: Quantity },
    MarketDeparture { market_id: Uuid, actual_departure: DateTime<Utc> },
    SharesEmitted { market_id: Uuid, total_emitted: Quantity },
    MarketSettled { market_id: Uuid, outcome: bool },
}
