import { pgTable, text, serial, integer, boolean, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// === IN-MEMORY ORDER BOOK SCHEMA DEFINITIONS ===
// We use Drizzle/Postgres definitions for type inference consistency, 
// even though we will strictly use in-memory storage as requested.

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(), // e.g., "DEMURRAGE-2024"
  side: text("side").notNull(), // "buy" | "sell"
  price: integer("price").notNull(), // 0-100 (probability/cents)
  quantity: integer("quantity").notNull(),
  filled: integer("filled").default(0),
  status: text("status").notNull(), // "open" | "filled" | "cancelled"
  timestamp: timestamp("timestamp").defaultNow(),
});

export const trades = pgTable("trades", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  price: integer("price").notNull(),
  quantity: integer("quantity").notNull(),
  buyerOrderId: integer("buyer_order_id").notNull(),
  sellerOrderId: integer("seller_order_id").notNull(),
  timestamp: timestamp("timestamp").defaultNow(),
});

// === SCHEMAS ===
export const insertOrderSchema = createInsertSchema(orders).pick({
  symbol: true,
  side: true,
  price: true,
  quantity: true,
});

export const orderSchema = createInsertSchema(orders);
export const tradeSchema = createInsertSchema(trades);

// === TYPES ===
export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Trade = typeof trades.$inferSelect;

export type OrderBookLevel = {
  price: number;
  quantity: number;
  side: "buy" | "sell";
  orderCount: number;
};

export type OrderBookState = {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  spread: number | null;
};

export type Payout = {
  symbol: string;
  totalVolume: number;
  outcome: "YES" | "NO"; // For the demo simulation
  longPayout: number; // Payout per share for YES holders
  shortPayout: number; // Payout per share for NO holders
};
