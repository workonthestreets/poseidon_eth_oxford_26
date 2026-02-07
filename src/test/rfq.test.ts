import { quoteEngine } from '../rfq/QuoteEngine.js';
import { positionManager } from '../rfq/PositionManager.js';

async function runTests() {
  console.log('\n🧪 RFQ System Tests\n');
  console.log('='.repeat(50));

  // Test 1: Create Market
  console.log('\n1. Creating market...');
  const market = quoteEngine.createMarket({
    vesselName: 'Test Vessel',
    vesselIMO: '1234567',
    description: 'Will Test Vessel be detained?',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  });
  console.log(`   ✓ Created market: ${market.id}`);
  console.log(`   ✓ Vessel: ${market.vesselName}`);

  // Test 2: Get Market Prices
  console.log('\n2. Getting market prices...');
  const prices = quoteEngine.getMarketPrices(market.id);
  console.log(`   ✓ YES price: ${prices.yesPrice}¢`);
  console.log(`   ✓ NO price: ${prices.noPrice}¢`);

  // Test 3: Request Quote
  console.log('\n3. Requesting quote...');
  const quote = quoteEngine.requestQuote({
    marketId: market.id,
    userId: 'user1',
    side: 'YES',
    direction: 'BUY',
    quantity: 100
  });
  if (quote) {
    console.log(`   ✓ Quote ID: ${quote.id}`);
    console.log(`   ✓ Price per share: ${quote.pricePerShare}¢`);
    console.log(`   ✓ Total cost: $${(quote.totalCost / 100).toFixed(2)}`);
    console.log(`   ✓ Expires in: ${Math.round((quote.expiresAt - Date.now()) / 1000)}s`);
  } else {
    console.log('   ✗ Failed to create quote');
    return;
  }

  // Test 4: Check User Balance
  console.log('\n4. Checking user balance...');
  const balanceBefore = positionManager.getBalance('user1');
  console.log(`   ✓ Balance before: $${(balanceBefore / 100).toFixed(2)}`);

  // Test 5: Accept Quote
  console.log('\n5. Accepting quote...');
  const acceptResult = quoteEngine.acceptQuote(quote.id, 'user1');
  if (acceptResult.success && acceptResult.trade) {
    console.log(`   ✓ Trade executed: ${acceptResult.trade.id}`);
    
    // Execute in position manager
    const posResult = positionManager.executeTrade(acceptResult.trade);
    if (posResult.success) {
      console.log(`   ✓ Position updated`);
    } else {
      console.log(`   ✗ Position update failed: ${posResult.error}`);
    }
  } else {
    console.log(`   ✗ Accept failed: ${acceptResult.error}`);
  }

  // Test 6: Check Position
  console.log('\n6. Checking position...');
  const position = positionManager.getPosition('user1', market.id);
  if (position) {
    console.log(`   ✓ YES shares: ${position.yesShares}`);
    console.log(`   ✓ NO shares: ${position.noShares}`);
  }

  // Test 7: Check Balance After
  console.log('\n7. Checking balance after...');
  const balanceAfter = positionManager.getBalance('user1');
  console.log(`   ✓ Balance after: $${(balanceAfter / 100).toFixed(2)}`);
  console.log(`   ✓ Spent: $${((balanceBefore - balanceAfter) / 100).toFixed(2)}`);

  // Test 8: Request and Reject Quote
  console.log('\n8. Testing quote rejection...');
  const quote2 = quoteEngine.requestQuote({
    marketId: market.id,
    userId: 'user1',
    side: 'NO',
    direction: 'BUY',
    quantity: 50
  });
  if (quote2) {
    const rejected = quoteEngine.rejectQuote(quote2.id, 'user1');
    console.log(`   ✓ Quote rejected: ${rejected}`);
    const rejectedQuote = quoteEngine.getQuote(quote2.id);
    console.log(`   ✓ Quote status: ${rejectedQuote?.status}`);
  }

  // Test 9: Market Settlement
  console.log('\n9. Settling market (YES wins)...');
  const settled = quoteEngine.settleMarket(market.id, true);
  if (settled) {
    console.log(`   ✓ Market settled: ${settled.status}`);
    console.log(`   ✓ Outcome: ${settled.outcome ? 'YES' : 'NO'} wins`);
  }

  // Test 10: Position Settlement
  console.log('\n10. Settling positions...');
  const payouts = positionManager.settleMarket(market.id, true);
  for (const [userId, payout] of payouts) {
    console.log(`   ✓ ${userId} payout: $${(payout / 100).toFixed(2)}`);
  }

  // Test 11: Final Balance
  console.log('\n11. Final balance...');
  const finalBalance = positionManager.getBalance('user1');
  console.log(`   ✓ Final balance: $${(finalBalance / 100).toFixed(2)}`);
  const profit = finalBalance - 100000; // Initial was $1000
  console.log(`   ✓ Profit/Loss: ${profit >= 0 ? '+' : ''}$${(profit / 100).toFixed(2)}`);

  // Test 12: User Summary
  console.log('\n12. User summary...');
  const summary = positionManager.getUserSummary('user1');
  console.log(`   ✓ Balance: $${(summary.balanceUSD / 100).toFixed(2)}`);
  console.log(`   ✓ Open positions: ${summary.positions.length}`);

  console.log('\n' + '='.repeat(50));
  console.log('✅ All tests completed!\n');

  // Cleanup
  quoteEngine.shutdown();
}

runTests().catch(console.error);
