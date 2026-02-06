"use strict";
/**
 * Dual Order Book for Prediction Markets
 *
 * KEY INSIGHT: There's only ONE orderbook, but two ways to view it:
 * - Buying YES at 35¢ = Selling NO at 65¢
 * - Buying NO at 65¢ = Selling YES at 35¢
 *
 * When orders match, the system mints a complete set from combined collateral.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DualOrderBook = void 0;
const uuid_1 = require("uuid");
class DualOrderBook {
    constructor(marketId) {
        this.marketId = marketId;
        // Bids to BUY YES (sorted by price descending - highest first)
        this.yesBids = [];
        // Bids to BUY NO (sorted by price descending - highest first)  
        this.noBids = [];
        this.trades = [];
        this.orders = new Map();
    }
    /**
     * Submit an order to BUY either YES or NO shares
     *
     * The system automatically matches:
     * - YES buyer @ 35¢ matches with NO buyer @ 65¢+ (because 35 + 65 = 100)
     */
    submitOrder(userId, outcome, priceInCents, quantity) {
        if (priceInCents < 1 || priceInCents > 99) {
            throw new Error('Price must be between 1 and 99 cents');
        }
        const order = {
            id: (0, uuid_1.v4)(),
            userId: userId,
            marketId: this.marketId,
            outcome,
            priceInCents,
            quantity,
            filledQuantity: 0,
            status: 'OPEN',
            timestamp: Date.now()
        };
        const matches = this.matchOrder(order);
        // If not fully filled, add to book
        if (order.filledQuantity < order.quantity) {
            this.addToBook(order);
        }
        this.orders.set(order.id, order);
        return { order, matches };
    }
    /**
     * Match incoming order against opposite side
     *
     * YES buyer @ X¢ matches with NO buyer @ (100-X)¢ or higher
     */
    matchOrder(incoming) {
        const matches = [];
        // Get opposite book
        const oppositeBook = incoming.outcome === 'YES' ? this.noBids : this.yesBids;
        // Calculate minimum opposite price needed for match
        // If I buy YES @ 35¢, I need NO buyer @ 65¢+ (35 + 65 >= 100)
        const minOppositePrice = 100 - incoming.priceInCents;
        let remainingQty = incoming.quantity - incoming.filledQuantity;
        let i = 0;
        while (remainingQty > 0 && i < oppositeBook.length) {
            const resting = oppositeBook[i];
            // Check if prices are compatible
            // Match occurs when: incoming.price + resting.price >= 100
            if (resting.priceInCents < minOppositePrice) {
                break; // No more matches possible (book is sorted)
            }
            const fillQty = Math.min(remainingQty, resting.quantity - resting.filledQuantity);
            if (fillQty > 0) {
                // Determine who is YES buyer and who is NO buyer
                const yesBuyer = incoming.outcome === 'YES' ? incoming.userId : resting.userId;
                const noBuyer = incoming.outcome === 'NO' ? incoming.userId : resting.userId;
                const yesPrice = incoming.outcome === 'YES' ? incoming.priceInCents : 100 - resting.priceInCents;
                const noPrice = incoming.outcome === 'NO' ? incoming.priceInCents : resting.priceInCents;
                // Create match
                const match = {
                    trade: {
                        id: (0, uuid_1.v4)(),
                        yesBuyer,
                        noBuyer,
                        yesPrice,
                        noPrice,
                        quantity: fillQty,
                        timestamp: Date.now()
                    },
                    collateralLocked: fillQty // $1 per complete set
                };
                matches.push(match);
                this.trades.push(match);
                // Update quantities
                incoming.filledQuantity += fillQty;
                resting.filledQuantity += fillQty;
                remainingQty -= fillQty;
                // Update resting order status
                if (resting.filledQuantity >= resting.quantity) {
                    resting.status = 'FILLED';
                    oppositeBook.splice(i, 1); // Remove filled order
                }
                else {
                    resting.status = 'PARTIAL';
                    i++;
                }
            }
            else {
                i++;
            }
        }
        // Update incoming order status
        if (incoming.filledQuantity >= incoming.quantity) {
            incoming.status = 'FILLED';
        }
        else if (incoming.filledQuantity > 0) {
            incoming.status = 'PARTIAL';
        }
        return matches;
    }
    addToBook(order) {
        const book = order.outcome === 'YES' ? this.yesBids : this.noBids;
        // Insert in sorted position (descending by price)
        let i = 0;
        while (i < book.length && book[i].priceInCents > order.priceInCents) {
            i++;
        }
        book.splice(i, 0, order);
    }
    /**
     * Get the order book from YES perspective
     * (This is what traders see)
     */
    getOrderBook() {
        // YES bids are direct
        const yesBids = this.aggregateLevels(this.yesBids);
        // YES asks = NO bids converted (NO @ 65¢ = YES ask @ 35¢)
        const yesAsks = this.noBids.map(o => ({
            ...o,
            priceInCents: 100 - o.priceInCents
        }));
        const yesAsksAggregated = this.aggregateLevels(yesAsks).sort((a, b) => a.price - b.price);
        const bestBid = yesBids[0]?.price ?? null;
        const bestAsk = yesAsksAggregated[0]?.price ?? null;
        const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
        const lastTrade = this.trades[this.trades.length - 1];
        const lastYesPrice = lastTrade?.trade.yesPrice ?? null;
        return {
            yesBids,
            yesAsks: yesAsksAggregated,
            lastYesPrice,
            spread
        };
    }
    aggregateLevels(orders) {
        const levels = new Map();
        for (const order of orders) {
            const remaining = order.quantity - order.filledQuantity;
            if (remaining <= 0)
                continue;
            const existing = levels.get(order.priceInCents) || { quantity: 0, orders: 0 };
            existing.quantity += remaining;
            existing.orders += 1;
            levels.set(order.priceInCents, existing);
        }
        return Array.from(levels.entries())
            .map(([price, data]) => ({ price, ...data }))
            .sort((a, b) => b.price - a.price);
    }
    cancelOrder(orderId, userId) {
        const order = this.orders.get(orderId);
        if (!order || order.userId !== userId || order.status === 'FILLED') {
            return null;
        }
        const book = order.outcome === 'YES' ? this.yesBids : this.noBids;
        const idx = book.findIndex(o => o.id === orderId);
        if (idx !== -1) {
            book.splice(idx, 1);
        }
        order.status = 'CANCELLED';
        return order;
    }
    getRecentTrades(limit = 20) {
        return this.trades.slice(-limit).reverse();
    }
}
exports.DualOrderBook = DualOrderBook;
/*
EXAMPLE FLOW:

1. Shipper wants to hedge: "Buy 100 YES @ 35¢"
   → Order added to yesBids, no match yet

2. Speculator disagrees: "Buy 100 NO @ 70¢" (= willing to sell YES @ 30¢)
   → Checks: Can YES@35 match with NO@70? 35 + 70 = 105 >= 100 ✓
   → MATCH!
   → Shipper gets 100 YES, paid 35¢ each = $35
   → Speculator gets 100 NO, paid 70¢ each = $70
   → Total collateral locked: $105 (but only $100 needed!)
   → Excess $5 goes to... whoever's order was "better"
   
Actually, let me reconsider the pricing...

The fair way: Both sides pay their limit price, excess is rebated or
the trade happens at the MIDPOINT of the overlap.

Standard approach: Price-time priority, trade at resting order's price.

If YES bid @ 35 is resting, and NO bid @ 70 comes in:
→ Trade at YES price 35¢ (resting order's price)
→ NO buyer effectively pays 65¢ (100 - 35), gets rebate of 5¢

This is complex - simpler model is AMM or always trade at midpoint.
*/
