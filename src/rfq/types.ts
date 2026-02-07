export type QuoteStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REJECTED';
export type ShareSide = 'YES' | 'NO';
export type Direction = 'BUY' | 'SELL';

export interface Quote {
  id: string;
  marketId: string;
  userId: string;
  side: ShareSide;
  direction: Direction;
  quantity: number;
  pricePerShare: number;  // In cents (0-100)
  totalCost: number;      // In cents
  createdAt: number;
  expiresAt: number;
  status: QuoteStatus;
}

export interface QuoteRequest {
  marketId: string;
  userId: string;
  side: ShareSide;
  direction: Direction;
  quantity: number;
}

export interface Position {
  odId: string;
  visitorId: string;
  marketId: string;
  yesShares: number;
  noShares: number;
  avgYesCost: number;  // Average cost per YES share in cents
  avgNoCost: number;   // Average cost per NO share in cents
}

export interface UserBalance {
  odId: string;
  visitorId: string;
  balanceUSD: number;  // In cents (e.g., 10000 = $100)
  positions: Map<string, Position>;
}

export interface Market {
  id: string;
  vesselName: string;
  vesselIMO: string;
  description: string;
  expiresAt: Date;
  status: 'OPEN' | 'CLOSED' | 'SETTLED';
  outcome: boolean | null;  // true = YES wins, false = NO wins, null = not settled
  createdAt: Date;
  // Pool state for pricing
  yesPool: number;
  noPool: number;
  totalVolume: number;
}

export interface Trade {
  id: string;
  marketId: string;
  odId: string;
  visitorId: string;
  quoteId: string;
  side: ShareSide;
  direction: Direction;
  quantity: number;
  pricePerShare: number;
  totalCost: number;
  timestamp: number;
}

export interface MarketStats {
  market: Market;
  yesPrice: number;
  noPrice: number;
  volume24h: number;
  openInterest: number;
}

export interface WebSocketMessage {
  type: 'PRICE_UPDATE' | 'TRADE' | 'MARKET_UPDATE' | 'POSITION_UPDATE';
  data: any;
}
