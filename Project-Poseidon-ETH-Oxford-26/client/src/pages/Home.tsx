import { OrderForm } from "@/components/OrderForm";
import { OrderBook } from "@/components/OrderBook";
import { TradeHistory } from "@/components/TradeHistory";
import { Anchor, Ship } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Navbar */}
      <header className="border-b border-border bg-card/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center border border-primary/20">
              <Anchor className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-display font-bold tracking-tight leading-none text-foreground">
                POSEIDON
              </h1>
              <p className="text-xs text-muted-foreground font-medium tracking-wide">
                MARITIME RISK PROTOCOL
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/30 border border-border/50 text-xs font-mono">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              <span>NETWORK: SIMULATED</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {/* Market Header */}
        <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
             <div className="p-3 bg-card border border-border rounded-xl shadow-sm">
               <Ship className="w-8 h-8 text-primary" />
             </div>
             <div>
               <div className="flex items-center gap-2 mb-1">
                 <h2 className="text-2xl font-display font-bold text-foreground">Demurrage Risk 2024</h2>
                 <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-muted text-muted-foreground border border-border">
                   MARITIME
                 </span>
               </div>
               <p className="text-sm text-muted-foreground max-w-xl">
                 Will global demurrage rates exceed index baseline by Q4 2024? 
                 Binary outcome market settled on verified logistics data.
               </p>
             </div>
          </div>
          
          <div className="flex gap-4 text-right">
             <div>
               <div className="text-xs text-muted-foreground uppercase font-bold">24h Vol</div>
               <div className="font-mono text-lg font-medium">$142,030</div>
             </div>
             <div>
               <div className="text-xs text-muted-foreground uppercase font-bold">Open Interest</div>
               <div className="font-mono text-lg font-medium">$894,220</div>
             </div>
          </div>
        </div>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-250px)] min-h-[800px]">
          {/* Left Column: Order Entry */}
          <div className="lg:col-span-3">
            <OrderForm />
            
            <div className="mt-6 p-4 rounded-lg bg-blue-500/5 border border-blue-500/20 text-xs text-blue-200/70">
              <h4 className="font-bold text-blue-400 mb-2 flex items-center gap-2">
                <span className="w-1 h-1 bg-blue-400 rounded-full"></span>
                Protocol Note
              </h4>
              <p>
                Orders are matched off-chain via simulated CLOB engine. 
                Settlement is instant for this demo.
              </p>
            </div>
          </div>

          {/* Center Column: Order Book */}
          <div className="lg:col-span-6 h-full">
            <OrderBook />
          </div>

          {/* Right Column: Trades & Payouts */}
          <div className="lg:col-span-3 h-full">
            <TradeHistory />
          </div>
        </div>
      </main>
    </div>
  );
}
