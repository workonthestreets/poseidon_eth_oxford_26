//! REST + WebSocket API (Polymarket-style)

use crate::engine::MatchingEngine;
use crate::types::*;
use axum::{
    extract::{Path, State, WebSocketUpgrade},
    extract::ws::{Message, WebSocket},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post},
    Json, Router,
};
use chrono::Utc;
use futures::{sink::SinkExt, stream::StreamExt};
use parking_lot::RwLock;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use uuid::Uuid;

// ========== State ==========

pub type SharedState = Arc<AppState>;

pub struct AppState {
    pub engine: MatchingEngine,
    pub ws_tx: broadcast::Sender<(Uuid, WsMessage)>,
}

impl AppState {
    pub fn new() -> Self {
        let (ws_tx, _) = broadcast::channel(1024);
        Self {
            engine: MatchingEngine::new(),
            ws_tx,
        }
    }

    pub fn broadcast(&self, market_id: Uuid, msg: WsMessage) {
        let _ = self.ws_tx.send((market_id, msg));
    }
}

// ========== API Types ==========

#[derive(Serialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl<T: Serialize> ApiResponse<T> {
    pub fn ok(data: T) -> Self {
        Self { success: true, data: Some(data), error: None }
    }
    pub fn err(msg: impl ToString) -> Self {
        Self { success: false, data: None, error: Some(msg.to_string()) }
    }
}

#[derive(Deserialize)]
pub struct CreateMarketRequest {
    pub vessel_name: String,
    pub vessel_imo: String,
    pub route: String,
    pub expected_arrival: String,
    pub demurrage_threshold_hours: u32,
    pub max_payout_usd: f64,
}

#[derive(Deserialize)]
pub struct OrderRequest {
    pub market_id: Uuid,
    pub user_id: String,
    pub token_side: TokenSide,    // YES or NO
    pub order_side: OrderSide,    // BUY or SELL
    #[serde(default = "default_limit")]
    pub order_type: OrderType,
    pub price: u8,
    pub quantity: u64,
}

fn default_limit() -> OrderType { OrderType::Limit }

#[derive(Deserialize)]
pub struct CancelOrderRequest {
    pub market_id: Uuid,
    pub user_id: String,
}

#[derive(Deserialize)]
pub struct DepositRequest {
    pub amount: f64,
}

#[derive(Deserialize)]
pub struct SplitMergeRequest {
    pub market_id: Uuid,
    pub amount: u64,
}

#[derive(Deserialize)]
pub struct SettleRequest {
    pub outcome: bool,  // true = YES wins, false = NO wins
}

#[derive(Serialize)]
pub struct OrderResponse {
    pub order: Order,
    pub trades: Vec<Trade>,
    pub collateral_used: f64,
}

#[derive(Serialize)]
pub struct MarketResponse {
    pub market: Market,
    pub orderbook: OrderBookSnapshot,
    pub recent_trades: Vec<Trade>,
}

#[derive(Clone, Serialize)]
pub enum WsMessage {
    OrderBook(OrderBookSnapshot),
    Trade(Trade),
}

// ========== Handlers ==========

async fn list_markets(State(state): State<SharedState>) -> impl IntoResponse {
    let markets = state.engine.list_markets();
    Json(ApiResponse::ok(markets))
}

async fn get_market(
    State(state): State<SharedState>,
    Path(market_id): Path<Uuid>,
) -> impl IntoResponse {
    let market = match state.engine.get_market(market_id) {
        Some(m) => m,
        None => return (StatusCode::NOT_FOUND, Json(ApiResponse::<()>::err("Market not found"))).into_response(),
    };

    let orderbook = state.engine.get_orderbook(market_id).unwrap_or_else(|| {
        OrderBookSnapshot {
            market_id,
            yes: TokenOrderBook {
                token: TokenSide::Yes,
                bids: vec![],
                asks: vec![],
                best_bid: None,
                best_ask: None,
                spread: None,
                last_price: None,
            },
            no: TokenOrderBook {
                token: TokenSide::No,
                bids: vec![],
                asks: vec![],
                best_bid: None,
                best_ask: None,
                spread: None,
                last_price: None,
            },
            timestamp: Utc::now(),
        }
    });

    let recent_trades = state.engine.get_trades(market_id, 20);

    Json(ApiResponse::ok(MarketResponse {
        market,
        orderbook,
        recent_trades,
    })).into_response()
}

