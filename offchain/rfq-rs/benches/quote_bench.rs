//! Benchmark for RFQ quote operations

use criterion::{criterion_group, criterion_main, Criterion, Throughput};
use maritime_rfq::{RfqEngine, Market, QuoteRequest, ShareSide, Direction};
use chrono::{Duration, Utc};
use uuid::Uuid;

fn create_test_market(engine: &RfqEngine) -> Uuid {
    let market = Market::new(
        "Benchmark Vessel".to_string(),
        "1234567".to_string(),
        "Benchmark market".to_string(),
        Utc::now() + Duration::days(7),
    );
    engine.create_market(market)
}

fn bench_quote_request(c: &mut Criterion) {
    let engine = RfqEngine::new();
    let market_id = create_test_market(&engine);

    let mut group = c.benchmark_group("quote_request");
    group.throughput(Throughput::Elements(1));

    group.bench_function("request_quote", |b| {
        let mut user_id = 0u64;
        b.iter(|| {
            user_id += 1;
            engine.request_quote(QuoteRequest {
                market_id,
                user_id: format!("user_{}", user_id),
                side: ShareSide::Yes,
                direction: Direction::Buy,
                quantity: 100,
            })
        })
    });

    group.finish();
}

fn bench_quote_accept(c: &mut Criterion) {
    let engine = RfqEngine::new();
    let market_id = create_test_market(&engine);

    let mut group = c.benchmark_group("quote_accept");
    group.throughput(Throughput::Elements(1));

    group.bench_function("accept_quote", |b| {
        b.iter_batched(
            || {
                // Setup: create a quote
                let quote = engine.request_quote(QuoteRequest {
                    market_id,
                    user_id: format!("user_{}", rand::random::<u64>()),
                    side: ShareSide::Yes,
                    direction: Direction::Buy,
                    quantity: 100,
                }).unwrap();
                (quote.id, quote.user_id)
            },
            |(quote_id, user_id)| {
                // Benchmark: accept the quote
                let _ = engine.accept_quote(quote_id, &user_id);
            },
            criterion::BatchSize::SmallInput,
        )
    });

    group.finish();
}

fn bench_full_flow(c: &mut Criterion) {
    let engine = RfqEngine::new();
    let market_id = create_test_market(&engine);

    let mut group = c.benchmark_group("full_flow");
    group.throughput(Throughput::Elements(1));

    group.bench_function("request_and_accept", |b| {
        let mut user_id = 0u64;
        b.iter(|| {
            user_id += 1;
            let user = format!("user_{}", user_id);
            
            // Request quote
            let quote = engine.request_quote(QuoteRequest {
                market_id,
                user_id: user.clone(),
                side: ShareSide::Yes,
                direction: Direction::Buy,
                quantity: 100,
            }).unwrap();
            
            // Accept quote
            engine.accept_quote(quote.id, &user).unwrap()
        })
    });

    group.finish();
}

fn bench_market_prices(c: &mut Criterion) {
    let engine = RfqEngine::new();
    let market_id = create_test_market(&engine);

    c.bench_function("get_market_prices", |b| {
        b.iter(|| {
            engine.get_market_prices(market_id)
        })
    });
}

criterion_group!(
    benches,
    bench_quote_request,
    bench_quote_accept,
    bench_full_flow,
    bench_market_prices,
);
criterion_main!(benches);
