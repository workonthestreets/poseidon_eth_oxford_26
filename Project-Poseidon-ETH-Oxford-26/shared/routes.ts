import { z } from "zod";
import { insertOrderSchema, orders, trades, type InsertOrder } from "./schema";

export type { InsertOrder };

export const api = {
  orders: {
    create: {
      method: "POST" as const,
      path: "/api/orders" as const,
      input: insertOrderSchema,
      responses: {
        201: z.object({
          orderId: z.number(),
          matches: z.array(z.custom<typeof trades.$inferSelect>())
        }),
        400: z.object({ message: z.string() })
      }
    },
    list: {
      method: "GET" as const,
      path: "/api/orders" as const,
      responses: {
        200: z.array(z.custom<typeof orders.$inferSelect>())
      }
    }
  },
  orderbook: {
    get: {
      method: "GET" as const,
      path: "/api/orderbook" as const,
      responses: {
        200: z.object({
          bids: z.array(z.object({
            price: z.number(),
            quantity: z.number(),
            side: z.literal("buy"),
            orderCount: z.number()
          })),
          asks: z.array(z.object({
            price: z.number(),
            quantity: z.number(),
            side: z.literal("sell"),
            orderCount: z.number()
          })),
          spread: z.number().nullable()
        })
      }
    }
  },
  trades: {
    list: {
      method: "GET" as const,
      path: "/api/trades" as const,
      responses: {
        200: z.array(z.custom<typeof trades.$inferSelect>())
      }
    }
  },
  payouts: {
    simulate: {
      method: "GET" as const,
      path: "/api/payouts/simulate" as const,
      responses: {
        200: z.object({
          symbol: z.string(),
          totalVolume: z.number(),
          outcome: z.enum(["YES", "NO"]),
          longPayout: z.number(),
          shortPayout: z.number()
        })
      }
    }
  }
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
