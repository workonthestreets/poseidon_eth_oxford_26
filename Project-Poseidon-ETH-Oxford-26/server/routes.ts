import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Create Order
  app.post(api.orders.create.path, async (req, res) => {
    try {
      const input = api.orders.create.input.parse(req.body);
      const result = await storage.createOrder(input);
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
      } else {
        res.status(500).json({ message: "Internal Server Error" });
      }
    }
  });

  // Get Order Book
  app.get(api.orderbook.get.path, async (req, res) => {
    const symbol = "DEMURRAGE-2024"; // Hardcoded for MVP
    const book = await storage.getOrderBook(symbol);
    res.json(book);
  });

  // Get Trades
  app.get(api.trades.list.path, async (req, res) => {
    const symbol = "DEMURRAGE-2024";
    const trades = await storage.getTrades(symbol);
    res.json(trades);
  });
  
  // Get Orders (for debug/list)
  app.get(api.orders.list.path, async (req, res) => {
    const symbol = "DEMURRAGE-2024";
    const orders = await storage.getAllOrders(symbol);
    res.json(orders);
  });

  // Simulate Payout
  app.get(api.payouts.simulate.path, async (req, res) => {
    // This is a simulation of what happens at settlement
    const outcome = Math.random() > 0.5 ? "YES" : "NO";
    const symbol = "DEMURRAGE-2024";
    
    // In a binary market:
    // If YES wins: Longs get $1, Shorts get $0
    // If NO wins: Longs get $0, Shorts get $1
    
    res.json({
      symbol,
      totalVolume: 100000, // Dummy
      outcome,
      longPayout: outcome === "YES" ? 1.00 : 0.00,
      shortPayout: outcome === "NO" ? 1.00 : 0.00
    });
  });

  // Seed data
  if ((await storage.getTrades("DEMURRAGE-2024")).length === 0) {
    console.log("Seeding Order Book...");
    // Add some resting liquidity
    await storage.createOrder({ symbol: "DEMURRAGE-2024", side: "buy", price: 40, quantity: 100 });
    await storage.createOrder({ symbol: "DEMURRAGE-2024", side: "buy", price: 38, quantity: 250 });
    await storage.createOrder({ symbol: "DEMURRAGE-2024", side: "buy", price: 35, quantity: 500 });
    
    await storage.createOrder({ symbol: "DEMURRAGE-2024", side: "sell", price: 60, quantity: 100 });
    await storage.createOrder({ symbol: "DEMURRAGE-2024", side: "sell", price: 62, quantity: 150 });
    await storage.createOrder({ symbol: "DEMURRAGE-2024", side: "sell", price: 65, quantity: 300 });
  }

  return httpServer;
}