async fn create_market(
    State(state): State<SharedState>,
    Json(req): Json<CreateMarketRequest>,
) -> impl IntoResponse {
    let arrival = chrono::DateTime::parse_from_rfc3339(&req.expected_arrival)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now() + chrono::Duration::days(7));

    let market = Market::new(
        req.vessel_name,
        req.vessel_imo,
        req.route,
        arrival,
        req.demurrage_threshold_hours,
        Decimal::from_f64_retain(req.max_payout_usd).unwrap_or_default(),
    );

    let id = state.engine.create_market(market.clone());
    (StatusCode::CREATED, Json(ApiResponse::ok(market)))
}

async fn settle_market(
    State(state): State<SharedState>,
    Path(market_id): Path<Uuid>,
    Json(req): Json<SettleRequest>,
) -> impl IntoResponse {
    match state.engine.settle_market(market_id, req.outcome) {
        Ok(_) => Json(ApiResponse::ok(serde_json::json!({
            "settled": true,
            "outcome": if req.outcome { "YES" } else { "NO" }
        }))).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(ApiResponse::<()>::err(e))).into_response(),
    }
}

async fn submit_order(
    State(state): State<SharedState>,
    Json(req): Json<OrderRequest>,
) -> impl IntoResponse {
    let order = Order::new(
        req.user_id,
        req.market_id,
        req.token_side,
        req.order_side,
        req.order_type,
        req.price,
        req.quantity,
    );

    match state.engine.submit_order(order) {
        Ok((order, trades, collateral)) => {
            // Broadcast orderbook update
            if let Some(ob) = state.engine.get_orderbook(req.market_id) {
                state.broadcast(req.market_id, WsMessage::OrderBook(ob));
            }
            // Broadcast trades
            for trade in &trades {
                state.broadcast(req.market_id, WsMessage::Trade(trade.clone()));
            }

            Json(ApiResponse::ok(OrderResponse {
                order,
                trades,
                collateral_used: collateral.try_into().unwrap_or(0.0),
            })).into_response()
        }
        Err(e) => (StatusCode::BAD_REQUEST, Json(ApiResponse::<()>::err(e))).into_response(),
    }
}

async fn cancel_order(
    State(state): State<SharedState>,
    Path(order_id): Path<Uuid>,
    Json(req): Json<CancelOrderRequest>,
) -> impl IntoResponse {
    match state.engine.cancel_order(req.market_id, order_id, &req.user_id) {
        Ok(order) => {
            if let Some(ob) = state.engine.get_orderbook(req.market_id) {
                state.broadcast(req.market_id, WsMessage::OrderBook(ob));
            }
            Json(ApiResponse::ok(order)).into_response()
        }
        Err(e) => (StatusCode::BAD_REQUEST, Json(ApiResponse::<()>::err(e))).into_response(),
    }
}

async fn get_balance(
    State(state): State<SharedState>,
    Path(user_id): Path<String>,
) -> impl IntoResponse {
    let balance: f64 = state.engine.get_balance(&user_id).try_into().unwrap_or(0.0);
    let available: f64 = state.engine.get_available_balance(&user_id).try_into().unwrap_or(0.0);
    Json(ApiResponse::ok(serde_json::json!({
        "balance": balance,
        "available": available
    })))
}

async fn deposit(
    State(state): State<SharedState>,
    Path(user_id): Path<String>,
    Json(req): Json<DepositRequest>,
) -> impl IntoResponse {
    let new_balance = state.engine.deposit(
        &user_id,
        Decimal::from_f64_retain(req.amount).unwrap_or_default(),
    );
    let balance: f64 = new_balance.try_into().unwrap_or(0.0);
    Json(ApiResponse::ok(serde_json::json!({ "balance": balance })))
}

