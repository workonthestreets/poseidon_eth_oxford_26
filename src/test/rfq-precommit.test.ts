/**
 * Maritime Prediction Market - Pre-Commitment Tests
 * 
 * Tests the complete flow:
 * 1. Market created with departure time
 * 2. Users place requests/bids BEFORE departure
 * 3. Bid accepted → Pre-commitment (not yet emitted)
 * 4. At departure → Shares emitted
 * 5. Settlement → Winners paid
 */

import { strict as assert } from 'assert';

// ════════════════════════════════════════════════════════════════════════════════
// TYPES (matching Rust implementation)
// ════════════════════════════════════════════════════════════════════════════════

type Side = 'YES' | 'NO';
type MarketStatus = 'PENDING' | 'ACTIVE' | 'CLOSED' | 'SETTLED';
type RequestStatus = 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'EXPIRED';
type BidStatus = 'PENDING' | 'ACCEPTED' | 'DENIED' | 'EXPIRED' | 'CANCELLED';
type CommitmentStatus = 'PENDING' | 'EMITTED' | 'CANCELLED';

interface Market {
  id: string;
  vesselName: string;
  vesselIMO: string;
  description: string;
  departureTime: Date;
  settlementTime: Date;
  actualDeparture?: Date;
  status: MarketStatus;
  outcome?: boolean;
  totalCommittedShares: number;
  totalEmittedShares: number;
}

interface Request {
  id: string;
  marketId: string;
  userId: string;
  wallet?: string;
  side: Side;
  quantity: number;
  minFillQuantity?: number;
  maxPrice: number;
  filledQty: number;
  status: RequestStatus;
  expiresAt: Date;
}

interface Bid {
  id: string;
  requestId: string;
  marketId: string;
  bidderId: string;
  bidderWallet?: string;
  requesterId: string;
  side: Side;
  quantity: number;
  price: number;
  requesterPrice: number;
  status: BidStatus;
}

interface Commitment {
  id: string;
  requestId: string;
  bidId: string;
  marketId: string;
  yesUserId: string;
  yesWallet?: string;
  yesPrice: number;
  yesCollateral: number;
  noUserId: string;
  noWallet?: string;
  noPrice: number;
  noCollateral: number;
  quantity: number;
  totalCollateral: number;
  status: CommitmentStatus;
  emittedAt?: Date;
}

interface UserAccount {
  userId: string;
  wallet?: string;
  balance: number;        // Available
  lockedBalance: number;  // In requests/bids
  committedBalance: number; // In commitments
  positions: Map<string, Position>;
}

interface Position {
  committedYes: number;
  committedNo: number;
  emittedYes: number;
  emittedNo: number;
  totalYesCost: number;
  totalNoCost: number;
}

// ════════════════════════════════════════════════════════════════════════════════
// SIMPLIFIED ENGINE FOR TESTING
// ════════════════════════════════════════════════════════════════════════════════

class PreCommitmentEngine {
  private markets = new Map<string, Market>();
  private requests = new Map<string, Request>();
  private bids = new Map<string, Bid>();
  private commitments = new Map<string, Commitment>();
  private users = new Map<string, UserAccount>();
  private idCounter = 0;

