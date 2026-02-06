import { CLOBEngine } from './OrderBook';
import { Market, Order, Trade, CreateOrderRequest } from '../types';
export declare class MarketManager {
    private markets;
    private orderBooks;
    createMarket(params: {
        vesselName: string;
        vesselIMO: string;
        route: string;
        expectedArrival: Date;
        demurrageThresholdHours: number;
        maxPayout: number;
    }): Market;
    getMarket(marketId: string): Market | null;
    getAllMarkets(): Market[];
    getOpenMarkets(): Market[];
    getOrderBook(marketId: string): CLOBEngine | null;
    submitOrder(request: CreateOrderRequest): {
        order: Order;
        trades: Trade[];
    } | null;
    cancelOrder(marketId: string, orderId: string, userId: string): Order | null;
    settleMarket(marketId: string, demurrageOccurred: boolean): Market | null;
    getMarketStats(marketId: string): {
        market: Market;
        orderBook: ReturnType<CLOBEngine['getOrderBook']>;
        recentTrades: Trade[];
        volume24h: number;
    } | null;
}
export declare const marketManager: MarketManager;
