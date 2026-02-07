//! Maritime CLOB Server
//! 
//! High-performance Central Limit Order Book for Maritime Demurrage
//! Prediction Markets.
//! 
//! Run with: cargo run --release
//! 
//! API Endpoints:
//! - GET  /api/markets          - List all markets
//! - GET  /api/markets/:id      - Get market + orderbook
//! - POST /api/markets          - Create market
//! - POST /api/orders           - Submit order
//! - DELETE /api/orders/:id     - Cancel order
//! - GET  /api/users/:id/balance - Get balance
//! - POST /api/users/:id/deposit - Deposit funds
//! - WS   /ws                   - Real-time updates

use axum::routing::get_service;
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use maritime_clob::api::{create_router, init_demo_markets, AppState};

#[tokio::main]
async fn main() {
    // Initialize logging with DEBUG level for more details
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "maritime_clob=debug,tower_http=debug".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Create app state
    let state = Arc::new(AppState::new());

    // Initialize demo markets
    init_demo_markets(&state);
    tracing::info!("Demo markets initialized");

    // Build router with static file serving and request logging
    let app = create_router(state)
        .layer(TraceLayer::new_for_http())
        .nest_service("/", get_service(ServeDir::new("../public").append_index_html_on_directories(true)));

    // Start server
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("Maritime CLOB starting on http://{}", addr);
    tracing::info!("UI available at http://localhost:{}/index-rust.html", port);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
