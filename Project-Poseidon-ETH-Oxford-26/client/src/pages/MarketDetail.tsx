import { useState, useEffect, useRef } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { ChevronLeft, Clock, Anchor, DollarSign, TrendingUp, ArrowUpDown, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import Navbar from "@/components/Navbar";
import { useMarketData } from "@/lib/MarketDataContext";
import type { RFQSide } from "@/lib/marketLogic";

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
  const seconds = Math.floor((diff % 60000) / 1000);
  const isOpen = diff > 0;

  return {
    hours,
    minutes,
    seconds,
    isOpen,
    display: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`,
  };
}

export default function MarketDetail() {
  const [, params] = useRoute("/vessel/:vesselId/market/:marketId");
  const { vessels, createRFQ, rfqRequests } = useMarketData();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [side, setSide] = useState<RFQSide>("buy");
  const [pricePerShare, setPricePerShare] = useState("");
  const [numberOfShares, setNumberOfShares] = useState("");

  const vesselId = params?.vesselId;
  const marketId = params?.marketId;
  const vessel = vessels.find((v) => v.id === vesselId);
  const market = vessel?.markets.find((m) => m.id === marketId);

  const countdown = useCountdown(market?.auctionCloseTime ?? new Date());

  const marketRFQs = rfqRequests.filter(
    (r) => r.vesselId === vesselId && r.marketId === marketId
  );

  if (!vessel || !market) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="p-6 text-center">
          <h2 className="text-base font-semibold mb-2">Market Not Found</h2>
          <Link href="/">
            <Button variant="outline" data-testid="button-back-gallery">Back to Markets</Button>
          </Link>
        </Card>
      </div>
    );
  }

  const pps = parseFloat(pricePerShare) || 0;
  const nos = parseFloat(numberOfShares) || 0;
  const totalPrice = Math.round(pps * nos * 100) / 100;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pps <= 0 || pps > 1) {
      toast({ title: "Invalid Price", description: "Price per share must be between $0.01 and $1.00.", variant: "destructive" });
      return;
    }
    if (nos <= 0) {
      toast({ title: "Invalid Shares", description: "Enter a positive number of shares.", variant: "destructive" });
      return;
    }
    if (!countdown.isOpen) {
      toast({ title: "Auction Closed", description: "This auction has already closed.", variant: "destructive" });
      return;
    }
    createRFQ(vessel.id, market.id, side, pps, nos);
    toast({ title: "RFQ Created", description: `${side.toUpperCase()} ${nos} shares @ $${pps.toFixed(2)} on ${market.name}` });
    setPricePerShare("");
    setNumberOfShares("");
  };

  const Icon = market.icon;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />

      <div className="flex-1 max-w-[1440px] mx-auto w-full px-4 sm:px-6 lg:px-8 py-5">
        <div className="mb-4">
          <Link href={`/vessel/${vessel.id}`}>
            <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3" data-testid="button-back-vessel">
              <ChevronLeft className="w-3 h-3" />
              <span>{vessel.name}</span>
            </button>
          </Link>

          <div className="flex items-center gap-1 mb-4 border-b border-border">
            {vessel.markets.map((m) => {
              const isActive = m.id === market.id;
              const MIcon = m.icon;
              return (
                <button
                  key={m.id}
                  onClick={() => navigate(`/vessel/${vessel.id}/market/${m.id}`)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px",
                    isActive
                      ? "border-foreground text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                  data-testid={`tab-market-${m.id}`}
                >
                  <MIcon className="w-3.5 h-3.5" />
                  <span>{m.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-7 space-y-4">
            <Card>
              <div className="p-5">
                <div className="flex items-start gap-3 mb-4">
                  <div className="p-2 rounded-md bg-primary/10">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-bold text-white" data-testid="text-market-title">{market.name}</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">{market.description}</p>
                  </div>
                  <Badge
                    variant="secondary"
                    className={cn("shrink-0", countdown.isOpen ? "text-trade-green" : "text-trade-red")}
                    data-testid="badge-auction-status"
                  >
                    {countdown.isOpen ? "Auction Open" : "Auction Closed"}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <Anchor className="w-3.5 h-3.5 text-muted-foreground" />
                    <div>
                      <span className="text-muted-foreground">Vessel</span>
                      <div className="font-medium">{vessel.name}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <DollarSign className="w-3.5 h-3.5 text-muted-foreground" />
                    <div>
                      <span className="text-muted-foreground">Route</span>
                      <div className="font-medium">{vessel.route}</div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            <Card>
              <div className="px-5 py-3 border-b border-border">
                <span className="text-sm font-medium">Auction Status</span>
              </div>
              <div className="p-5">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Time remaining</span>
                  </div>
                  <div className={cn(
                    "font-mono text-2xl font-semibold tabular-nums",
                    countdown.isOpen ? "text-white" : "text-trade-red"
                  )} data-testid="text-countdown">
                    {countdown.isOpen ? countdown.display : "00:00:00"}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 rounded-md bg-secondary/30 border border-border">
                    <div className="text-[10px] text-muted-foreground uppercase mb-1">Best Bid</div>
                    <div className="text-lg font-mono font-bold text-white" data-testid="text-best-bid">
                      ${market.bestBid.toFixed(2)}
                    </div>
                  </div>
                  <div className="p-3 rounded-md bg-secondary/30 border border-border">
                    <div className="text-[10px] text-muted-foreground uppercase mb-1">Total Pool</div>
                    <div className="text-sm font-mono font-semibold" data-testid="text-total-pool">
                      ${market.totalPool.toLocaleString()}
                    </div>
                  </div>
                  <div className="p-3 rounded-md bg-secondary/30 border border-border">
                    <div className="text-[10px] text-muted-foreground uppercase mb-1">Auction closes</div>
                    <div className="text-xs font-medium" data-testid="text-auction-close-time">
                      {market.auctionCloseTime.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  <div className="p-3 rounded-md bg-secondary/30 border border-border">
                    <div className="text-[10px] text-muted-foreground uppercase mb-1">Bids</div>
                    <div className="text-sm font-mono font-semibold" data-testid="text-bid-count">
                      {market.bidCount}
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            <Card>
              <div className="px-5 py-3 border-b border-border flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Market Rules</span>
              </div>
              <div className="p-5">
                <ul className="space-y-2">
                  {market.rules.map((rule, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground leading-relaxed">
                      <span className="text-foreground/50 font-mono shrink-0 mt-0.5">{i + 1}.</span>
                      <span>{rule}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 pt-3 border-t border-border flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                  <span>Market created: {new Date(Date.now() - 86400000).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}</span>
                  <span>Departure: {market.departureTime.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              </div>
            </Card>

            {marketRFQs.length > 0 && (
              <Card>
                <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">Your Requests</span>
                  <span className="text-xs text-muted-foreground font-mono">{marketRFQs.length}</span>
                </div>
                <div>
                  <div className="grid grid-cols-6 text-[10px] text-muted-foreground uppercase px-5 py-2 border-b border-border/50">
                    <span>Time</span>
                    <span>Side</span>
                    <span className="text-right">Price/Share</span>
                    <span className="text-right">Shares</span>
                    <span className="text-right">Total</span>
                    <span className="text-right">Status</span>
                  </div>
                  {marketRFQs.map((rfq) => (
                    <div key={rfq.id} className="grid grid-cols-6 text-xs font-mono px-5 py-2.5 border-b border-border/30" data-testid={`row-rfq-${rfq.id}`}>
                      <span className="text-muted-foreground">
                        {rfq.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      <span className={rfq.side === "buy" ? "text-trade-green" : "text-trade-red"}>
                        {rfq.side.toUpperCase()}
                      </span>
                      <span className="text-right font-medium">${rfq.pricePerShare.toFixed(2)}</span>
                      <span className="text-right">{rfq.numberOfShares.toLocaleString()}</span>
                      <span className="text-right font-medium">${rfq.totalPrice.toLocaleString()}</span>
                      <span className="text-right">
                        <Badge
                          variant="secondary"
                          className={cn("text-[9px]",
                            rfq.status === "filled" && "text-trade-green",
                            rfq.status === "pending" && "text-amber-400",
                            rfq.status === "accepted" && "text-blue-400",
                            rfq.status === "cancelled" && "text-trade-red",
                            rfq.status === "rejected" && "text-trade-red"
                          )}
                        >
                          {rfq.status === "accepted" ? `${rfq.fillPercent}% filled` : rfq.status}
                        </Badge>
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>

          <div className="lg:col-span-5 space-y-4">
            <Card>
              <div className="px-5 py-4 border-b border-border">
                <span className="text-lg font-bold text-white">Request for Quote (RFQ)</span>
              </div>
              <div className="p-5">
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <Label className="text-sm text-muted-foreground mb-2 block">Side</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(
                          "text-sm font-semibold transition-all",
                          side === "buy" 
                            ? "border-2 border-white bg-trade-green/20 text-white" 
                            : "border border-border text-muted-foreground hover:text-white hover:border-white/50"
                        )}
                        onClick={() => setSide("buy")}
                        data-testid="button-side-buy"
                      >
                        <TrendingUp className="w-4 h-4 mr-1.5" />
                        BUY
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(
                          "text-sm font-semibold transition-all",
                          side === "sell" 
                            ? "border-2 border-white bg-trade-red/20 text-white" 
                            : "border border-border text-muted-foreground hover:text-white hover:border-white/50"
                        )}
                        onClick={() => setSide("sell")}
                        data-testid="button-side-sell"
                      >
                        <ArrowUpDown className="w-4 h-4 mr-1.5" />
                        SELL
                      </Button>
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm text-muted-foreground mb-1 block">Price per Share ($)</Label>
                    <Input
                      type="number"
                      min="0.01"
                      max="1.00"
                      step="0.01"
                      placeholder="0.82"
                      value={pricePerShare}
                      onChange={(e) => setPricePerShare(e.target.value)}
                      className="font-mono text-lg h-12"
                      data-testid="input-price-per-share"
                    />
                    <div className="text-[11px] text-muted-foreground mt-1">
                      Best bid right now: <span className="text-white font-mono font-semibold">${market.bestBid.toFixed(2)}</span>
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm text-muted-foreground mb-1 block">Number of Shares</Label>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="1,000"
                      value={numberOfShares}
                      onChange={(e) => setNumberOfShares(e.target.value)}
                      className="font-mono text-lg h-12"
                      data-testid="input-number-of-shares"
                    />
                  </div>

                  <div className="p-4 rounded-md bg-secondary/40 border border-border">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-muted-foreground">Total Price</span>
                      <span className="font-mono text-2xl font-bold text-white" data-testid="text-total-price">
                        ${totalPrice > 0 ? totalPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00"}
                      </span>
                    </div>
                    {pps > 0 && nos > 0 && (
                      <div className="text-[11px] text-muted-foreground mt-1 text-right">
                        {nos.toLocaleString()} shares x ${pps.toFixed(2)}/share
                      </div>
                    )}
                  </div>

                  <Button
                    type="submit"
                    disabled={!countdown.isOpen}
                    size="lg"
                    className={cn(
                      "w-full text-base font-bold h-14",
                      side === "buy"
                        ? "bg-trade-green hover:bg-trade-green/90 text-white border-trade-green"
                        : "bg-trade-red hover:bg-trade-red/90 text-white border-trade-red"
                    )}
                    data-testid="button-place-bid"
                  >
                    {countdown.isOpen
                      ? `${side === "buy" ? "BUY" : "SELL"} — Submit RFQ`
                      : "Auction Closed"}
                  </Button>
                </form>
              </div>
            </Card>

            <Card>
              <div className="px-5 py-3 border-b border-border">
                <span className="text-sm font-medium">Market Info</span>
              </div>
              <div className="p-5 space-y-2.5 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Vessel</span>
                  <span className="font-medium text-right">{vessel.name}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">IMO</span>
                  <span className="font-mono">{vessel.imo}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Flag</span>
                  <span>{vessel.flag}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Type</span>
                  <span>{vessel.type}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Route</span>
                  <span className="text-right">{vessel.route}</span>
                </div>
                <div className="border-t border-border pt-2.5 flex justify-between gap-2">
                  <span className="text-muted-foreground">Settlement</span>
                  <span className="font-medium">Post-voyage</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Market Type</span>
                  <span className="font-medium">Binary RFQ Auction</span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
