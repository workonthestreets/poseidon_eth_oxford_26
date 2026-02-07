//! Benchmarks for the matching engine

use criterion::{black_box, criterion_group, criterion_main, Criterion, BenchmarkId};
use maritime_clob::engine::create_engine;
use maritime_clob::types::{Market, Side, OrderType};
use rust_decimal::Decimal;
use chrono::Utc;
use uuid::Uuid;

fn create_test_market() -> Market {
    Market::new(
        "Test Vessel".to_string(),
        "1234567".to_string(),
        "A → B".to_string(),
        Utc::now() + chrono::Duration::days(7),
        24,
        Decimal::from(100000),
    )
}

fn bench_order_submission(c: &mut Criterion) {
    let engine = create_engine();
    let market = create_test_market();
    let market_id = engine.create_market(market);
    
    // Pre-fund users
    for i in 0..1000 {
        engine.deposit(&format!("user{}", i), Decimal::from(1000000));
    }

    c.bench_function("submit_limit_order_no_match", |b| {
        let mut counter = 0u64;
        b.iter(|| {
            counter += 1;
            let _ = engine.submit_order(
                format!("user{}", counter % 1000),
                market_id,
                Side::Yes,
                OrderType::Limit,
                black_box(20 + (counter % 10) as u8),  // Prices 20-29, won't match
                black_box(100),
            );
        });
    });
}

fn bench_order_matching(c: &mut Criterion) {
    let engine = create_engine();
    let market = create_test_market();
    let market_id = engine.create_market(market);
    
    // Pre-fund users
    for i in 0..2000 {
        engine.deposit(&format!("user{}", i), Decimal::from(1000000));
    }

    // Pre-fill orderbook with YES bids
    for i in 0..100 {
        let _ = engine.submit_order(
            format!("maker{}", i),
            market_id,
            Side::Yes,
            OrderType::Limit,
            40,
            1000,
        );
    }

    c.bench_function("submit_order_with_match", |b| {
        let mut counter = 0u64;
        b.iter(|| {
            counter += 1;
            let _ = engine.submit_order(
                format!("taker{}", counter),
                market_id,
                Side::No,
                OrderType::Limit,
                black_box(60),  // Will match with YES @ 40
                black_box(10),
            );
        });
    });
}

fn bench_orderbook_depth(c: &mut Criterion) {
    let mut group = c.benchmark_group("orderbook_depth");
    
    for depth in [10, 100, 1000, 10000].iter() {
        group.bench_with_input(BenchmarkId::from_parameter(depth), depth, |b, &depth| {
            let engine = create_engine();
            let market = create_test_market();
            let market_id = engine.create_market(market);
            
            // Fund maker
            engine.deposit("maker", Decimal::from(100000000));
            
            // Create orderbook with specified depth
            for i in 0..depth {
                let price = 30 + (i % 20) as u8;
                let _ = engine.submit_order(
                    "maker".to_string(),
                    market_id,
                    Side::Yes,
                    OrderType::Limit,
                    price,
                    100,
                );
            }
            
            // Fund taker
            engine.deposit("taker", Decimal::from(100000000));
            
            b.iter(|| {
                let _ = engine.submit_order(
                    "taker".to_string(),
                    market_id,
                    Side::No,
                    OrderType::Limit,
                    black_box(70),
                    black_box(10),
                );
            });
        });
    }
    
    group.finish();
}

fn bench_cancel_order(c: &mut Criterion) {
    c.bench_function("cancel_order", |b| {
        b.iter_batched(
            || {
                let engine = create_engine();
                let market = create_test_market();
                let market_id = engine.create_market(market);
                engine.deposit("user1", Decimal::from(1000));
                
                let result = engine.submit_order(
                    "user1".to_string(),
                    market_id,
                    Side::Yes,
                    OrderType::Limit,
                    35,
                    100,
                ).unwrap();
                
                (engine, market_id, result.order.id)
            },
            |(engine, market_id, order_id)| {
                let _ = engine.cancel_order(market_id, order_id, "user1");
            },
            criterion::BatchSize::SmallInput,
        );
    });
}

criterion_group!(
    benches,
    bench_order_submission,
    bench_order_matching,
    bench_orderbook_depth,
    bench_cancel_order,
);

criterion_main!(benches);
