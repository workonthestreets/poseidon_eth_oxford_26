import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Wallet, DollarSign, ChevronDown, ChevronRight, X, CheckCircle2, XCircle, AlertCircle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Navbar from "@/components/Navbar";
import { useMarketData } from "@/lib/MarketDataContext";
import { cn } from "@/lib/utils";

function getStatusColor(status: string) {
  switch (status) {
    case "filled": return "text-trade-green";
    case "won": return "text-trade-green";
    case "pending": return "text-amber-400";
    case "accepted": return "text-blue-400";
    case "cancelled": return "text-trade-red";
    case "rejected": return "text-trade-red";
    case "lost": return "text-trade-red";
    default: return "text-muted-foreground";
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case "filled": return CheckCircle2;
    case "won": return CheckCircle2;
    case "pending": return Loader2;
    case "accepted": return AlertCircle;
    case "cancelled": return XCircle;
    case "rejected": return XCircle;
    case "lost": return XCircle;
    default: return AlertCircle;
  }
}

export default function Portfolio() {
  const { rfqRequests, cancelRFQ } = useMarketData();
  const [expandedBet, setExpandedBet] = useState<number | null>(null);

  const totalUnderwritten = useMemo(
    () => rfqRequests.reduce((sum, r) => sum + r.totalPrice, 0),
    [rfqRequests]
  );

  const activeCount = rfqRequests.filter((r) => r.status === "pending" || r.status === "accepted").length;
  const filledCount = rfqRequests.filter((r) => r.status === "filled").length;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />

      <div className="flex-1 max-w-[1440px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6">
          <div>
            <h2 className="text-xl font-semibold" data-testid="text-portfolio-title">Portfolio</h2>
            <p className="text-sm text-muted-foreground mt-1">Your placed bets and positions</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap" data-testid="text-portfolio-summary">
            <div className="flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5" />
              <span className="font-mono text-white">${Math.round(totalUnderwritten).toLocaleString()}</span>
              <span>total</span>
            </div>
            <span className="font-mono">{activeCount} active</span>
            <span className="font-mono">{filledCount} filled</span>
          </div>
        </div>

        <div className="space-y-2">
          {rfqRequests.length === 0 ? (
            <Card className="p-8">
              <div className="text-center">
                <Wallet className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground mb-1">No placed bets yet</p>
                <p className="text-xs text-muted-foreground mb-4">Submit an RFQ on any market to start</p>
                <Link href="/">
                  <span className="text-sm text-primary hover:underline cursor-pointer" data-testid="link-browse-markets">Browse Markets</span>
                </Link>
              </div>
            </Card>
          ) : (
            <>
              {rfqRequests.map((rfq) => {
                const isExpanded = expandedBet === rfq.id;
                const StatusIcon = getStatusIcon(rfq.status);
                const canCancel = rfq.status === "pending" || rfq.status === "accepted";

                return (
                  <Card key={rfq.id} className="overflow-visible" data-testid={`card-bet-${rfq.id}`}>
                    <div
                      className="px-4 py-3 flex items-center gap-3 cursor-pointer hover-elevate"
                      onClick={() => setExpandedBet(isExpanded ? null : rfq.id)}
                      data-testid={`button-expand-bet-${rfq.id}`}
                    >
                      <div className={cn("w-1.5 h-8 rounded-full shrink-0", rfq.side === "buy" ? "bg-trade-green" : "bg-trade-red")} />

                      <div className="flex-1 min-w-0 flex items-center gap-4 flex-wrap">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white truncate">{rfq.marketName}</div>
                          <div className="text-xs text-muted-foreground truncate">{rfq.vesselName}</div>
                        </div>

                        <Badge variant="secondary" className={cn("text-[10px] shrink-0", rfq.side === "buy" ? "text-trade-green" : "text-trade-red")}>
                          {rfq.side.toUpperCase()}
                        </Badge>

                        <div className="flex items-center gap-4 text-xs text-muted-foreground ml-auto flex-wrap">
                          <span className="font-mono">{rfq.numberOfShares.toLocaleString()} shares</span>
                          <span className="font-mono">@${rfq.pricePerShare.toFixed(2)}</span>
                          <span className="font-mono font-semibold text-white">${rfq.totalPrice.toLocaleString()}</span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <StatusIcon className={cn("w-3.5 h-3.5", getStatusColor(rfq.status))} />
                          <span className={cn("text-xs font-medium capitalize", getStatusColor(rfq.status))}>
                            {rfq.status}
                          </span>
                        </div>

                        {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 border-t border-border ml-5" data-testid={`detail-bet-${rfq.id}`}>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                          <div>
                            <div className="text-[10px] text-muted-foreground uppercase mb-0.5">Price/Share</div>
                            <div className="text-sm font-mono font-semibold">${rfq.pricePerShare.toFixed(2)}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-muted-foreground uppercase mb-0.5">Shares</div>
                            <div className="text-sm font-mono font-semibold">{rfq.numberOfShares.toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-muted-foreground uppercase mb-0.5">Total</div>
                            <div className="text-sm font-mono font-semibold text-white">${rfq.totalPrice.toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-muted-foreground uppercase mb-0.5">Fill</div>
                            <div className="text-sm font-mono font-semibold">
                              {rfq.fillPercent}%
                            </div>
                            <div className="w-full h-1.5 bg-secondary/50 rounded-full mt-1 overflow-hidden">
                              <div
                                className={cn("h-full rounded-full transition-all", rfq.fillPercent === 100 ? "bg-trade-green" : "bg-blue-400")}
                                style={{ width: `${rfq.fillPercent}%` }}
                              />
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground flex-wrap">
                          <span>
                            Placed: {rfq.timestamp.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </span>
                          <div className="flex items-center gap-2">
                            <Link href={`/vessel/${rfq.vesselId}/market/${rfq.marketId}`}>
                              <span className="text-primary hover:underline cursor-pointer text-xs" data-testid={`link-market-${rfq.id}`}>View Market</span>
                            </Link>
                            {canCancel && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1 text-trade-red border-trade-red/30"
                                onClick={(e) => { e.stopPropagation(); cancelRFQ(rfq.id); }}
                                data-testid={`button-cancel-rfq-${rfq.id}`}
                              >
                                <X className="w-3 h-3" />
                                Cancel
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </Card>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
