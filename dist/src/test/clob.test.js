"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const OrderBook_1 = require("../clob/OrderBook");
function assert(condition, message) {
    if (!condition) {
        throw new Error(`FAIL: ${message}`);
    }
    console.log(`PASS: ${message}`);
}
function runTests() {
    console.log('\n=== CLOB Engine Tests ===\n');
    // Test 1: Basic order submission
    const engine = new OrderBook_1.CLOBEngine('test-market');
    const result1 = engine.submitOrder({
        marketId: 'test-market',
        userId: 'user1',
        side: 'BUY',
        type: 'LIMIT',
        price: 50,
        quantity: 100
    });
    assert(result1.order.status === 'OPEN', 'Limit buy order should be OPEN when no matching sells');
    assert(result1.trades.length === 0, 'No trades should occur without matching orders');
    // Test 2: Matching orders
    const result2 = engine.submitOrder({
        marketId: 'test-market',
        userId: 'user2',
        side: 'SELL',
        type: 'LIMIT',
        price: 50,
        quantity: 100
    });
    assert(result2.order.status === 'FILLED', 'Sell order should be FILLED when matching buy exists');
    assert(result2.trades.length === 1, 'One trade should occur');
    assert(result2.trades[0].price === 50, 'Trade price should be 50');
    assert(result2.trades[0].quantity === 100, 'Trade quantity should be 100');
    // Test 3: Partial fills
    const engine2 = new OrderBook_1.CLOBEngine('test-market-2');
    engine2.submitOrder({
        marketId: 'test-market-2',
        userId: 'user1',
        side: 'BUY',
        type: 'LIMIT',
        price: 60,
        quantity: 200
    });
    const result3 = engine2.submitOrder({
        marketId: 'test-market-2',
        userId: 'user2',
        side: 'SELL',
        type: 'LIMIT',
        price: 55,
        quantity: 100
    });
    assert(result3.order.status === 'FILLED', 'Sell at 55 should fill against buy at 60');
    assert(result3.trades[0].price === 60, 'Trade executes at resting order price (price-time priority)');
    // Test 4: Order book state
    const ob = engine2.getOrderBook();
    assert(ob.bids.length === 1, 'Should have one bid level remaining');
    assert(ob.bids[0].quantity === 100, 'Remaining bid quantity should be 100');
    // Test 5: Price-time priority
    const engine3 = new OrderBook_1.CLOBEngine('test-market-3');
    engine3.submitOrder({ marketId: 'test-market-3', userId: 'user1', side: 'BUY', type: 'LIMIT', price: 50, quantity: 100 });
    engine3.submitOrder({ marketId: 'test-market-3', userId: 'user2', side: 'BUY', type: 'LIMIT', price: 50, quantity: 100 });
    const result5 = engine3.submitOrder({
        marketId: 'test-market-3',
        userId: 'user3',
        side: 'SELL',
        type: 'LIMIT',
        price: 50,
        quantity: 100
    });
    assert(result5.trades[0].buyUserId === 'user1', 'First order at price level should be filled first (FIFO)');
    // Test 6: Market orders
    const engine4 = new OrderBook_1.CLOBEngine('test-market-4');
    engine4.submitOrder({ marketId: 'test-market-4', userId: 'mm', side: 'SELL', type: 'LIMIT', price: 55, quantity: 100 });
    engine4.submitOrder({ marketId: 'test-market-4', userId: 'mm', side: 'SELL', type: 'LIMIT', price: 60, quantity: 100 });
    const result6 = engine4.submitOrder({
        marketId: 'test-market-4',
        userId: 'taker',
        side: 'BUY',
        type: 'MARKET',
        quantity: 150
    });
    assert(result6.trades.length === 2, 'Market order should sweep multiple price levels');
    assert(result6.trades[0].price === 55, 'First fill at best price');
    assert(result6.trades[1].price === 60, 'Second fill at next best price');
    assert(result6.order.filledQuantity === 150, 'Total filled should be 150');
    // Test 7: Cancel order
    const engine5 = new OrderBook_1.CLOBEngine('test-market-5');
    const order = engine5.submitOrder({
        marketId: 'test-market-5',
        userId: 'user1',
        side: 'BUY',
        type: 'LIMIT',
        price: 45,
        quantity: 100
    });
    const cancelled = engine5.cancelOrder(order.order.id, 'user1');
    assert(cancelled !== null, 'Order should be cancellable');
    assert(cancelled.status === 'CANCELLED', 'Order status should be CANCELLED');
    const ob5 = engine5.getOrderBook();
    assert(ob5.bids.length === 0, 'Order book should be empty after cancel');
    console.log('\n=== All Tests Passed! ===\n');
}
runTests();
