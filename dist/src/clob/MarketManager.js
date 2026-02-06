"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.marketManager = exports.MarketManager = void 0;
const uuid_1 = require("uuid");
const OrderBook_1 = require("./OrderBook");
class MarketManager {
    constructor() {
        this.markets = new Map();
        this.orderBooks = new Map();
    }
    createMarket(params) {
        const market = {
            id: (0, uuid_1.v4)(),
            vesselName: params.vesselName,
            vesselIMO: params.vesselIMO,
            route: params.route,
            expectedArrival: params.expectedArrival,
            demurrageThresholdHours: params.demurrageThresholdHours,
            maxPayout: params.maxPayout,
            status: 'OPEN',
            settlementPrice: null,
            createdAt: new Date()
        };
        this.markets.set(market.id, market);
        this.orderBooks.set(market.id, new OrderBook_1.CLOBEngine(market.id));
        return market;
    }
    getMarket(marketId) {
        return this.markets.get(marketId) || null;
    }
    getAllMarkets() {
        return Array.from(this.markets.values());
    }
    getOpenMarkets() {
        return Array.from(this.markets.values()).filter(m => m.status === 'OPEN');
    }
    getOrderBook(marketId) {
        return this.orderBooks.get(marketId) || null;
    }
    submitOrder(request) {
        const market = this.markets.get(request.marketId);
        if (!market || market.status !== 'OPEN') {
            return null;
        }
        const orderBook = this.orderBooks.get(request.marketId);
        if (!orderBook)
            return null;
        // Validate price range for prediction markets (0-100 cents)
        if (request.type === 'LIMIT') {
            if (request.price === undefined || request.price < 1 || request.price > 99) {
                throw new Error('Price must be between 1 and 99 cents');
            }
        }
        return orderBook.submitOrder(request);
    }
    cancelOrder(marketId, orderId, userId) {
        const orderBook = this.orderBooks.get(marketId);
        if (!orderBook)
            return null;
        return orderBook.cancelOrder(orderId, userId);
    }
    settleMarket(marketId, demurrageOccurred) {
        const market = this.markets.get(marketId);
        if (!market || market.status !== 'OPEN')
            return null;
        market.status = 'SETTLED';
        market.settlementPrice = demurrageOccurred ? 100 : 0;
        return market;
    }
    getMarketStats(marketId) {
        const market = this.markets.get(marketId);
        const ob = this.orderBooks.get(marketId);
        if (!market || !ob)
            return null;
        const recentTrades = ob.getRecentTrades(100);
        const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
        const volume24h = recentTrades
            .filter(t => t.timestamp > dayAgo)
            .reduce((sum, t) => sum + t.quantity * t.price, 0);
        return {
            market,
            orderBook: ob.getOrderBook(),
            recentTrades: recentTrades.slice(0, 20),
            volume24h
        };
    }
}
exports.MarketManager = MarketManager;
exports.marketManager = new MarketManager();
