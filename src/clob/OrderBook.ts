import { v4 as uuidv4 } from 'uuid';
import { Order, Trade, Side, OrderType, OrderStatus, PriceLevel, CreateOrderRequest } from '../types';

interface OrderNode {
  order: Order;
  next: OrderNode | null;
  prev: OrderNode | null;
}

class PriceLevelQueue {
  private head: OrderNode | null = null;
  private tail: OrderNode | null = null;
  private _totalQuantity: number = 0;
  private _orderCount: number = 0;
  private orderMap: Map<string, OrderNode> = new Map();

  get totalQuantity(): number { return this._totalQuantity; }
  get orderCount(): number { return this._orderCount; }
  get isEmpty(): boolean { return this.head === null; }

  addOrder(order: Order): void {
    const node: OrderNode = { order, next: null, prev: this.tail };
    if (this.tail) {
      this.tail.next = node;
    } else {
      this.head = node;
    }
    this.tail = node;
    this.orderMap.set(order.id, node);
    this._totalQuantity += order.remainingQuantity;
    this._orderCount++;
  }

  removeOrder(orderId: string): Order | null {
    const node = this.orderMap.get(orderId);
    if (!node) return null;

    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;

    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;

    this.orderMap.delete(orderId);
    this._totalQuantity -= node.order.remainingQuantity;
    this._orderCount--;
    return node.order;
  }

  peekFirst(): Order | null {
    return this.head?.order || null;
  }

  updateQuantity(orderId: string, filledQty: number): void {
    const node = this.orderMap.get(orderId);
    if (node) {
      this._totalQuantity -= filledQty;
    }
  }

  getOrders(): Order[] {
    const orders: Order[] = [];
    let current = this.head;
    while (current) {
      orders.push(current.order);
      current = current.next;
    }
    return orders;
  }
}

export class CLOBEngine {
  private bids: Map<number, PriceLevelQueue> = new Map(); // price -> queue
  private asks: Map<number, PriceLevelQueue> = new Map();
  private orders: Map<string, Order> = new Map();
  private sortedBidPrices: number[] = [];
  private sortedAskPrices: number[] = [];
  private trades: Trade[] = [];
  private lastPrice: number | null = null;
  private lastTradeTime: number | null = null;

  constructor(public readonly marketId: string) {}

  submitOrder(request: CreateOrderRequest): { order: Order; trades: Trade[] } {
    const order: Order = {
      id: uuidv4(),
      marketId: this.marketId,
      userId: request.userId,
      side: request.side,
      type: request.type,
      price: request.price ?? 0,
      quantity: request.quantity,
      filledQuantity: 0,
      remainingQuantity: request.quantity,
      status: 'OPEN',
      timestamp: Date.now()
    };

    const executedTrades: Trade[] = [];

    if (request.type === 'MARKET') {
      this.matchMarketOrder(order, executedTrades);
    } else {
      this.matchLimitOrder(order, executedTrades);
    }

    if (order.remainingQuantity > 0 && request.type === 'LIMIT') {
      this.addToBook(order);
    }

    this.orders.set(order.id, order);
    return { order, trades: executedTrades };
  }

  private matchLimitOrder(order: Order, trades: Trade[]): void {
    const oppositeBook = order.side === 'BUY' ? this.asks : this.bids;
    const oppositePrices = order.side === 'BUY' ? this.sortedAskPrices : this.sortedBidPrices;

    while (order.remainingQuantity > 0 && oppositePrices.length > 0) {
      const bestPrice = oppositePrices[0];
      
      // Check price compatibility
      if (order.side === 'BUY' && bestPrice > order.price) break;
      if (order.side === 'SELL' && bestPrice < order.price) break;

      const queue = oppositeBook.get(bestPrice)!;
      this.matchAtPriceLevel(order, queue, bestPrice, trades);

      if (queue.isEmpty) {
        oppositeBook.delete(bestPrice);
        oppositePrices.shift();
      }
    }

    this.updateOrderStatus(order);
  }

  private matchMarketOrder(order: Order, trades: Trade[]): void {
    const oppositeBook = order.side === 'BUY' ? this.asks : this.bids;
    const oppositePrices = order.side === 'BUY' ? this.sortedAskPrices : this.sortedBidPrices;

    while (order.remainingQuantity > 0 && oppositePrices.length > 0) {
      const bestPrice = oppositePrices[0];
      const queue = oppositeBook.get(bestPrice)!;
      this.matchAtPriceLevel(order, queue, bestPrice, trades);

      if (queue.isEmpty) {
        oppositeBook.delete(bestPrice);
        oppositePrices.shift();
      }
    }

    this.updateOrderStatus(order);
  }

