import { Order, Trade, PriceLevel, CreateOrderRequest } from '../types';
export declare class CLOBEngine {
    readonly marketId: string;
    private bids;
    private asks;
    private orders;
    private sortedBidPrices;
    private sortedAskPrices;
    private trades;
    private lastPrice;
    private lastTradeTime;
    constructor(marketId: string);
    submitOrder(request: CreateOrderRequest): {
        order: Order;
        trades: Trade[];
    };
    private matchLimitOrder;
    private matchMarketOrder;
    private matchAtPriceLevel;
    private addToBook;
    private insertSortedPrice;
    private updateOrderStatus;
    cancelOrder(orderId: string, userId: string): Order | null;
    getOrderBook(): {
        bids: PriceLevel[];
        asks: PriceLevel[];
        lastPrice: number | null;
        spread: number | null;
    };
    getOrder(orderId: string): Order | null;
    getUserOrders(userId: string): Order[];
    getRecentTrades(limit?: number): Trade[];
    getBestBid(): number | null;
    getBestAsk(): number | null;
}
