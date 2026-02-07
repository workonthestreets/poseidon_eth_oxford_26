//! Maritime Shield RFQ Prediction Market Server
//!
//! Hybrid prediction market system:
//! - Off-chain: RFQ auction matching (this server)
//! - On-chain: Collateral custody & settlement (Flare)

mod types;
mod engine;
mod api;

use api::{AppState, SharedState, create_router, init_demo_markets};
use std::sync::Arc;
use tokio::net::TcpListener;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| "maritime_rfq=info,tower_http=debug".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    dotenvy::dotenv().ok();

    let state: SharedState = Arc::new(AppState::new());
    init_demo_markets(&state);

    // Cleanup task
    let cleanup_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(60));
        loop {
            interval.tick().await;
            cleanup_state.engine.cleanup_expired();
        }
    });

    let app = create_router(state);

    let port = std::env::var("RFQ_PORT")
        .or_else(|_| std::env::var("PORT"))
        .unwrap_or_else(|_| "3001".to_string());
    let addr = format!("0.0.0.0:{}", port);

    let listener = TcpListener::bind(&addr).await.unwrap();

    println!();
    println!("════════════════════════════════════════════════════════════════════════");
    println!("  🚢 Maritime Shield RFQ Prediction Market");
    println!("════════════════════════════════════════════════════════════════════════");
    println!();
    println!("  Server: http://localhost:{}", port);
    println!();
    println!("  ╔══════════════════════════════════════════════════════════════════╗");
    println!("  ║              PREDICTION MARKET MECHANICS                         ║");
    println!("  ╠══════════════════════════════════════════════════════════════════╣");
    println!("  ║  Core Rule: 1 YES + 1 NO = $1 collateral                        ║");
    println!("  ║                                                                  ║");
    println!("  ║  Example:                                                        ║");
    println!("  ║  • Alice: \"I want YES at 60¢\" (hedging detention risk)          ║");
    println!("  ║  • Bob: \"I'll take NO at 40¢\" (speculating vessel passes)       ║");
    println!("  ║  • Match! 60¢ + 40¢ = $1 ✓                                       ║");
    println!("  ║  • Alice gets YES shares, Bob gets NO shares                     ║");
    println!("  ║  • If detained: Alice wins $1/share, Bob loses                   ║");
    println!("  ║  • If passes: Bob wins $1/share, Alice loses                     ║");
    println!("  ╚══════════════════════════════════════════════════════════════════╝");
    println!();
    println!("  📚 API ENDPOINTS:");
    println!();
    println!("  Markets:");
    println!("     GET  /api/markets              - List all markets");
    println!("     POST /api/markets              - Create market");
    println!("     GET  /api/markets/:id          - Get market details");
    println!("     GET  /api/markets/:id/requests - Open requests");
    println!("     GET  /api/markets/:id/vault    - Vault state");
    println!("     POST /api/markets/:id/settle   - Settle market");
    println!();
    println!("  Requests (Buy side):");
    println!("     POST /api/requests             - Create request");
    println!("     GET  /api/requests/:id         - Get request + bids");
    println!("     POST /api/requests/:id/cancel  - Cancel request");
    println!("     POST /api/requests/:id/bids    - Submit bid");
    println!();
    println!("  Bids:");
    println!("     GET  /api/bids/:id             - Get bid");
    println!("     POST /api/bids/:id/accept      - Accept (emit shares)");
    println!("     POST /api/bids/:id/deny        - Deny (refund bidder)");
    println!("     POST /api/bids/:id/cancel      - Cancel (refund self)");
    println!();
    println!("  Users:");
    println!("     GET  /api/users/:id            - User summary");
    println!("     POST /api/users/:id/wallet     - Set wallet address");
    println!("     POST /api/users/:id/deposit    - Add demo funds");
    println!();
    println!("  On-Chain:");
    println!("     GET  /api/emissions/pending    - Emissions to submit");
    println!("     POST /api/emissions/:id/submitted - Mark as on-chain");
    println!();
    println!("════════════════════════════════════════════════════════════════════════");
    println!();

    axum::serve(listener, app).await.unwrap();
}
