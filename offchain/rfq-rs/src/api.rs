//! REST API for Maritime RFQ Prediction Market

use crate::engine::AuctionEngine;
use crate::types::*;
use axum::{
    extract::{Path, State, Json},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use uuid::Uuid;

pub type SharedState = Arc<AppState>;

pub struct AppState {
    pub engine: AuctionEngine,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            engine: AuctionEngine::new(),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

// ════════════════════════════════════════════════════════════════════════════
// ROUTER
// ════════════════════════════════════════════════════════════════════════════

pub fn create_router(state: SharedState) -> Router {
    Router::new()
        // Health
        .route("/api/health", get(health))
        
        // Markets
        .route("/api/markets", get(list_markets).post(create_market))
        .route("/api/markets/:id", get(get_market))
        .route("/api/markets/:id/requests", get(get_market_requests))
        .route("/api/markets/:id/vault", get(get_vault))
        .route("/api/markets/:id/settle", post(settle_market))
        .route("/api/markets/:id/departure", post(update_departure))
        .route("/api/markets/:id/emit", post(emit_market_commitments))
        .route("/api/markets/:id/commitments", get(get_market_commitments))
        .route("/api/markets/:id/emissions", get(get_market_emissions))
        
        // Requests
        .route("/api/requests", post(create_request))
        .route("/api/requests/:id", get(get_request))
        .route("/api/requests/:id/cancel", post(cancel_request))
        .route("/api/requests/:id/bids", get(get_request_bids).post(submit_bid))
        
        // Bids
        .route("/api/bids/:id", get(get_bid))
        .route("/api/bids/:id/accept", post(accept_bid))
        .route("/api/bids/:id/deny", post(deny_bid))
        .route("/api/bids/:id/cancel", post(cancel_bid))
        
        // Users
        .route("/api/users/:id", get(get_user))
        .route("/api/users/:id/wallet", post(set_user_wallet))
        .route("/api/users/:id/deposit", post(add_funds))
        
        // On-chain
        .route("/api/emissions/pending", get(get_pending_emissions))
        .route("/api/emissions/:id/submitted", post(mark_emission_submitted))
        
        .layer(CorsLayer::permissive())
        .with_state(state)
}

// ════════════════════════════════════════════════════════════════════════════
// DEMO INITIALIZATION
// ════════════════════════════════════════════════════════════════════════════

pub fn init_demo_markets(state: &SharedState) {
    use chrono::{Utc, Duration};

    let market1 = CreateMarketInput {
        vessel_name: "MAERSK CHENNAI".to_string(),
        vessel_imo: "9525338".to_string(),
        description: "Will MAERSK CHENNAI be detained at next PSC inspection?".to_string(),
        departure_time: Utc::now() + Duration::hours(2),
        settlement_time: Utc::now() + Duration::days(7),
        departure_port: Some("Rotterdam".to_string()),
        destination_port: Some("Singapore".to_string()),
    };

    let market2 = CreateMarketInput {
        vessel_name: "MSC GÜLSÜN".to_string(),
        vessel_imo: "9839430".to_string(),
        description: "Will MSC GÜLSÜN arrive at destination within ETA?".to_string(),
        departure_time: Utc::now() + Duration::hours(4),
        settlement_time: Utc::now() + Duration::days(14),
        departure_port: Some("Shanghai".to_string()),
        destination_port: Some("Hamburg".to_string()),
    };

    let _ = state.engine.create_market(market1);
    let _ = state.engine.create_market(market2);
}

// ════════════════════════════════════════════════════════════════════════════
// RESPONSE HELPERS
// ════════════════════════════════════════════════════════════════════════════

#[derive(Serialize)]
struct ApiResponse<T> {
    success: bool,
    data: Option<T>,
    error: Option<String>,
}

impl<T: Serialize> ApiResponse<T> {
    fn ok(data: T) -> Json<Self> {
        Json(Self { success: true, data: Some(data), error: None })
    }

    fn err(msg: impl Into<String>) -> (StatusCode, Json<Self>) {
        (StatusCode::BAD_REQUEST, Json(Self { 
            success: false, 
            data: None, 
            error: Some(msg.into()) 
        }))
    }
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLERS
// ════════════════════════════════════════════════════════════════════════════

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({ "status": "ok", "service": "maritime-rfq" }))
}

// Markets
async fn list_markets(State(state): State<SharedState>) -> impl IntoResponse {
    ApiResponse::ok(state.engine.list_markets())
}

async fn create_market(
    State(state): State<SharedState>,
    Json(input): Json<CreateMarketInput>,
) -> impl IntoResponse {
    match state.engine.create_market(input) {
        Ok(market) => ApiResponse::ok(market).into_response(),
        Err(e) => ApiResponse::<Market>::err(e).into_response(),
    }
}

async fn get_market(
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
) -> impl IntoResponse {
    match state.engine.get_market_summary(id) {
        Some(s) => ApiResponse::ok(s).into_response(),
        None => ApiResponse::<MarketSummary>::err("Market not found").into_response(),
    }
}

async fn get_market_requests(
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
) -> impl IntoResponse {
    ApiResponse::ok(state.engine.get_market_requests(id))
}

async fn get_vault(
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
) -> impl IntoResponse {
    match state.engine.get_market_summary(id) {
        Some(s) => ApiResponse::ok(s.vault).into_response(),
        None => ApiResponse::<Vault>::err("Market not found").into_response(),
    }
}

#[derive(Deserialize)]
struct SettleInput {
    outcome: bool,
}

async fn settle_market(
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
    Json(input): Json<SettleInput>,
) -> impl IntoResponse {
    match state.engine.settle_market(id, input.outcome) {
        Ok(market) => ApiResponse::ok(market).into_response(),
        Err(e) => ApiResponse::<Market>::err(e).into_response(),
    }
}

#[derive(Deserialize)]
struct DepartureInput {
    actual_departure: chrono::DateTime<chrono::Utc>,
}

async fn update_departure(
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
    Json(input): Json<DepartureInput>,
) -> impl IntoResponse {
    match state.engine.update_departure(id, input.actual_departure) {
        Ok(()) => ApiResponse::ok("Departure updated").into_response(),
        Err(e) => ApiResponse::<&str>::err(e).into_response(),
    }
}

async fn emit_market_commitments(
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
) -> impl IntoResponse {
    match state.engine.emit_commitments(id) {
        Ok(emissions) => ApiResponse::ok(emissions).into_response(),
        Err(e) => ApiResponse::<Vec<Emission>>::err(e).into_response(),
    }
}

async fn get_market_commitments(
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
) -> impl IntoResponse {
    ApiResponse::ok(state.engine.get_pending_commitments(id))
}

async fn get_market_emissions(
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
) -> impl IntoResponse {
    ApiResponse::ok(state.engine.get_emissions(id))
}

// Requests
async fn create_request(
    State(state): State<SharedState>,
    Json(input): Json<CreateRequestInput>,
) -> impl IntoResponse {
    match state.engine.create_request(input) {
        Ok(req) => ApiResponse::ok(req).into_response(),
        Err(e) => ApiResponse::<Request>::err(e).into_response(),
    }
}

async fn get_request(
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
) -> impl IntoResponse {
    match state.engine.get_request_with_bids(id) {
        Some(r) => ApiResponse::ok(r).into_response(),
        None => ApiResponse::<RequestWithBids>::err("Request not found").into_response(),
    }
}

#[derive(Deserialize)]
struct CancelInput {
    user_id: String,
}

async fn cancel_request(
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
    Json(input): Json<CancelInput>,
) -> impl IntoResponse {
    match state.engine.cancel_request(id, &input.user_id) {
        Ok(req) => ApiResponse::ok(req).into_response(),
        Err(e) => ApiResponse::<Request>::err(e).into_response(),
    }
}

async fn get_request_bids(
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
) -> impl IntoResponse {
    ApiResponse::ok(state.engine.get_request_bids(id))
}

async fn submit_bid(
    State(state): State<SharedState>,
    Path(request_id): Path<Uuid>,
    Json(mut input): Json<CreateBidInput>,
) -> impl IntoResponse {
    input.request_id = request_id;
    match state.engine.submit_bid(input) {
        Ok(bid) => ApiResponse::ok(bid).into_response(),
        Err(e) => ApiResponse::<Bid>::err(e).into_response(),
    }
}

// Bids
async fn get_bid(
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
) -> impl IntoResponse {
    match state.engine.get_bid(id) {
        Some(b) => ApiResponse::ok(b).into_response(),
        None => ApiResponse::<Bid>::err("Bid not found").into_response(),
    }
}

#[derive(Deserialize)]
struct AcceptInput {
    user_id: String,
}

async fn accept_bid(
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
    Json(input): Json<AcceptInput>,
) -> impl IntoResponse {
    match state.engine.accept_bid(id, &input.user_id) {
        Ok(result) => ApiResponse::ok(result).into_response(),
        Err(e) => ApiResponse::<AcceptBidResult>::err(e).into_response(),
    }
}

async fn deny_bid(
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
    Json(input): Json<AcceptInput>,
) -> impl IntoResponse {
    match state.engine.deny_bid(id, &input.user_id) {
        Ok(bid) => ApiResponse::ok(bid).into_response(),
        Err(e) => ApiResponse::<Bid>::err(e).into_response(),
    }
}

async fn cancel_bid(
    State(state): State<SharedState>,
    Path(id): Path<Uuid>,
    Json(input): Json<CancelInput>,
) -> impl IntoResponse {
    match state.engine.cancel_bid(id, &input.user_id) {
        Ok(bid) => ApiResponse::ok(bid).into_response(),
        Err(e) => ApiResponse::<Bid>::err(e).into_response(),
    }
}

// Users
async fn get_user(
    State(state): State<SharedState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    ApiResponse::ok(state.engine.get_user_summary(&id))
}

#[derive(Deserialize)]
struct SetWalletInput {
    wallet: String,
}

async fn set_user_wallet(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(input): Json<SetWalletInput>,
) -> impl IntoResponse {
    state.engine.set_user_wallet(&id, input.wallet);
    ApiResponse::ok("Wallet set")
}

#[derive(Deserialize)]
struct DepositInput {
    amount: Cents,
}

async fn add_funds(
    State(state): State<SharedState>,
    Path(id): Path<String>,
    Json(input): Json<DepositInput>,
) -> impl IntoResponse {
    let new_balance = state.engine.add_funds(&id, input.amount);
    ApiResponse::ok(serde_json::json!({ "balance": new_balance }))
}

// Emissions
async fn get_pending_emissions(
    State(state): State<SharedState>,
) -> impl IntoResponse {
    // Get all markets and their pending commitments
    let markets = state.engine.list_markets();
    let mut pending: Vec<Commitment> = Vec::new();
    
    for market in markets {
        if market.should_emit() {
            let commitments = state.engine.get_pending_commitments(market.id);
            pending.extend(commitments);
        }
    }
    
    ApiResponse::ok(pending)
}

#[derive(Deserialize)]
struct EmissionSubmittedInput {
    tx_hash: String,
}

async fn mark_emission_submitted(
    State(_state): State<SharedState>,
    Path(_id): Path<Uuid>,
    Json(_input): Json<EmissionSubmittedInput>,
) -> impl IntoResponse {
    // In production, update the emission record with tx_hash
    ApiResponse::ok("Marked as submitted")
}
