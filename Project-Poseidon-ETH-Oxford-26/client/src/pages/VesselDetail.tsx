import { useState, useEffect, useRef } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { ChevronLeft, ArrowRight, Clock, DollarSign, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import Navbar from "@/components/Navbar";
import { useMarketData } from "@/lib/MarketDataContext";
import type { RiskMarket } from "@/lib/marketLogic";

function useCountdown(target: Date) {
  const [now, setNow] = useState(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    intervalRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(intervalRef.current);
  }, []);

  const diff = Math.max(0, target.getTime() - now);
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const isOpen = diff > 0;

  return {
    isOpen,
    display: `${hours}h ${minutes}m`,
  };
}

function AuctionCard({
  market,
  vesselId,
}: {
  market: RiskMarket;
  vesselId: string;
}) {
  const [, navigate] = useLocation();
  const countdown = useCountdown(market.auctionCloseTime);
  const Icon = market.icon;
  const p = market.estimatedProbability;
  const multiplier = Math.round((1 / p) * 100) / 100;

  return (
    <Card
      className="hover-elevate cursor-pointer overflow-visible group"
      data-testid={`card-market-${market.id}`}
    >
      <div
        className="p-4 flex flex-col gap-3"
        onClick={() => navigate(`/vessel/${vesselId}/market/${market.id}`)}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="p-1.5 rounded bg-primary/10 shrink-0">
              <Icon className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h4 className="font-semibold text-sm" data-testid={`text-market-name-${market.id}`}>{market.name}</h4>
              <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{market.description}</p>
            </div>
          </div>
          <Badge
            variant="secondary"
            className={cn("shrink-0 text-[10px]", countdown.isOpen ? "text-trade-green" : "text-trade-red")}
            data-testid={`badge-status-${market.id}`}
          >
            {countdown.isOpen ? "Open" : "Closed"}
          </Badge>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="text-[10px] text-muted-foreground uppercase">Probability</div>
            <div className="font-mono text-sm font-semibold mt-0.5" data-testid={`text-prob-${market.id}`}>
              {(p * 100).toFixed(0)}%
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase">Multiplier</div>
            <div className="font-mono text-sm font-semibold text-trade-green mt-0.5" data-testid={`text-mult-${market.id}`}>
              {multiplier}x
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase">Closes in</div>
            <div className="font-mono text-sm font-semibold mt-0.5" data-testid={`text-countdown-${market.id}`}>
              {countdown.isOpen ? countdown.display : "--"}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <DollarSign className="w-3 h-3" />
              <span className="font-mono">${market.totalPool.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-1">
              <Users className="w-3 h-3" />
              <span className="font-mono">{market.bidCount} bids</span>
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground transition-colors">
            <span>View Auction</span>
            <ArrowRight className="w-3 h-3" />
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function VesselDetail() {
  const [, params] = useRoute("/vessel/:id");
  const { vessels } = useMarketData();

  const vesselId = params?.id;
  const vessel = vessels.find((v) => v.id === vesselId);

  if (!vessel) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="p-6 text-center">
          <h2 className="text-base font-semibold mb-2">Vessel Not Found</h2>
          <Link href="/">
            <Button variant="outline" data-testid="button-back-gallery">Back to Markets</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const totalPool = vessel.markets.reduce((sum, m) => sum + m.totalPool, 0);
  const totalBids = vessel.markets.reduce((sum, m) => sum + m.bidCount, 0);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />

      <div className="flex-1 flex overflow-hidden">
        <aside className="hidden lg:flex flex-col w-56 border-r border-border overflow-y-auto shrink-0">
          <div className="px-3 pt-3 pb-2">
            <Link href="/">
              <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="button-back-fleet">
                <ChevronLeft className="w-3 h-3" />
                <span>Markets</span>
              </button>
            </Link>
          </div>
          <nav className="flex-1 px-2 pb-2 space-y-0.5">
            {vessels.map((v) => {
              const isActive = v.id === vessel.id;
              return (
                <Link key={v.id} href={`/vessel/${v.id}`}>
                  <button
                    className={cn(
                      "w-full text-left px-2.5 py-2 rounded-md text-xs transition-colors",
                      isActive
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:text-foreground hover-elevate"
                    )}
                    data-testid={`sidebar-vessel-${v.id}`}
                  >
                    <div className="truncate font-medium">{v.name}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="font-mono text-[10px] text-muted-foreground">{v.flag}</span>
                      <span className="text-[10px] text-muted-foreground">{v.markets.length} auctions</span>
                    </div>
                  </button>
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="lg:hidden mb-3">
            <Link href="/">
              <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="button-back-fleet-mobile">
                <ChevronLeft className="w-3 h-3" />
                <span>Markets</span>
              </button>
            </Link>
          </div>

          <div className="mb-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold" data-testid="text-selected-vessel">{vessel.name}</h2>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
                  <span className="font-mono" data-testid="text-selected-imo">{vessel.imo}</span>
                  <span className="text-border">|</span>
                  <span>{vessel.flag}</span>
                  <span className="text-border">|</span>
                  <span>{vessel.type}</span>
                  <span className="text-border">|</span>
                  <span>{vessel.route}</span>
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span data-testid="text-market-count">{vessel.markets.length} auctions</span>
                <span className="font-mono" data-testid="text-total-pool">${totalPool.toLocaleString()} pool</span>
                <span data-testid="text-total-bids">{totalBids} bids</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {vessel.markets.map((market) => (
              <AuctionCard key={market.id} market={market} vesselId={vessel.id} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
