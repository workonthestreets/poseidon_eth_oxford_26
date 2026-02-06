export type Side = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET';
export type OrderStatus = 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELLED';
export interface Order {
    id: string;
    marketId: string;
    userId: string;
    side: Side;
    type: OrderType;
    price: number;
    quantity: number;
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
    bids: PriceLevel[];
    asks: PriceLevel[];
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
    maxPayout: number;
    status: 'OPEN' | 'CLOSED' | 'SETTLED';
    settlementPrice: number | null;
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