  private matchAtPriceLevel(aggressor: Order, queue: PriceLevelQueue, price: number, trades: Trade[]): void {
    while (aggressor.remainingQuantity > 0 && !queue.isEmpty) {
      const resting = queue.peekFirst()!;
      const fillQty = Math.min(aggressor.remainingQuantity, resting.remainingQuantity);

      // Execute trade
      const trade: Trade = {
        id: uuidv4(),
        marketId: this.marketId,
        buyOrderId: aggressor.side === 'BUY' ? aggressor.id : resting.id,
        sellOrderId: aggressor.side === 'SELL' ? aggressor.id : resting.id,
        buyUserId: aggressor.side === 'BUY' ? aggressor.userId : resting.userId,
        sellUserId: aggressor.side === 'SELL' ? aggressor.userId : resting.userId,
        price,
        quantity: fillQty,
        timestamp: Date.now()
      };

      trades.push(trade);
      this.trades.push(trade);
      this.lastPrice = price;
      this.lastTradeTime = trade.timestamp;

      // Update quantities
      aggressor.filledQuantity += fillQty;
      aggressor.remainingQuantity -= fillQty;
      resting.filledQuantity += fillQty;
      resting.remainingQuantity -= fillQty;
      queue.updateQuantity(resting.id, fillQty);

      this.updateOrderStatus(resting);

      if (resting.remainingQuantity === 0) {
        queue.removeOrder(resting.id);
      }
    }
  }

  private addToBook(order: Order): void {
    const book = order.side === 'BUY' ? this.bids : this.asks;
    const prices = order.side === 'BUY' ? this.sortedBidPrices : this.sortedAskPrices;

    if (!book.has(order.price)) {
      book.set(order.price, new PriceLevelQueue());
      this.insertSortedPrice(prices, order.price, order.side === 'BUY');
    }

    book.get(order.price)!.addOrder(order);
  }

  private insertSortedPrice(prices: number[], price: number, descending: boolean): void {
    let i = 0;
    if (descending) {
      while (i < prices.length && prices[i] > price) i++;
    } else {
      while (i < prices.length && prices[i] < price) i++;
    }
    prices.splice(i, 0, price);
  }

  private updateOrderStatus(order: Order): void {
    if (order.remainingQuantity === 0) {
      order.status = 'FILLED';
    } else if (order.filledQuantity > 0) {
      order.status = 'PARTIAL';
    }
  }

  cancelOrder(orderId: string, userId: string): Order | null {
    const order = this.orders.get(orderId);
    if (!order || order.userId !== userId || order.status === 'FILLED' || order.status === 'CANCELLED') {
      return null;
    }

    const book = order.side === 'BUY' ? this.bids : this.asks;
    const prices = order.side === 'BUY' ? this.sortedBidPrices : this.sortedAskPrices;
    const queue = book.get(order.price);

    if (queue) {
      queue.removeOrder(orderId);
      if (queue.isEmpty) {
        book.delete(order.price);
        const idx = prices.indexOf(order.price);
        if (idx !== -1) prices.splice(idx, 1);
      }
    }

    order.status = 'CANCELLED';
    return order;
  }

  getOrderBook(): { bids: PriceLevel[]; asks: PriceLevel[]; lastPrice: number | null; spread: number | null } {
    const bids: PriceLevel[] = this.sortedBidPrices.map(price => {
      const queue = this.bids.get(price)!;
      return { price, quantity: queue.totalQuantity, orderCount: queue.orderCount };
    });

    const asks: PriceLevel[] = this.sortedAskPrices.map(price => {
      const queue = this.asks.get(price)!;
      return { price, quantity: queue.totalQuantity, orderCount: queue.orderCount };
    });

    const bestBid = this.sortedBidPrices[0] ?? null;
    const bestAsk = this.sortedAskPrices[0] ?? null;
    const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;

    return { bids, asks, lastPrice: this.lastPrice, spread };
  }

  getOrder(orderId: string): Order | null {
    return this.orders.get(orderId) || null;
  }

  getUserOrders(userId: string): Order[] {
    return Array.from(this.orders.values()).filter(o => o.userId === userId);
  }

  getRecentTrades(limit: number = 50): Trade[] {
    return this.trades.slice(-limit).reverse();
  }

  getBestBid(): number | null {
    return this.sortedBidPrices[0] ?? null;
  }

  getBestAsk(): number | null {
    return this.sortedAskPrices[0] ?? null;
  }
}
