export type Side = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET';
export type OrderStatus = 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELLED';

export interface Order {
  id: string;
  marketId: string;
  userId: string;
  side: Side;
  type: OrderType;
  price: number; // in cents (0-100 for prediction markets)
  quantity: number; // number of shares
  filledQuantity: number;
  remainingQuantity: number;
  status: OrderStatus;
  timestamp: number;
}

export interface Trade {
  id: string;
  marketId: string;
  buyOrderId: string;
  sellOrderId: string;
  buyUserId: string;
  sellUserId: string;
  price: number;
  quantity: number;
  timestamp: number;
}

export interface OrderBook {
  marketId: string;
  bids: PriceLevel[]; // sorted desc by price
  asks: PriceLevel[]; // sorted asc by price
  lastPrice: number | null;
  lastTradeTime: number | null;
}

export interface PriceLevel {
  price: number;
  quantity: number;
  orderCount: number;
}

export interface Market {
  id: string;
  vesselName: string;
  vesselIMO: string;
  route: string;
  expectedArrival: Date;
  demurrageThresholdHours: number;
  maxPayout: number; // in USD
  status: 'OPEN' | 'CLOSED' | 'SETTLED';
  settlementPrice: number | null; // 0 or 100
  createdAt: Date;
}

export interface CreateOrderRequest {
  marketId: string;
  userId: string;
  side: Side;
  type: OrderType;
  price?: number;
  quantity: number;
}

export interface CancelOrderRequest {
  orderId: string;
  userId: string;
}

export interface WebSocketMessage {
  type: 'ORDER_BOOK' | 'TRADE' | 'ORDER_UPDATE' | 'MARKET_UPDATE';
  data: any;
}
