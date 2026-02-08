import { useOrderBook } from "@/hooks/use-market";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function OrderBook() {
  const { data: orderBook, isLoading } = useOrderBook();

  if (isLoading || !orderBook) {
    return (
      <div className="h-[500px] flex flex-col items-center justify-center border border-border rounded-lg bg-card/50">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mb-2" />
        <span className="text-muted-foreground font-mono text-sm">Connecting to feed...</span>
      </div>
    );
  }

  // Calculate totals for visual depth bars
  const maxBidVol = Math.max(...orderBook.bids.map(b => b.quantity), 1);
  const maxAskVol = Math.max(...orderBook.asks.map(a => a.quantity), 1);
  const maxVol = Math.max(maxBidVol, maxAskVol);

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden shadow-lg shadow-black/20 flex flex-col h-[600px]">
      <div className="p-4 border-b border-border bg-muted/10">
        <h3 className="font-display font-semibold text-lg flex justify-between items-center">
          <span>Order Book</span>
          <span className="text-xs font-mono bg-background border border-border px-2 py-1 rounded text-muted-foreground">
            Spread: {orderBook.spread !== null ? `${orderBook.spread}¢` : "-"}
          </span>
        </h3>
        <div className="grid grid-cols-3 text-xs text-muted-foreground uppercase font-bold mt-4 px-2">
          <span>Price (¢)</span>
          <span className="text-right">Qty</span>
          <span className="text-right">Total</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto font-mono text-sm relative custom-scrollbar flex flex-col">
        {/* ASKS (Sells) - Render reversed so lowest price is at bottom (closest to spread) */}
        <div className="flex flex-col-reverse justify-end min-h-[45%]">
          {orderBook.asks.length === 0 && (
            <div className="text-center py-8 text-muted-foreground/50 italic text-xs">No active sellers</div>
          )}
          {orderBook.asks.map((ask, i) => {
            const width = (ask.quantity / maxVol) * 100;
            return (
              <div key={`ask-${ask.price}`} className="relative grid grid-cols-3 px-6 py-1 hover:bg-white/5 cursor-pointer group">
                <div 
                  className="absolute top-0 right-0 bottom-0 bg-trade-red-subtle transition-all duration-300"
                  style={{ width: `${width}%`, opacity: 0.3 }}
                />
                <span className="text-trade-red font-bold relative z-10">{ask.price}</span>
                <span className="text-right text-foreground/80 relative z-10">{ask.quantity}</span>
                <span className="text-right text-muted-foreground relative z-10">{ask.quantity * ask.price}</span>
              </div>
            );
          })}
        </div>

        {/* SPREAD INDICATOR */}
        <div className="border-y border-border/50 bg-background/50 py-2 px-6 flex justify-between items-center my-1 sticky top-0 bottom-0 z-20 backdrop-blur-sm">
          <span className="text-xs text-muted-foreground font-bold uppercase">Spread</span>
          <span className="font-mono font-bold text-lg text-foreground">
            {orderBook.spread !== null ? orderBook.spread : "—"}
          </span>
        </div>

        {/* BIDS (Buys) - Highest price at top */}
        <div className="min-h-[45%]">
          {orderBook.bids.length === 0 && (
            <div className="text-center py-8 text-muted-foreground/50 italic text-xs">No active buyers</div>
          )}
          {orderBook.bids.map((bid, i) => {
            const width = (bid.quantity / maxVol) * 100;
            return (
              <div key={`bid-${bid.price}`} className="relative grid grid-cols-3 px-6 py-1 hover:bg-white/5 cursor-pointer group">
                <div 
                  className="absolute top-0 right-0 bottom-0 bg-trade-green-subtle transition-all duration-300"
                  style={{ width: `${width}%`, opacity: 0.3 }}
                />
                <span className="text-trade-green font-bold relative z-10">{bid.price}</span>
                <span className="text-right text-foreground/80 relative z-10">{bid.quantity}</span>
                <span className="text-right text-muted-foreground relative z-10">{bid.quantity * bid.price}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
