import { v4 as uuidv4 } from 'uuid';
import { Quote, QuoteRequest, QuoteStatus, Market, Trade, ShareSide, Direction } from './types.js';

const QUOTE_EXPIRY_MS = 30000; // 30 seconds
const SPREAD_BPS = 200; // 2% spread (200 basis points)
const MIN_PRICE = 1;   // 1 cent minimum
const MAX_PRICE = 99;  // 99 cents maximum

export class QuoteEngine {
  private quotes: Map<string, Quote> = new Map();
  private markets: Map<string, Market> = new Map();
  private trades: Trade[] = [];
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up expired quotes every 10 seconds
    this.cleanupInterval = setInterval(() => this.cleanupExpiredQuotes(), 10000);
  }

  // Market Management
  createMarket(params: {
    vesselName: string;
    vesselIMO: string;
    description: string;
    expiresAt: Date;
  }): Market {
    const market: Market = {
      id: uuidv4(),
      vesselName: params.vesselName,
      vesselIMO: params.vesselIMO,
      description: params.description,
      expiresAt: params.expiresAt,
      status: 'OPEN',
      outcome: null,
      createdAt: new Date(),
      yesPool: 5000,  // Start with equal pools (50/50)
      noPool: 5000,
      totalVolume: 0
    };
    this.markets.set(market.id, market);
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

  // Price Calculation (AMM-style for quotes)
  calculatePrice(marketId: string, side: ShareSide, direction: Direction): number {
    const market = this.markets.get(marketId);
    if (!market) return 50; // Default to 50 cents

    const totalPool = market.yesPool + market.noPool;
    if (totalPool === 0) return 50;

    // Base price from pool ratio
    let basePrice: number;
    if (side === 'YES') {
      basePrice = (market.yesPool / totalPool) * 100;
    } else {
      basePrice = (market.noPool / totalPool) * 100;
    }

    // Apply spread based on direction
    const spreadCents = (SPREAD_BPS / 100);
    let finalPrice: number;
    
    if (direction === 'BUY') {
      // Buyer pays more (base + spread)
      finalPrice = basePrice + spreadCents;
    } else {
      // Seller gets less (base - spread)
      finalPrice = basePrice - spreadCents;
    }

    // Clamp to valid range
    return Math.max(MIN_PRICE, Math.min(MAX_PRICE, Math.round(finalPrice)));
  }

  // Get current market prices
  getMarketPrices(marketId: string): { yesPrice: number; noPrice: number } {
    const market = this.markets.get(marketId);
    if (!market) return { yesPrice: 50, noPrice: 50 };

    const totalPool = market.yesPool + market.noPool;
    if (totalPool === 0) return { yesPrice: 50, noPrice: 50 };

    const yesPrice = Math.round((market.yesPool / totalPool) * 100);
    const noPrice = 100 - yesPrice;

    return { yesPrice, noPrice };
  }

  // Request a quote
  requestQuote(request: QuoteRequest): Quote | null {
    const market = this.markets.get(request.marketId);
    if (!market || market.status !== 'OPEN') {
      return null;
    }

    if (request.quantity <= 0) {
      return null;
    }

    const pricePerShare = this.calculatePrice(
      request.marketId,
      request.side,
      request.direction
    );

    const totalCost = pricePerShare * request.quantity;
    const now = Date.now();

    const quote: Quote = {
      id: uuidv4(),
      marketId: request.marketId,
      odId: request.userId,
      visitorId: request.userId,
      userId: request.userId,
      side: request.side,
      direction: request.direction,
      quantity: request.quantity,
      pricePerShare,
      totalCost,
      createdAt: now,
      expiresAt: now + QUOTE_EXPIRY_MS,
      status: 'PENDING'
    };

    this.quotes.set(quote.id, quote);
    return quote;
  }

  // Get a quote by ID
  getQuote(quoteId: string): Quote | null {
    const quote = this.quotes.get(quoteId);
    if (!quote) return null;

    // Check if expired
    if (quote.status === 'PENDING' && Date.now() > quote.expiresAt) {
      quote.status = 'EXPIRED';
    }

    return quote;
  }

  // Accept a quote - returns trade if successful
  acceptQuote(quoteId: string, userId: string): { success: boolean; trade?: Trade; error?: string } {
    const quote = this.quotes.get(quoteId);
    
    if (!quote) {
      return { success: false, error: 'Quote not found' };
    }

    if (quote.userId !== userId) {
      return { success: false, error: 'Unauthorized' };
    }

    if (quote.status !== 'PENDING') {
      return { success: false, error: `Quote is ${quote.status.toLowerCase()}` };
    }

    if (Date.now() > quote.expiresAt) {
      quote.status = 'EXPIRED';
      return { success: false, error: 'Quote expired' };
    }

    const market = this.markets.get(quote.marketId);
    if (!market || market.status !== 'OPEN') {
      return { success: false, error: 'Market not available' };
    }

    // Mark quote as accepted
    quote.status = 'ACCEPTED';

    // Update market pools based on trade
    this.updateMarketPools(market, quote);

    // Create trade record
    const trade: Trade = {
      id: uuidv4(),
      marketId: quote.marketId,
      odId: quote.userId,
      visitorId: quote.userId,
      quoteId: quote.id,
      side: quote.side,
      direction: quote.direction,
      quantity: quote.quantity,
      pricePerShare: quote.pricePerShare,
      totalCost: quote.totalCost,
      timestamp: Date.now()
    };

    this.trades.push(trade);
    market.totalVolume += quote.totalCost;

    return { success: true, trade };
  }

  // Reject a quote
  rejectQuote(quoteId: string, userId: string): boolean {
    const quote = this.quotes.get(quoteId);
    
    if (!quote || quote.userId !== userId) {
      return false;
    }

    if (quote.status !== 'PENDING') {
      return false;
    }

    quote.status = 'REJECTED';
    return true;
  }

  // Update market pools after a trade
  private updateMarketPools(market: Market, quote: Quote): void {
    const impact = quote.quantity * 0.1; // Small price impact per share

    if (quote.direction === 'BUY') {
      // Buying increases demand, shifts price
      if (quote.side === 'YES') {
        market.yesPool += impact;
      } else {
        market.noPool += impact;
      }
    } else {
      // Selling decreases demand
      if (quote.side === 'YES') {
        market.yesPool = Math.max(100, market.yesPool - impact);
      } else {
        market.noPool = Math.max(100, market.noPool - impact);
      }
    }
  }

  // Settle a market
  settleMarket(marketId: string, outcome: boolean): Market | null {
    const market = this.markets.get(marketId);
    if (!market || market.status !== 'OPEN') {
      return null;
    }

    market.status = 'SETTLED';
    market.outcome = outcome;
    return market;
  }

  // Close a market (no more trading, pending settlement)
  closeMarket(marketId: string): Market | null {
    const market = this.markets.get(marketId);
    if (!market || market.status !== 'OPEN') {
      return null;
    }

    market.status = 'CLOSED';
    return market;
  }

  // Get recent trades
  getRecentTrades(marketId: string, limit: number = 20): Trade[] {
    return this.trades
      .filter(t => t.marketId === marketId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  // Get all trades for a user
  getUserTrades(userId: string): Trade[] {
    return this.trades.filter(t => t.odId === userId || t.visitorId === userId);
  }

  // Get market statistics
  getMarketStats(marketId: string): {
    market: Market;
    yesPrice: number;
    noPrice: number;
    volume24h: number;
    recentTrades: Trade[];
  } | null {
    const market = this.markets.get(marketId);
    if (!market) return null;

    const prices = this.getMarketPrices(marketId);
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    
    const volume24h = this.trades
      .filter(t => t.marketId === marketId && t.timestamp > dayAgo)
      .reduce((sum, t) => sum + t.totalCost, 0);

    return {
      market,
      yesPrice: prices.yesPrice,
      noPrice: prices.noPrice,
      volume24h,
      recentTrades: this.getRecentTrades(marketId, 10)
    };
  }

  // Cleanup expired quotes
  private cleanupExpiredQuotes(): void {
    const now = Date.now();
    for (const [id, quote] of this.quotes) {
      if (quote.status === 'PENDING' && now > quote.expiresAt) {
        quote.status = 'EXPIRED';
      }
      // Remove old quotes (older than 1 hour)
      if (now - quote.createdAt > 3600000) {
        this.quotes.delete(id);
      }
    }
  }

  // Shutdown cleanup
  shutdown(): void {
    clearInterval(this.cleanupInterval);
  }
}

// Singleton instance
export const quoteEngine = new QuoteEngine();