async fn split_tokens(
    State(state): State<SharedState>,
    Path(user_id): Path<String>,
    Json(req): Json<SplitMergeRequest>,
) -> impl IntoResponse {
    match state.engine.split(&user_id, req.market_id, req.amount) {
        Ok(_) => {
            let position = state.engine.get_position(&user_id, req.market_id);
            Json(ApiResponse::ok(serde_json::json!({
                "success": true,
                "yes_tokens": position.yes_tokens,
                "no_tokens": position.no_tokens
            }))).into_response()
        }
        Err(e) => (StatusCode::BAD_REQUEST, Json(ApiResponse::<()>::err(e))).into_response(),
    }
}

async fn merge_tokens(
    State(state): State<SharedState>,
    Path(user_id): Path<String>,
    Json(req): Json<SplitMergeRequest>,
) -> impl IntoResponse {
    match state.engine.merge(&user_id, req.market_id, req.amount) {
        Ok(_) => {
            let position = state.engine.get_position(&user_id, req.market_id);
            let balance: f64 = state.engine.get_balance(&user_id).try_into().unwrap_or(0.0);
            Json(ApiResponse::ok(serde_json::json!({
                "success": true,
                "yes_tokens": position.yes_tokens,
                "no_tokens": position.no_tokens,
                "balance": balance
            }))).into_response()
        }
        Err(e) => (StatusCode::BAD_REQUEST, Json(ApiResponse::<()>::err(e))).into_response(),
    }
}

async fn get_positions(
    State(state): State<SharedState>,
    Path(user_id): Path<String>,
) -> impl IntoResponse {
    let positions = state.engine.get_all_positions(&user_id);
    Json(ApiResponse::ok(positions))
}

// ========== WebSocket ==========

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<SharedState>,
) -> impl IntoResponse {
    ws.on_upgrade(|socket| handle_ws(socket, state))
}

async fn handle_ws(socket: WebSocket, state: SharedState) {
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.ws_tx.subscribe();
    let subscribed_markets: Arc<RwLock<HashSet<Uuid>>> = Arc::new(RwLock::new(HashSet::new()));
    
    let subscribed_clone = subscribed_markets.clone();
    
    let recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = receiver.next().await {
            if let Message::Text(text) = msg {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                    if parsed.get("type").and_then(|t| t.as_str()) == Some("SUBSCRIBE") {
                        if let Some(market_id) = parsed.get("market_id").and_then(|m| m.as_str()) {
                            if let Ok(uuid) = Uuid::parse_str(market_id) {
                                subscribed_clone.write().insert(uuid);
                            }
                        }
                    }
                }
            }
        }
    });

    let send_task = tokio::spawn(async move {
        while let Ok((market_id, msg)) = rx.recv().await {
            if subscribed_markets.read().contains(&market_id) {
                let json = serde_json::to_string(&msg).unwrap_or_default();
                if sender.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
            }
        }
    });

    tokio::select! {
        _ = recv_task => {},
        _ = send_task => {},
    }
}

// ========== Router ==========

pub fn create_router(state: SharedState) -> Router {
    Router::new()
        // Markets
        .route("/api/markets", get(list_markets).post(create_market))
        .route("/api/markets/:id", get(get_market))
        .route("/api/markets/:id/settle", post(settle_market))
        
        // Orders
        .route("/api/orders", post(submit_order))
        .route("/api/orders/:id", delete(cancel_order))
        
        // Users
        .route("/api/users/:id/balance", get(get_balance))
        .route("/api/users/:id/deposit", post(deposit))
        .route("/api/users/:id/positions", get(get_positions))
        .route("/api/users/:id/split", post(split_tokens))
        .route("/api/users/:id/merge", post(merge_tokens))
        
        // WebSocket
        .route("/ws", get(ws_handler))
        
        .layer(CorsLayer::permissive())
        .with_state(state)
}

