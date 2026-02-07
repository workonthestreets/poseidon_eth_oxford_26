import { v4 as uuidv4 } from 'uuid';
import { CLOBEngine } from './OrderBook.js';
import { Market, Order, Trade, CreateOrderRequest } from '../types/index.js';

export class MarketManager {
  private markets: Map<string, Market> = new Map();
  private orderBooks: Map<string, CLOBEngine> = new Map();

  createMarket(params: {
    vesselName: string;
    vesselIMO: string;
    route: string;
    expectedArrival: Date;
    demurrageThresholdHours: number;
    maxPayout: number;
  }): Market {
    const market: Market = {
      id: uuidv4(),
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
    this.orderBooks.set(market.id, new CLOBEngine(market.id));
    return market;
  }

  getMarket(marketId: string): Market | null {
    return this.markets.get(marketId) || null;
  }

  getAllMarkets(): Market[] {
    return Array.from(this.markets.values());
  }

  getOpenMarkets(): Market[] {
    return Array.from(this.markets.values()).filter(m => m.status === 'OPEN');
  }

  getOrderBook(marketId: string): CLOBEngine | null {
    return this.orderBooks.get(marketId) || null;
  }

  submitOrder(request: CreateOrderRequest): { order: Order; trades: Trade[] } | null {
    const market = this.markets.get(request.marketId);
    if (!market || market.status !== 'OPEN') {
      return null;
    }

    const orderBook = this.orderBooks.get(request.marketId);
    if (!orderBook) return null;

    // Validate price range for prediction markets (0-100 cents)
    if (request.type === 'LIMIT') {
      if (request.price === undefined || request.price < 1 || request.price > 99) {
        throw new Error('Price must be between 1 and 99 cents');
      }
    }

    return orderBook.submitOrder(request);
  }

  cancelOrder(marketId: string, orderId: string, userId: string): Order | null {
    const orderBook = this.orderBooks.get(marketId);
    if (!orderBook) return null;
    return orderBook.cancelOrder(orderId, userId);
  }

  settleMarket(marketId: string, demurrageOccurred: boolean): Market | null {
    const market = this.markets.get(marketId);
    if (!market || market.status !== 'OPEN') return null;

    market.status = 'SETTLED';
    market.settlementPrice = demurrageOccurred ? 100 : 0;
    return market;
  }

  getMarketStats(marketId: string): {
    market: Market;
    orderBook: ReturnType<CLOBEngine['getOrderBook']>;
    recentTrades: Trade[];
    volume24h: number;
  } | null {
    const market = this.markets.get(marketId);
    const ob = this.orderBooks.get(marketId);
    if (!market || !ob) return null;

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

export const marketManager = new MarketManager();
