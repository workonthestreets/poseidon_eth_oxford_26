import { Order, Trade } from "@shared/schema";

export class OrderBook {
  bids: Order[] = [];
  asks: Order[] = [];
  trades: Trade[] = [];
  private orderIdCounter = 1;
  private tradeIdCounter = 1;

  constructor(public symbol: string) {}

  addOrder(side: "buy" | "sell", price: number, quantity: number): { orderId: number; matches: Trade[] } {
    const order: Order = {
      id: this.orderIdCounter++,
      symbol: this.symbol,
      side,
      price,
      quantity,
      filled: 0,
      status: "open",
      timestamp: new Date(),
    };

    const matches: Trade[] = [];

    if (side === "buy") {
      this.matchBuyOrder(order, matches);
    } else {
      this.matchSellOrder(order, matches);
    }

    // If not fully filled, add to book
    if (order.status === "open") {
      if (side === "buy") {
        this.bids.push(order);
        this.bids.sort((a, b) => b.price - a.price || a.id - b.id); // Best price (highest) first, then FIFO
      } else {
        this.asks.push(order);
        this.asks.sort((a, b) => a.price - b.price || a.id - b.id); // Best price (lowest) first, then FIFO
      }
    }

    return { orderId: order.id, matches };
  }

  private matchBuyOrder(order: Order, matches: Trade[]) {
    // Match against Asks (lowest price first)
    while (order.status === "open" && this.asks.length > 0) {
      const bestAsk = this.asks[0];

      if (bestAsk.price > order.price) {
        break; // No overlap
      }

      this.executeTrade(order, bestAsk, matches);

      if (bestAsk.status === "filled") {
        this.asks.shift(); // Remove filled ask
      }
    }
  }

  private matchSellOrder(order: Order, matches: Trade[]) {
    // Match against Bids (highest price first)
    while (order.status === "open" && this.bids.length > 0) {
      const bestBid = this.bids[0];

      if (bestBid.price < order.price) {
        break; // No overlap
      }

      this.executeTrade(bestBid, order, matches);

      if (bestBid.status === "filled") {
        this.bids.shift(); // Remove filled bid
      }
    }
  }

  private executeTrade(buyOrder: Order, sellOrder: Order, matches: Trade[]) {
    const tradePrice = sellOrder.price; // Maker takes priority (usually) - or simpler: match at standing order price
    // In this simple engine, we match at the price of the order that was ALREADY in the book (the maker).
    // If I buy at 50, and there is a sell at 40, I buy at 40.
    // Logic above checks `bestAsk.price <= order.price` (40 <= 50), so we trade at 40. Correct.

    const quantity = Math.min(
      buyOrder.quantity - (buyOrder.filled || 0),
      sellOrder.quantity - (sellOrder.filled || 0)
    );

    buyOrder.filled = (buyOrder.filled || 0) + quantity;
    sellOrder.filled = (sellOrder.filled || 0) + quantity;

    if (buyOrder.filled >= buyOrder.quantity) buyOrder.status = "filled";
    if (sellOrder.filled >= sellOrder.quantity) sellOrder.status = "filled";

    const trade: Trade = {
      id: this.tradeIdCounter++,
      symbol: this.symbol,
      price: tradePrice,
      quantity,
      buyerOrderId: buyOrder.id,
      sellerOrderId: sellOrder.id,
      timestamp: new Date(),
    };

    this.trades.unshift(trade); // Newest first
    matches.push(trade);
  }

  getSnapshot() {
    return {
      bids: this.aggregateLevels(this.bids),
      asks: this.aggregateLevels(this.asks),
      spread: this.calculateSpread()
    };
  }

  private aggregateLevels(orders: Order[]) {
    const levels = new Map<number, { price: number; quantity: number; orderCount: number; side: "buy" | "sell" }>();

    for (const order of orders) {
      const existing = levels.get(order.price);
      if (existing) {
        existing.quantity += (order.quantity - (order.filled || 0));
        existing.orderCount++;
      } else {
        levels.set(order.price, {
          price: order.price,
          quantity: order.quantity - (order.filled || 0),
          orderCount: 1,
          side: order.side as "buy" | "sell"
        });
      }
    }
    return Array.from(levels.values());
  }

  private calculateSpread() {
    if (this.bids.length === 0 || this.asks.length === 0) return null;
    return this.asks[0].price - this.bids[0].price;
  }
}