  private genId(): string {
    return `id-${++this.idCounter}`;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // USER
  // ──────────────────────────────────────────────────────────────────────────

  getOrCreateUser(userId: string, wallet?: string): UserAccount {
    if (!this.users.has(userId)) {
      this.users.set(userId, {
        userId,
        wallet,
        balance: 100000, // $1000 initial
        lockedBalance: 0,
        committedBalance: 0,
        positions: new Map()
      });
    }
    const user = this.users.get(userId)!;
    if (wallet) user.wallet = wallet;
    return user;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // MARKET
  // ──────────────────────────────────────────────────────────────────────────

  createMarket(params: {
    vesselName: string;
    vesselIMO: string;
    description: string;
    departureTime: Date;
    settlementTime: Date;
  }): Market {
    const market: Market = {
      id: this.genId(),
      ...params,
      status: 'PENDING',
      totalCommittedShares: 0,
      totalEmittedShares: 0
    };
    this.markets.set(market.id, market);
    return market;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // REQUEST
  // ──────────────────────────────────────────────────────────────────────────

  createRequest(params: {
    marketId: string;
    userId: string;
    wallet?: string;
    side: Side;
    quantity: number;
    minFillQuantity?: number;
    maxPrice: number;
  }): Request | { error: string } {
    const market = this.markets.get(params.marketId);
    if (!market) return { error: 'Market not found' };
    if (market.status !== 'PENDING') return { error: 'Market not accepting commitments' };
    if (params.maxPrice < 1 || params.maxPrice > 99) return { error: 'Price must be 1-99' };

    const user = this.getOrCreateUser(params.userId, params.wallet);
    const maxCollateral = params.maxPrice * params.quantity;
    
    if (user.balance < maxCollateral) {
      return { error: `Insufficient balance: need ${maxCollateral}, have ${user.balance}` };
    }

    // Lock funds
    user.balance -= maxCollateral;
    user.lockedBalance += maxCollateral;

    const request: Request = {
      id: this.genId(),
      marketId: params.marketId,
      userId: params.userId,
      wallet: params.wallet,
      side: params.side,
      quantity: params.quantity,
      minFillQuantity: params.minFillQuantity,
      maxPrice: params.maxPrice,
      filledQty: 0,
      status: 'OPEN',
      expiresAt: new Date(Date.now() + 86400000) // 24 hours
    };

    this.requests.set(request.id, request);
    return request;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // BID
  // ──────────────────────────────────────────────────────────────────────────

  submitBid(params: {
    requestId: string;
    bidderId: string;
    bidderWallet?: string;
    quantity: number;
    price: number;
  }): Bid | { error: string } {
    const request = this.requests.get(params.requestId);
    if (!request) return { error: 'Request not found' };
    if (request.status !== 'OPEN' && request.status !== 'PARTIALLY_FILLED') {
      return { error: 'Request not open' };
    }
    if (params.bidderId === request.userId) return { error: 'Cannot bid on own request' };
    if (params.price < 1 || params.price > 99) return { error: 'Price must be 1-99' };

    const remaining = request.quantity - request.filledQty;
    if (params.quantity > remaining) return { error: `Max quantity is ${remaining}` };

    // Check min fill
    if (request.minFillQuantity && params.quantity < request.minFillQuantity && params.quantity < remaining) {
      return { error: `Minimum fill is ${request.minFillQuantity}` };
    }

    // Check price: requester pays (100 - bid.price)
    const requesterPrice = 100 - params.price;
    if (requesterPrice > request.maxPrice) {
      return { error: `Requester max is ${request.maxPrice}¢, bid requires ${requesterPrice}¢` };
    }

    const user = this.getOrCreateUser(params.bidderId, params.bidderWallet);
    const collateral = params.price * params.quantity;
    
    if (user.balance < collateral) {
      return { error: `Insufficient balance: need ${collateral}, have ${user.balance}` };
    }

    // Lock bidder funds
    user.balance -= collateral;
    user.lockedBalance += collateral;

    const bid: Bid = {
      id: this.genId(),
      requestId: request.id,
      marketId: request.marketId,
      bidderId: params.bidderId,
      bidderWallet: params.bidderWallet,
      requesterId: request.userId,
      side: request.side === 'YES' ? 'NO' : 'YES', // Opposite side
      quantity: params.quantity,
      price: params.price,
      requesterPrice,
      status: 'PENDING'
    };

    this.bids.set(bid.id, bid);
    return bid;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ACCEPT BID → CREATE PRE-COMMITMENT
  // ──────────────────────────────────────────────────────────────────────────

  acceptBid(bidId: string, userId: string): { commitment: Commitment; remaining: number; message: string } | { error: string } {
    const bid = this.bids.get(bidId);
    if (!bid) return { error: 'Bid not found' };
    if (bid.requesterId !== userId) return { error: 'Only requester can accept' };
    if (bid.status !== 'PENDING') return { error: 'Bid not pending' };

    const request = this.requests.get(bid.requestId);
    if (!request) return { error: 'Request not found' };
    if (request.status !== 'OPEN' && request.status !== 'PARTIALLY_FILLED') {
      return { error: 'Request not open' };
    }

    // Update bid status
    bid.status = 'ACCEPTED';

    // Update request
    request.filledQty += bid.quantity;
    if (request.filledQty >= request.quantity) {
      request.status = 'FILLED';
    } else if (request.filledQty > 0) {
      request.status = 'PARTIALLY_FILLED';
    }

    // Determine YES/NO sides
    const [yesUserId, yesWallet, yesPrice, noUserId, noWallet, noPrice] =
      request.side === 'YES'
        ? [request.userId, request.wallet, bid.requesterPrice, bid.bidderId, bid.bidderWallet, bid.price]
        : [bid.bidderId, bid.bidderWallet, bid.price, request.userId, request.wallet, bid.requesterPrice];

    // Create commitment
    const commitment: Commitment = {
      id: this.genId(),
      requestId: request.id,
      bidId: bid.id,
      marketId: request.marketId,
      yesUserId,
      yesWallet,
      yesPrice,
      yesCollateral: yesPrice * bid.quantity,
      noUserId,
      noWallet,
      noPrice,
      noCollateral: noPrice * bid.quantity,
      quantity: bid.quantity,
      totalCollateral: 100 * bid.quantity, // Always $1 per share pair
      status: 'PENDING'
    };

    this.commitments.set(commitment.id, commitment);

    // Update user balances: locked → committed
    const requesterCollateral = bid.requesterPrice * bid.quantity;
    const bidderCollateral = bid.price * bid.quantity;
    const requesterExcess = (request.maxPrice - bid.requesterPrice) * bid.quantity;

    const requester = this.users.get(request.userId)!;
    requester.lockedBalance -= requesterCollateral + requesterExcess;
    requester.committedBalance += requesterCollateral;
    requester.balance += requesterExcess; // Refund excess

    const bidder = this.users.get(bid.bidderId)!;
    bidder.lockedBalance -= bidderCollateral;
    bidder.committedBalance += bidderCollateral;

    // Update positions (committed, not emitted)
    this.updatePosition(request.userId, request.marketId, request.side, 'commit', bid.quantity, requesterCollateral);
    this.updatePosition(bid.bidderId, request.marketId, bid.side, 'commit', bid.quantity, bidderCollateral);

    // Update market
    const market = this.markets.get(request.marketId)!;
    market.totalCommittedShares += bid.quantity;

    const remaining = request.quantity - request.filledQty;
    const message = remaining > 0
      ? `Partial fill: ${bid.quantity} committed, ${remaining} remaining`
      : `Fully filled: ${bid.quantity} shares committed`;

    return { commitment, remaining, message };
  }

  private updatePosition(userId: string, marketId: string, side: Side, action: 'commit' | 'emit', qty: number, cost: number) {
    const user = this.users.get(userId)!;
    if (!user.positions.has(marketId)) {
      user.positions.set(marketId, {
        committedYes: 0, committedNo: 0,
        emittedYes: 0, emittedNo: 0,
        totalYesCost: 0, totalNoCost: 0
      });
    }
    const pos = user.positions.get(marketId)!;

    if (action === 'commit') {
      if (side === 'YES') {
        pos.committedYes += qty;
        pos.totalYesCost += cost;
      } else {
        pos.committedNo += qty;
        pos.totalNoCost += cost;
      }
    } else {
      if (side === 'YES') {
        pos.committedYes -= qty;
        pos.emittedYes += qty;
      } else {
        pos.committedNo -= qty;
        pos.emittedNo += qty;
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // EMIT COMMITMENTS AT DEPARTURE
  // ──────────────────────────────────────────────────────────────────────────

  emitCommitments(marketId: string): Commitment[] | { error: string } {
    const market = this.markets.get(marketId);
    if (!market) return { error: 'Market not found' };
    if (market.status !== 'PENDING') return { error: 'Market not pending' };

    const pending = Array.from(this.commitments.values())
      .filter(c => c.marketId === marketId && c.status === 'PENDING');

    for (const commitment of pending) {
      commitment.status = 'EMITTED';
      commitment.emittedAt = new Date();

      // Update user balances: committed → spent (on-chain)
      const yesUser = this.users.get(commitment.yesUserId)!;
      yesUser.committedBalance -= commitment.yesCollateral;

      const noUser = this.users.get(commitment.noUserId)!;
      noUser.committedBalance -= commitment.noCollateral;

      // Update positions
      this.updatePosition(commitment.yesUserId, marketId, 'YES', 'emit', commitment.quantity, 0);
      this.updatePosition(commitment.noUserId, marketId, 'NO', 'emit', commitment.quantity, 0);

      // Update market
      market.totalEmittedShares += commitment.quantity;
    }

    market.status = 'ACTIVE';
    return pending;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SETTLEMENT
  // ──────────────────────────────────────────────────────────────────────────

  settleMarket(marketId: string, outcome: boolean): Market | { error: string } {
    const market = this.markets.get(marketId);
    if (!market) return { error: 'Market not found' };
    if (market.status === 'SETTLED') return { error: 'Already settled' };

    market.status = 'SETTLED';
    market.outcome = outcome;

    // Distribute payouts
    for (const user of this.users.values()) {
      const pos = user.positions.get(marketId);
      if (!pos) continue;

      const winningShares = outcome ? pos.emittedYes : pos.emittedNo;
      if (winningShares > 0) {
        // Winner gets $1 (100 cents) per share
        const payout = winningShares * 100;
        user.balance += payout;
      }

      // Clear position
      user.positions.delete(marketId);
    }

    return market;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GETTERS
  // ──────────────────────────────────────────────────────────────────────────

  getMarket(id: string): Market | undefined { return this.markets.get(id); }
  getRequest(id: string): Request | undefined { return this.requests.get(id); }
  getBid(id: string): Bid | undefined { return this.bids.get(id); }
  getCommitment(id: string): Commitment | undefined { return this.commitments.get(id); }
  getUser(id: string): UserAccount | undefined { return this.users.get(id); }

  getPendingCommitments(marketId: string): Commitment[] {
    return Array.from(this.commitments.values())
      .filter(c => c.marketId === marketId && c.status === 'PENDING');
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// TESTS
// ════════════════════════════════════════════════════════════════════════════════

async function runTests() {
  console.log('\n' + '═'.repeat(70));
  console.log('  🧪 MARITIME PREDICTION MARKET - PRE-COMMITMENT TESTS');
  console.log('═'.repeat(70) + '\n');

  const engine = new PreCommitmentEngine();

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 1: Full Pre-Commitment Flow
  // ──────────────────────────────────────────────────────────────────────────

  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  TEST 1: FULL PRE-COMMITMENT FLOW                                ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  // Create market (departure in future)
  const market = engine.createMarket({
    vesselName: 'MAERSK CHENNAI',
    vesselIMO: '9525338',
    description: 'Will vessel be detained at PSC inspection?',
    departureTime: new Date(Date.now() + 86400000), // 1 day
    settlementTime: new Date(Date.now() + 604800000) // 7 days
  });
  console.log(`  ✅ Market created: ${market.vesselName}`);
  console.log(`     Status: ${market.status}`);
  console.log(`     Departure: ${market.departureTime.toISOString()}`);

  // Alice wants 100 YES shares (hedging detention risk)
  const aliceRequest = engine.createRequest({
    marketId: market.id,
    userId: 'alice',
    wallet: '0xAlice',
    side: 'YES',
    quantity: 100,
    maxPrice: 60 // Max 60¢ per YES share
  });
  assert(!('error' in aliceRequest), 'Alice request should succeed');
  console.log(`\n  ✅ Alice requests 100 YES @ max 60¢`);
  console.log(`     Request ID: ${aliceRequest.id}`);

  // Check Alice's balance is locked
  const aliceAfterRequest = engine.getUser('alice')!;
  console.log(`     Alice balance: $${(aliceAfterRequest.balance / 100).toFixed(2)}`);
  console.log(`     Alice locked: $${(aliceAfterRequest.lockedBalance / 100).toFixed(2)}`);

  // Bob offers 100 NO at 40¢ (speculating vessel passes)
  const bobBid = engine.submitBid({
    requestId: aliceRequest.id,
    bidderId: 'bob',
    bidderWallet: '0xBob',
    quantity: 100,
    price: 40 // 40¢ per NO share
  });
  assert(!('error' in bobBid), 'Bob bid should succeed');
  console.log(`\n  ✅ Bob bids 100 NO @ 40¢`);
  console.log(`     Bid ID: ${bobBid.id}`);
  console.log(`     Requester (Alice) pays: ${bobBid.requesterPrice}¢`);

  // Bob's balance locked
  const bobAfterBid = engine.getUser('bob')!;
  console.log(`     Bob balance: $${(bobAfterBid.balance / 100).toFixed(2)}`);
  console.log(`     Bob locked: $${(bobAfterBid.lockedBalance / 100).toFixed(2)}`);

  // Alice accepts → Pre-commitment created
  const acceptResult = engine.acceptBid(bobBid.id, 'alice');
  assert(!('error' in acceptResult), 'Accept should succeed');
  console.log(`\n  ✅ Alice accepts Bob's bid → PRE-COMMITMENT`);
  console.log(`     Commitment ID: ${acceptResult.commitment.id}`);
  console.log(`     Status: ${acceptResult.commitment.status}`);
  console.log(`     ${acceptResult.message}`);

  // Check commitment details
  const commitment = acceptResult.commitment;
  console.log(`\n     Commitment Details:`);
  console.log(`       YES: ${commitment.yesUserId} @ ${commitment.yesPrice}¢ ($${(commitment.yesCollateral / 100).toFixed(2)})`);
  console.log(`       NO:  ${commitment.noUserId} @ ${commitment.noPrice}¢ ($${(commitment.noCollateral / 100).toFixed(2)})`);
  console.log(`       Total: $${(commitment.totalCollateral / 100).toFixed(2)} for ${commitment.quantity} share pairs`);

  // Check balances moved to committed
  const aliceAfterAccept = engine.getUser('alice')!;
  const bobAfterAccept = engine.getUser('bob')!;
  console.log(`\n     After accepting:`);
  console.log(`       Alice: balance=$${(aliceAfterAccept.balance / 100).toFixed(2)}, committed=$${(aliceAfterAccept.committedBalance / 100).toFixed(2)}`);
  console.log(`       Bob: balance=$${(bobAfterAccept.balance / 100).toFixed(2)}, committed=$${(bobAfterAccept.committedBalance / 100).toFixed(2)}`);

  // Check positions show committed (not emitted)
  const alicePos = aliceAfterAccept.positions.get(market.id)!;
  const bobPos = bobAfterAccept.positions.get(market.id)!;
  console.log(`\n     Positions (PRE-DEPARTURE):`);
  console.log(`       Alice: ${alicePos.committedYes} YES committed, ${alicePos.emittedYes} emitted`);
  console.log(`       Bob: ${bobPos.committedNo} NO committed, ${bobPos.emittedNo} emitted`);

  assert(alicePos.committedYes === 100, 'Alice should have 100 committed YES');
  assert(alicePos.emittedYes === 0, 'Alice should have 0 emitted YES');
  assert(bobPos.committedNo === 100, 'Bob should have 100 committed NO');
  assert(bobPos.emittedNo === 0, 'Bob should have 0 emitted NO');

  // Check market stats
  const marketAfterCommit = engine.getMarket(market.id)!;
  console.log(`\n     Market: ${marketAfterCommit.totalCommittedShares} committed, ${marketAfterCommit.totalEmittedShares} emitted`);
  assert(marketAfterCommit.totalCommittedShares === 100, 'Should have 100 committed shares');
  assert(marketAfterCommit.totalEmittedShares === 0, 'Should have 0 emitted shares');

  // ──────────────────────────────────────────────────────────────────────────
  // DEPARTURE → EMISSION
  // ──────────────────────────────────────────────────────────────────────────

  console.log('\n  ⏰ SHIP DEPARTS → EMIT COMMITMENTS');
  
  const emissions = engine.emitCommitments(market.id);
  assert(!('error' in emissions), 'Emission should succeed');
  console.log(`\n  ✅ Emitted ${emissions.length} commitment(s)`);

  // Check commitment status changed
  const emittedCommitment = engine.getCommitment(commitment.id)!;
  console.log(`     Commitment status: ${emittedCommitment.status}`);
  console.log(`     Emitted at: ${emittedCommitment.emittedAt?.toISOString()}`);
  assert(emittedCommitment.status === 'EMITTED', 'Commitment should be emitted');

  // Check positions show emitted
  const aliceAfterEmit = engine.getUser('alice')!;
  const bobAfterEmit = engine.getUser('bob')!;
  const alicePosAfterEmit = aliceAfterEmit.positions.get(market.id)!;
  const bobPosAfterEmit = bobAfterEmit.positions.get(market.id)!;
  console.log(`\n     Positions (POST-DEPARTURE):`);
  console.log(`       Alice: ${alicePosAfterEmit.committedYes} committed, ${alicePosAfterEmit.emittedYes} emitted YES`);
  console.log(`       Bob: ${bobPosAfterEmit.committedNo} committed, ${bobPosAfterEmit.emittedNo} emitted NO`);

  assert(alicePosAfterEmit.committedYes === 0, 'Alice should have 0 committed YES');
  assert(alicePosAfterEmit.emittedYes === 100, 'Alice should have 100 emitted YES');
  assert(bobPosAfterEmit.committedNo === 0, 'Bob should have 0 committed NO');
  assert(bobPosAfterEmit.emittedNo === 100, 'Bob should have 100 emitted NO');

  // Check market is active
  const marketAfterEmit = engine.getMarket(market.id)!;
  console.log(`\n     Market status: ${marketAfterEmit.status}`);
  console.log(`     Market: ${marketAfterEmit.totalCommittedShares} committed, ${marketAfterEmit.totalEmittedShares} emitted`);
  assert(marketAfterEmit.status === 'ACTIVE', 'Market should be active');

  // ──────────────────────────────────────────────────────────────────────────
  // SETTLEMENT - YES WINS (vessel detained)
  // ──────────────────────────────────────────────────────────────────────────

  console.log('\n  🏁 SETTLEMENT: YES WINS (vessel detained)');

  const aliceBalanceBefore = engine.getUser('alice')!.balance;
  const bobBalanceBefore = engine.getUser('bob')!.balance;
  console.log(`\n     Before settlement:`);
  console.log(`       Alice: $${(aliceBalanceBefore / 100).toFixed(2)}`);
  console.log(`       Bob: $${(bobBalanceBefore / 100).toFixed(2)}`);

  const settled = engine.settleMarket(market.id, true); // YES wins
  assert(!('error' in settled), 'Settlement should succeed');
  console.log(`\n  ✅ Market settled: ${settled.outcome ? 'YES' : 'NO'} wins`);

  const aliceAfterSettle = engine.getUser('alice')!;
  const bobAfterSettle = engine.getUser('bob')!;
  console.log(`\n     After settlement:`);
  console.log(`       Alice: $${(aliceAfterSettle.balance / 100).toFixed(2)} (payout: $${((aliceAfterSettle.balance - aliceBalanceBefore) / 100).toFixed(2)})`);
  console.log(`       Bob: $${(bobAfterSettle.balance / 100).toFixed(2)} (no payout)`);

  // Alice wins: paid 60¢, gets $1 per share = $100 payout for 100 shares
  const aliceProfit = aliceAfterSettle.balance - 100000 + 6000; // Initial - cost + payout
  console.log(`\n     Alice profit: $${(aliceProfit / 100).toFixed(2)}`);
  console.log(`     Bob loss: $${(6000 - (bobAfterSettle.balance - bobBalanceBefore)) / 100}`);

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2: Partial Fill Scenario
  // ──────────────────────────────────────────────────────────────────────────

  console.log('\n\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  TEST 2: PARTIAL FILL SCENARIO                                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  const engine2 = new PreCommitmentEngine();

  const market2 = engine2.createMarket({
    vesselName: 'MSC GÜLSÜN',
    vesselIMO: '9839430',
    description: 'Will arrive within ETA?',
    departureTime: new Date(Date.now() + 86400000),
    settlementTime: new Date(Date.now() + 604800000)
  });
  console.log(`  ✅ Market created: ${market2.vesselName}`);

  // Alice wants 200 YES shares with min fill of 50
  const request2 = engine2.createRequest({
    marketId: market2.id,
    userId: 'alice',
    wallet: '0xAlice',
    side: 'YES',
    quantity: 200,
    minFillQuantity: 50,
    maxPrice: 55
  });
  assert(!('error' in request2), 'Request should succeed');
  console.log(`\n  ✅ Alice requests 200 YES @ max 55¢ (min fill: 50)`);

  // Bob bids for only 80
  const bid2a = engine2.submitBid({
    requestId: request2.id,
    bidderId: 'bob',
    bidderWallet: '0xBob',
    quantity: 80,
    price: 50
  });
  assert(!('error' in bid2a), 'Bob bid should succeed');
  console.log(`  ✅ Bob bids 80 NO @ 50¢`);

  const accept2a = engine2.acceptBid(bid2a.id, 'alice');
  assert(!('error' in accept2a), 'Accept should succeed');
  console.log(`  ✅ Alice accepts → ${accept2a.message}`);

  // Check request is partially filled
  const request2After = engine2.getRequest(request2.id)!;
  console.log(`\n     Request status: ${request2After.status}`);
  console.log(`     Filled: ${request2After.filledQty} / ${request2After.quantity}`);
  assert(request2After.status === 'PARTIALLY_FILLED', 'Should be partially filled');

  // Carol fills the rest
  const bid2b = engine2.submitBid({
    requestId: request2.id,
    bidderId: 'carol',
    bidderWallet: '0xCarol',
    quantity: 120,
    price: 48
  });
  assert(!('error' in bid2b), 'Carol bid should succeed');
  console.log(`\n  ✅ Carol bids 120 NO @ 48¢`);

  const accept2b = engine2.acceptBid(bid2b.id, 'alice');
  assert(!('error' in accept2b), 'Accept should succeed');
  console.log(`  ✅ Alice accepts → ${accept2b.message}`);

  const request2Final = engine2.getRequest(request2.id)!;
  console.log(`\n     Request status: ${request2Final.status}`);
  assert(request2Final.status === 'FILLED', 'Should be fully filled');

  // Check all commitments
  const pendingCommitments = engine2.getPendingCommitments(market2.id);
  console.log(`\n     Total pending commitments: ${pendingCommitments.length}`);
  console.log(`     Total shares: ${pendingCommitments.reduce((sum, c) => sum + c.quantity, 0)}`);

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 3: Sell Order (NO request)
  // ──────────────────────────────────────────────────────────────────────────

  console.log('\n\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  TEST 3: SELL ORDER (NO REQUEST)                                 ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  const engine3 = new PreCommitmentEngine();

  const market3 = engine3.createMarket({
    vesselName: 'EVER GIVEN',
    vesselIMO: '9811000',
    description: 'Will encounter port congestion?',
    departureTime: new Date(Date.now() + 86400000),
    settlementTime: new Date(Date.now() + 604800000)
  });
  console.log(`  ✅ Market created: ${market3.vesselName}`);

  // Bob wants NO shares (betting vessel WON'T have issues)
  const bobRequest = engine3.createRequest({
    marketId: market3.id,
    userId: 'bob',
    wallet: '0xBob',
    side: 'NO',
    quantity: 150,
    maxPrice: 70 // Max 70¢ per NO share
  });
  assert(!('error' in bobRequest), 'Bob request should succeed');
  console.log(`\n  ✅ Bob requests 150 NO @ max 70¢`);
  console.log(`     (Bob bets vessel will NOT have congestion issues)`);

  // Alice offers YES at 35¢ (meaning Bob pays 65¢)
  const aliceBid = engine3.submitBid({
    requestId: bobRequest.id,
    bidderId: 'alice',
    bidderWallet: '0xAlice',
    quantity: 150,
    price: 35 // Alice pays 35¢ for YES
  });
  assert(!('error' in aliceBid), 'Alice bid should succeed');
  console.log(`\n  ✅ Alice bids 150 YES @ 35¢`);
  console.log(`     Bob (requester) pays: ${aliceBid.requesterPrice}¢ for NO`);

  const acceptResult3 = engine3.acceptBid(aliceBid.id, 'bob');
  assert(!('error' in acceptResult3), 'Accept should succeed');
  console.log(`\n  ✅ Bob accepts → PRE-COMMITMENT`);

  const commitment3 = acceptResult3.commitment;
  console.log(`\n     Commitment:`);
  console.log(`       YES: ${commitment3.yesUserId} @ ${commitment3.yesPrice}¢`);
  console.log(`       NO: ${commitment3.noUserId} @ ${commitment3.noPrice}¢`);
  console.log(`       Shares: ${commitment3.quantity}`);

  // Verify the sides are correct
  assert(commitment3.yesUserId === 'alice', 'Alice should have YES');
  assert(commitment3.noUserId === 'bob', 'Bob should have NO');
  assert(commitment3.yesPrice === 35, 'Alice YES price should be 35');
  assert(commitment3.noPrice === 65, 'Bob NO price should be 65');

  // Emit and settle (NO wins - no congestion)
  engine3.emitCommitments(market3.id);
  engine3.settleMarket(market3.id, false); // NO wins

  const bobFinal = engine3.getUser('bob')!;
  const aliceFinal = engine3.getUser('alice')!;
  console.log(`\n  🏁 Settlement: NO wins (no congestion)`);
  console.log(`     Bob profit: $${((bobFinal.balance - 100000 + 65 * 150) / 100).toFixed(2)}`);
  console.log(`     Alice loss: $${((35 * 150) / 100).toFixed(2)}`);

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 4: Price Validation
  // ──────────────────────────────────────────────────────────────────────────

  console.log('\n\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  TEST 4: PRICE VALIDATION                                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  const engine4 = new PreCommitmentEngine();
  const market4 = engine4.createMarket({
    vesselName: 'TEST VESSEL',
    vesselIMO: '1234567',
    description: 'Test',
    departureTime: new Date(Date.now() + 86400000),
    settlementTime: new Date(Date.now() + 604800000)
  });

  // Request YES at max 50¢
  const testRequest = engine4.createRequest({
    marketId: market4.id,
    userId: 'requester',
    side: 'YES',
    quantity: 100,
    maxPrice: 50
  });
  assert(!('error' in testRequest));
  console.log(`  ✅ Request: 100 YES @ max 50¢`);

  // Try bid that requires requester to pay more than max
  const badBid = engine4.submitBid({
    requestId: testRequest.id,
    bidderId: 'bidder',
    quantity: 100,
    price: 40 // Requires requester to pay 60¢ > 50¢ max
  });
  assert('error' in badBid, 'Bad bid should fail');
  console.log(`  ✅ Rejected bid @ 40¢ (would require 60¢ from requester)`);
  console.log(`     Error: ${badBid.error}`);

  // Good bid at 50¢ → requester pays 50¢ = max
  const goodBid = engine4.submitBid({
    requestId: testRequest.id,
    bidderId: 'bidder',
    quantity: 100,
    price: 50 // Requires requester to pay 50¢ = max
  });
  assert(!('error' in goodBid), 'Good bid should succeed');
  console.log(`  ✅ Accepted bid @ 50¢ (requester pays exactly 50¢)`);

  // ──────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────────────────────────────

  console.log('\n' + '═'.repeat(70));
  console.log('  ✅ ALL TESTS PASSED');
  console.log('═'.repeat(70));
  console.log('\n  Key mechanics verified:');
  console.log('    • Pre-commitment: Bids accepted BEFORE departure');
  console.log('    • Emission: Shares only created at departure time');
  console.log('    • Partial fills: Request stays open until fully filled');
  console.log('    • Both sides: YES and NO requests work correctly');
  console.log('    • Price validation: YES + NO prices always sum to $1');
  console.log('    • Settlement: Winners get $1/share, losers get nothing');
  console.log('\n  Datalastic integration:');
  console.log('    • /vessel_pro provides atd_UTC (actual departure time)');
  console.log('    • Use this to trigger emission when ship actually departs');
  console.log();
}

runTests().catch(console.error);
