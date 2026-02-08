import { useTrades, usePayoutSimulation } from "@/hooks/use-market";
import { format } from "date-fns";
import { Loader2, ArrowRight } from "lucide-react";

export function TradeHistory() {
  const { data: trades, isLoading: tradesLoading } = useTrades();
  const { data: payout, isLoading: payoutLoading } = usePayoutSimulation();

  return (
    <div className="space-y-6 h-full flex flex-col">
      {/* Payout Simulator Card */}
      <div className="bg-card border border-border rounded-lg p-6 shadow-lg shadow-black/10">
        <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
          Settlement Simulation
        </h3>
        
        {payoutLoading || !payout ? (
          <div className="py-8 flex justify-center"><Loader2 className="animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4">
             <div className="flex justify-between items-baseline">
                <span className="text-muted-foreground text-sm">Outcome</span>
                <span className={`font-mono font-bold text-xl ${payout.outcome === 'YES' ? 'text-trade-green' : 'text-trade-red'}`}>
                  {payout.outcome}
                </span>
             </div>
             
             <div className="grid grid-cols-2 gap-4">
               <div className="bg-muted/20 p-3 rounded border border-border/50">
                 <div className="text-xs text-muted-foreground mb-1">YES Payout</div>
                 <div className="font-mono font-bold text-lg text-foreground">${payout.longPayout.toFixed(2)}</div>
               </div>
               <div className="bg-muted/20 p-3 rounded border border-border/50">
                 <div className="text-xs text-muted-foreground mb-1">NO Payout</div>
                 <div className="font-mono font-bold text-lg text-foreground">${payout.shortPayout.toFixed(2)}</div>
               </div>
             </div>

             <div className="pt-2 border-t border-border/50 flex justify-between text-xs text-muted-foreground">
               <span>Volume</span>
               <span className="font-mono text-foreground">{payout.totalVolume} shares</span>
             </div>
          </div>
        )}
      </div>

      {/* Recent Trades List */}
      <div className="bg-card border border-border rounded-lg shadow-lg shadow-black/10 flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="p-4 border-b border-border bg-muted/10">
          <h3 className="font-display font-semibold">Recent Trades</h3>
        </div>
        
        <div className="p-2 grid grid-cols-3 text-xs text-muted-foreground uppercase font-bold border-b border-border/50">
          <span>Price</span>
          <span className="text-right">Size</span>
          <span className="text-right">Time</span>
        </div>

        <div className="overflow-y-auto flex-1 custom-scrollbar">
          {tradesLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin text-muted-foreground" /></div>
          ) : trades?.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground/50 text-sm">No trades yet</div>
          ) : (
            <div className="divide-y divide-border/20">
              {trades?.map((trade) => (
                <div key={trade.id} className="grid grid-cols-3 px-2 py-2 text-sm font-mono hover:bg-muted/20 transition-colors">
                  <span className="text-trade-green">{trade.price}¢</span>
                  <span className="text-right text-foreground">{trade.quantity}</span>
                  <span className="text-right text-muted-foreground text-xs pt-0.5">
                    {trade.timestamp ? format(new Date(trade.timestamp), "HH:mm:ss") : "-"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