// ========== Demo Initialization ==========

pub fn init_demo_markets(state: &SharedState) {
    use chrono::Duration;
    
    let markets = vec![
        ("MSC Oscar", "9703318", "Shanghai → Rotterdam", 7, 24, 150000.0),
        ("Ever Given", "9811000", "Felixstowe → Singapore", 14, 48, 200000.0),
        ("CMA CGM Marco Polo", "9454450", "Los Angeles → Tokyo", 10, 36, 175000.0),
    ];

    for (name, imo, route, days, threshold, payout) in markets {
        let market = Market::new(
            name.to_string(),
            imo.to_string(),
            route.to_string(),
            Utc::now() + Duration::days(days),
            threshold,
            Decimal::from_f64_retain(payout).unwrap_or_default(),
        );
        let market_id = state.engine.create_market(market);
        
        // Seed demo liquidity for this market
        seed_demo_orders(state, market_id);
    }
}

/// Seeds simulated market maker orders so users can immediately trade
fn seed_demo_orders(state: &SharedState, market_id: Uuid) {
    // Create market maker account with lots of funds
    let mm_id = "market-maker-bot";
    let _ = state.engine.deposit(mm_id, Decimal::from(1_000_000));
    
    // Split tokens so MM has inventory to sell
    for _ in 0..100 {
        let _ = state.engine.split(mm_id, market_id, 1000);
    }
    
    // YES Token Orders
    // Asks (sell orders) - people can BUY YES at these prices
    let yes_asks = vec![
        (52, 500),  // 52¢ - 500 shares
        (53, 400),
        (54, 350),
        (55, 300),
        (57, 250),
        (60, 200),
        (65, 150),
        (70, 100),
    ];
    
    // Bids (buy orders) - people can SELL YES at these prices  
    let yes_bids = vec![
        (48, 500),  // 48¢ - 500 shares
        (47, 400),
        (46, 350),
        (45, 300),
        (43, 250),
        (40, 200),
        (35, 150),
        (30, 100),
    ];
    
    // NO Token Orders
    // Asks (sell orders) - people can BUY NO at these prices
    let no_asks = vec![
        (52, 450),
        (53, 380),
        (54, 320),
        (55, 280),
        (58, 220),
        (62, 180),
        (68, 120),
        (75, 80),
    ];
    
    // Bids (buy orders) - people can SELL NO at these prices
    let no_bids = vec![
        (48, 450),
        (47, 380),
        (46, 320),
        (45, 280),
        (42, 220),
        (38, 180),
        (32, 120),
        (25, 80),
    ];
    
    // Submit YES orders
    for (price, qty) in yes_asks {
        let order = Order::new(
            mm_id.to_string(),
            market_id,
            TokenSide::Yes,
            OrderSide::Sell,
            OrderType::Limit,
            price,
            qty,
        );
        let _ = state.engine.submit_order(order);
    }
    
    for (price, qty) in yes_bids {
        let order = Order::new(
            mm_id.to_string(),
            market_id,
            TokenSide::Yes,
            OrderSide::Buy,
            OrderType::Limit,
            price,
            qty,
        );
        let _ = state.engine.submit_order(order);
    }
    
    // Submit NO orders
    for (price, qty) in no_asks {
        let order = Order::new(
            mm_id.to_string(),
            market_id,
            TokenSide::No,
            OrderSide::Sell,
            OrderType::Limit,
            price,
            qty,
        );
        let _ = state.engine.submit_order(order);
    }
    
    for (price, qty) in no_bids {
        let order = Order::new(
            mm_id.to_string(),
            market_id,
            TokenSide::No,
            OrderSide::Buy,
            OrderType::Limit,
            price,
            qty,
        );
        let _ = state.engine.submit_order(order);
    }
    
    tracing::info!("Seeded demo orders for market {}", market_id);
}
