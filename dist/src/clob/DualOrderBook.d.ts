/**
 * Dual Order Book for Prediction Markets
 *
 * KEY INSIGHT: There's only ONE orderbook, but two ways to view it:
 * - Buying YES at 35¢ = Selling NO at 65¢
 * - Buying NO at 65¢ = Selling YES at 35¢
 *
 * When orders match, the system mints a complete set from combined collateral.
 */
export interface DualOrder {
    id: string;
    userId: string;
    marketId: string;
    outcome: 'YES' | 'NO';
    priceInCents: number;
    quantity: number;
    filledQuantity: number;
    status: 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELLED';
    timestamp: number;
}
export interface MatchResult {
    trade: {
        id: string;
        yesBuyer: string;
        noBuyer: string;
        yesPrice: number;
        noPrice: number;
        quantity: number;
        timestamp: number;
    };
    collateralLocked: number;
}
export declare class DualOrderBook {
    readonly marketId: string;
    private yesBids;
    private noBids;
    private trades;
    private orders;
    constructor(marketId: string);
    /**
     * Submit an order to BUY either YES or NO shares
     *
     * The system automatically matches:
     * - YES buyer @ 35¢ matches with NO buyer @ 65¢+ (because 35 + 65 = 100)
     */
    submitOrder(userId: string, outcome: 'YES' | 'NO', priceInCents: number, quantity: number): {
        order: DualOrder;
        matches: MatchResult[];
    };
    /**
     * Match incoming order against opposite side
     *
     * YES buyer @ X¢ matches with NO buyer @ (100-X)¢ or higher
     */
    private matchOrder;
    private addToBook;
    /**
     * Get the order book from YES perspective
     * (This is what traders see)
     */
    getOrderBook(): {
        yesBids: {
            price: number;
            quantity: number;
            orders: number;
        }[];
        yesAsks: {
            price: number;
            quantity: number;
            orders: number;
        }[];
        lastYesPrice: number | null;
        spread: number | null;
    };
    private aggregateLevels;
    cancelOrder(orderId: string, userId: string): DualOrder | null;
    getRecentTrades(limit?: number): MatchResult[];
}
