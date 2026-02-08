import { useState, lazy, Suspense } from "react";
import { Link } from "wouter";
import { ArrowRight, LayoutGrid, Map, DollarSign, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Navbar from "@/components/Navbar";
import { useMarketData } from "@/lib/MarketDataContext";
import { cn } from "@/lib/utils";

const VesselMap = lazy(() => import("@/components/VesselMap"));

const vesselAccents: Record<string, { dot: string; bar: string }> = {
  v1: { dot: "bg-blue-400", bar: "bg-blue-400/20" },
  v2: { dot: "bg-emerald-400", bar: "bg-emerald-400/20" },
  v3: { dot: "bg-amber-400", bar: "bg-amber-400/20" },
  v4: { dot: "bg-violet-400", bar: "bg-violet-400/20" },
  v5: { dot: "bg-rose-400", bar: "bg-rose-400/20" },
  v6: { dot: "bg-cyan-400", bar: "bg-cyan-400/20" },
  v7: { dot: "bg-orange-400", bar: "bg-orange-400/20" },
  v8: { dot: "bg-pink-400", bar: "bg-pink-400/20" },
  v9: { dot: "bg-teal-400", bar: "bg-teal-400/20" },
};

export default function VesselGallery() {
  const { vessels } = useMarketData();
  const [viewMode, setViewMode] = useState<"grid" | "map">("grid");

  const totalPool = vessels.reduce(
    (sum, v) => sum + v.markets.reduce((s, m) => s + m.totalPool, 0),
    0
  );

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />

      <div className="flex-1 flex flex-col max-w-[1440px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6">
          <div>
            <h2 className="text-xl font-semibold" data-testid="text-gallery-title">Maritime Risk Markets</h2>
            <p className="text-sm text-muted-foreground mt-1">Underwrite pre-departure risk auctions on vessel events</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-4 text-sm text-muted-foreground" data-testid="text-gallery-stats">
              <span>{vessels.length} vessels</span>
              <span className="text-border">|</span>
              <span className="font-mono">${totalPool.toLocaleString()} pool</span>
            </div>
            <div className="flex items-center gap-0.5 p-0.5 bg-secondary/50 rounded-md" data-testid="toggle-view-mode">
              <button
                onClick={() => setViewMode("grid")}
                data-testid="button-view-grid"
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors",
                  viewMode === "grid"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground"
                )}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Grid</span>
              </button>
              <button
                onClick={() => setViewMode("map")}
                data-testid="button-view-map"
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors",
                  viewMode === "map"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground"
                )}
              >
                <Map className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Map</span>
              </button>
            </div>
          </div>
        </div>

        {viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {vessels.map((vessel) => {
              const vesselPool = vessel.markets.reduce((sum, m) => sum + m.totalPool, 0);
              const vesselBids = vessel.markets.reduce((sum, m) => sum + m.bidCount, 0);
              const accent = vesselAccents[vessel.id] || vesselAccents.v1;
              const openAuctions = vessel.markets.filter((m) => m.auctionCloseTime.getTime() > Date.now()).length;

              return (
                <Link key={vessel.id} href={`/vessel/${vessel.id}`}>
                  <Card
                    className="hover-elevate cursor-pointer overflow-visible group"
                    data-testid={`card-vessel-${vessel.id}`}
                  >
                    <div className="p-4 flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", accent.dot)} />
                          <h3 className="font-semibold text-base truncate" data-testid={`text-vessel-card-name-${vessel.id}`}>{vessel.name}</h3>
                        </div>
                        <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>

                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>{vessel.type}</span>
                        <span className="text-border">-</span>
                        <span>{vessel.route}</span>
                      </div>

                      <div className="flex items-center justify-between gap-3 pt-2 border-t border-border">
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <DollarSign className="w-3 h-3" />
                            <span className="font-mono">${vesselPool.toLocaleString()}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            <span className="font-mono">{vesselBids}</span>
                          </div>
                        </div>
                        <Badge
                          variant="secondary"
                          className={cn("text-[10px]", openAuctions > 0 ? "text-trade-green" : "text-muted-foreground")}
                          data-testid={`badge-open-auctions-${vessel.id}`}
                        >
                          {openAuctions} open
                        </Badge>
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="flex-1 min-h-0" style={{ minHeight: "calc(100vh - 200px)" }}>
            <Suspense
              fallback={
                <div className="w-full h-full flex items-center justify-center text-sm text-muted-foreground">
                  Loading map...
                </div>
              }
            >
              <VesselMap vessels={vessels} />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}
