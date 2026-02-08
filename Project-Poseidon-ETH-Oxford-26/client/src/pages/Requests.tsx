import { useState, useMemo } from "react";
import { Link } from "wouter";
import {
  FileText, ArrowUpDown, Clock, X, Filter,
  CheckCircle2, Loader2, AlertCircle, XCircle, Activity,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export default function Requests() {
  const { vessels, rfqRequests, marketActivity, cancelRFQ } = useMarketData();
  const [activeTab, setActiveTab] = useState<"activity" | "yours">("activity");
  const [vesselFilter, setVesselFilter] = useState<string>("all");
  const [marketFilter, setMarketFilter] = useState<string>("all");
  const [sideFilter, setSideFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filteredActivity = useMemo(() => {
    return marketActivity.filter((a) => {
      if (vesselFilter !== "all" && a.vesselId !== vesselFilter) return false;
      if (marketFilter !== "all" && a.marketId !== marketFilter) return false;
      if (sideFilter !== "all" && a.side !== sideFilter) return false;
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      return true;
    });
  }, [marketActivity, vesselFilter, marketFilter, sideFilter, statusFilter]);

  const filteredRequests = useMemo(() => {
    return rfqRequests.filter((r) => {
      if (vesselFilter !== "all" && r.vesselId !== vesselFilter) return false;
      if (marketFilter !== "all" && r.marketId !== marketFilter) return false;
      if (sideFilter !== "all" && r.side !== sideFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      return true;
    });
  }, [rfqRequests, vesselFilter, marketFilter, sideFilter, statusFilter]);

  const activeCount = rfqRequests.filter((r) => r.status === "pending" || r.status === "accepted").length;

  const activityStats = useMemo(() => {
    const buys = marketActivity.filter((a) => a.side === "buy").length;
    const sells = marketActivity.filter((a) => a.side === "sell").length;
    const totalVolume = marketActivity.reduce((sum, a) => sum + a.totalPrice, 0);
    return { buys, sells, totalVolume };
  }, [marketActivity]);

  const clearFilters = () => {
    setVesselFilter("all");
    setMarketFilter("all");
    setSideFilter("all");
    setStatusFilter("all");
  };

  const hasFilters = vesselFilter !== "all" || marketFilter !== "all" || sideFilter !== "all" || statusFilter !== "all";

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />

      <div className="flex-1 max-w-[1440px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-6">
          <div>
            <h2 className="text-xl font-semibold" data-testid="text-requests-title">Requests</h2>
            <p className="text-sm text-muted-foreground mt-1">Marketplace order flow and your RFQ requests</p>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground" data-testid="text-requests-stats">
            <div className="flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" />
              <span className="font-mono">{marketActivity.length}</span>
              <span>live orders</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-trade-green">{activityStats.buys}B</span>
              <span>/</span>
              <span className="font-mono text-trade-red">{activityStats.sells}S</span>
            </div>
            <div className="font-mono">
              ${Math.round(activityStats.totalVolume).toLocaleString()} vol
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 mb-4 border-b border-border">
          <button
            onClick={() => setActiveTab("activity")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px",
              activeTab === "activity"
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            data-testid="tab-market-activity"
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            Market Activity
          </button>
          <button
            onClick={() => setActiveTab("yours")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px",
              activeTab === "yours"
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            data-testid="tab-your-requests"
          >
            <FileText className="w-3.5 h-3.5" />
            Your Requests
            {activeCount > 0 && (
              <Badge variant="secondary" className="text-[9px] ml-1">{activeCount}</Badge>
            )}
          </button>
        </div>

        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <Select value={vesselFilter} onValueChange={setVesselFilter}>
            <SelectTrigger className="w-[160px] h-8 text-xs" data-testid="select-vessel-filter">
              <SelectValue placeholder="All Vessels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Vessels</SelectItem>
              {vessels.map((v) => (
                <SelectItem key={v.id} value={v.id}>{v.name.replace("MV ", "")}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={marketFilter} onValueChange={setMarketFilter}>
            <SelectTrigger className="w-[140px] h-8 text-xs" data-testid="select-market-filter">
              <SelectValue placeholder="All Markets" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Markets</SelectItem>
              <SelectItem value="psc">PSC Clearance</SelectItem>
              <SelectItem value="casualty">Casualty / Sinking</SelectItem>
              <SelectItem value="voyage">Voyage Completion</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sideFilter} onValueChange={setSideFilter}>
            <SelectTrigger className="w-[100px] h-8 text-xs" data-testid="select-side-filter">
              <SelectValue placeholder="All Sides" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sides</SelectItem>
              <SelectItem value="buy">Buy</SelectItem>
              <SelectItem value="sell">Sell</SelectItem>
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[110px] h-8 text-xs" data-testid="select-status-filter">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="accepted">Accepted</SelectItem>
              <SelectItem value="filled">Filled</SelectItem>
              {activeTab === "yours" && <SelectItem value="cancelled">Cancelled</SelectItem>}
            </SelectContent>
          </Select>

          {hasFilters && (
            <Button size="sm" variant="ghost" onClick={clearFilters} className="gap-1 text-xs" data-testid="button-clear-filters">
              <X className="w-3 h-3" />
              Clear
            </Button>
          )}
        </div>

        {activeTab === "activity" && (
          <Card className="overflow-hidden" data-testid="card-market-activity">
            <div className="hidden sm:grid grid-cols-9 text-[10px] text-muted-foreground uppercase px-4 py-2.5 border-b border-border/50">
              <span>Time</span>
              <span>Trader</span>
              <span>Vessel</span>
              <span>Market</span>
              <span>Side</span>
              <span className="text-right">Price</span>
              <span className="text-right">Shares</span>
              <span className="text-right">Total</span>
              <span className="text-right">Status</span>
            </div>
            {filteredActivity.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No matching activity found
              </div>
            ) : (
              filteredActivity.map((a) => {
                const StatusIcon = getStatusIcon(a.status);
                return (
                  <div
                    key={a.id}
                    className="grid grid-cols-2 sm:grid-cols-9 gap-1 sm:gap-0 text-xs px-4 py-2.5 border-b border-border/20 items-center"
                    data-testid={`row-activity-${a.id}`}
                  >
                    <span className="font-mono text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3 shrink-0 hidden sm:block" />
                      {timeAgo(a.timestamp)}
                    </span>
                    <span className="truncate text-muted-foreground">{a.trader}</span>
                    <Link href={`/vessel/${a.vesselId}`}>
                      <span className="truncate cursor-pointer hover:underline text-muted-foreground">{a.vesselName.replace("MV ", "")}</span>
                    </Link>
                    <Link href={`/vessel/${a.vesselId}/market/${a.marketId}`}>
                      <span className="text-white font-medium truncate cursor-pointer hover:underline">{a.marketName}</span>
                    </Link>
                    <span className={cn("font-medium", a.side === "buy" ? "text-trade-green" : "text-trade-red")}>
                      {a.side.toUpperCase()}
                    </span>
                    <span className="font-mono text-right">${a.pricePerShare.toFixed(2)}</span>
                    <span className="font-mono text-right">{a.numberOfShares.toLocaleString()}</span>
                    <span className="font-mono text-right font-medium text-white">${a.totalPrice.toLocaleString()}</span>
                    <div className="flex items-center justify-end gap-1">
                      <StatusIcon className={cn("w-3 h-3", getStatusColor(a.status))} />
                      <span className={cn("capitalize text-[10px]", getStatusColor(a.status))}>
                        {a.status}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </Card>
        )}

        {activeTab === "yours" && (
          <div className="space-y-3" data-testid="section-your-requests">
            {filteredRequests.length === 0 && rfqRequests.length === 0 ? (
              <Card className="p-8">
                <div className="text-center">
                  <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground mb-1">No requests yet</p>
                  <p className="text-xs text-muted-foreground mb-4">Go to any market and submit an RFQ</p>
                  <Link href="/">
                    <span className="text-sm text-primary hover:underline cursor-pointer" data-testid="link-browse-markets">Browse Markets</span>
                  </Link>
                </div>
              </Card>
            ) : filteredRequests.length === 0 ? (
              <Card className="p-8">
                <div className="text-center text-sm text-muted-foreground">
                  No requests match the current filters
                </div>
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="hidden sm:grid grid-cols-8 text-[10px] text-muted-foreground uppercase px-4 py-2.5 border-b border-border/50">
                  <span>Time</span>
                  <span>Market</span>
                  <span>Vessel</span>
                  <span>Side</span>
                  <span className="text-right">Price/Share</span>
                  <span className="text-right">Shares</span>
                  <span className="text-right">Total</span>
                  <span className="text-right">Status</span>
                </div>
                {filteredRequests.map((rfq) => {
                  const canCancel = rfq.status === "pending" || rfq.status === "accepted";
                  const StatusIcon = getStatusIcon(rfq.status);

                  return (
                    <div
                      key={rfq.id}
                      className="grid grid-cols-2 sm:grid-cols-8 gap-1 sm:gap-0 text-xs px-4 py-3 border-b border-border/30 items-center"
                      data-testid={`row-request-${rfq.id}`}
                    >
                      <span className="font-mono text-muted-foreground">
                        {rfq.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      <Link href={`/vessel/${rfq.vesselId}/market/${rfq.marketId}`}>
                        <span className="text-white font-medium truncate cursor-pointer hover:underline">{rfq.marketName}</span>
                      </Link>
                      <span className="truncate text-muted-foreground">{rfq.vesselName}</span>
                      <span className={rfq.side === "buy" ? "text-trade-green font-medium" : "text-trade-red font-medium"}>
                        {rfq.side.toUpperCase()}
                      </span>
                      <span className="font-mono text-right">${rfq.pricePerShare.toFixed(2)}</span>
                      <span className="font-mono text-right">{rfq.numberOfShares.toLocaleString()}</span>
                      <span className="font-mono text-right font-medium text-white">${rfq.totalPrice.toLocaleString()}</span>
                      <div className="flex items-center justify-end gap-2">
                        <div className="flex items-center gap-1">
                          <StatusIcon className={cn("w-3 h-3", getStatusColor(rfq.status))} />
                          <Badge
                            variant="secondary"
                            className={cn("text-[9px]", getStatusColor(rfq.status))}
                          >
                            {rfq.status === "accepted" ? `${rfq.fillPercent}%` : rfq.status}
                          </Badge>
                        </div>
                        {canCancel && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-trade-red"
                            onClick={() => cancelRFQ(rfq.id)}
                            data-testid={`button-cancel-request-${rfq.id}`}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
