import { InsertOrder, Order, Trade } from "@shared/schema";
import { OrderBook } from "./orderbook";

export interface IStorage {
  // Order Book Methods
  createOrder(order: InsertOrder): Promise<{ orderId: number; matches: Trade[] }>;
  getOrderBook(symbol: string): Promise<any>;
  getTrades(symbol: string): Promise<Trade[]>;
  getAllOrders(symbol: string): Promise<Order[]>;
}

export class MemStorage implements IStorage {
  private books: Map<string, OrderBook>;

  constructor() {
    this.books = new Map();
    // Initialize default market
    this.books.set("DEMURRAGE-2024", new OrderBook("DEMURRAGE-2024"));
  }

  private getBook(symbol: string): OrderBook {
    let book = this.books.get(symbol);
    if (!book) {
      book = new OrderBook(symbol);
      this.books.set(symbol, book);
    }
    return book;
  }

  async createOrder(insertOrder: InsertOrder): Promise<{ orderId: number; matches: Trade[] }> {
    const book = this.getBook(insertOrder.symbol);
    // Cast strict type
    const side = insertOrder.side as "buy" | "sell";
    return book.addOrder(side, insertOrder.price, insertOrder.quantity);
  }

  async getOrderBook(symbol: string): Promise<any> {
    const book = this.getBook(symbol);
    return book.getSnapshot();
  }

  async getTrades(symbol: string): Promise<Trade[]> {
    const book = this.getBook(symbol);
    return book.trades;
  }

  async getAllOrders(symbol: string): Promise<Order[]> {
    const book = this.getBook(symbol);
    return [...book.bids, ...book.asks];
  }
}

export const storage = new MemStorage();
