import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type InsertOrder } from "@shared/routes";

// Poll interval for simulated real-time data
const POLL_INTERVAL = 1000;

export function useOrders() {
  return useQuery({
    queryKey: [api.orders.list.path],
    queryFn: async () => {
      const res = await fetch(api.orders.list.path);
      if (!res.ok) throw new Error("Failed to fetch orders");
      return api.orders.list.responses[200].parse(await res.json());
    },
    refetchInterval: POLL_INTERVAL,
  });
}

export function useOrderBook() {
  return useQuery({
    queryKey: [api.orderbook.get.path],
    queryFn: async () => {
      const res = await fetch(api.orderbook.get.path);
      if (!res.ok) throw new Error("Failed to fetch order book");
      return api.orderbook.get.responses[200].parse(await res.json());
    },
    refetchInterval: POLL_INTERVAL,
  });
}

export function useTrades() {
  return useQuery({
    queryKey: [api.trades.list.path],
    queryFn: async () => {
      const res = await fetch(api.trades.list.path);
      if (!res.ok) throw new Error("Failed to fetch trades");
      return api.trades.list.responses[200].parse(await res.json());
    },
    refetchInterval: POLL_INTERVAL,
  });
}

export function usePayoutSimulation() {
  return useQuery({
    queryKey: [api.payouts.simulate.path],
    queryFn: async () => {
      const res = await fetch(api.payouts.simulate.path);
      if (!res.ok) throw new Error("Failed to simulate payout");
      return api.payouts.simulate.responses[200].parse(await res.json());
    },
    refetchInterval: POLL_INTERVAL * 2, // Slightly slower update
  });
}

export function useCreateOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: InsertOrder) => {
      const res = await fetch(api.orders.create.path, {
        method: api.orders.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        if (res.status === 400) {
          const error = await res.json();
          throw new Error(error.message);
        }
        throw new Error("Failed to create order");
      }
      return api.orders.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      // Invalidate everything to show instant updates
      queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.orderbook.get.path] });
      queryClient.invalidateQueries({ queryKey: [api.trades.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.payouts.simulate.path] });
    },
  });
}
