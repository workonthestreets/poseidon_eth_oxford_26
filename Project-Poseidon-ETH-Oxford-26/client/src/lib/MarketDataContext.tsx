import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { useAccount } from "wagmi";
import type { Vessel, RFQRequest, RFQSide, MarketActivity } from "./marketLogic";
import { MOCK_VESSELS, generateMarketActivity } from "./marketLogic";

type MarketDataContextType = {
  vessels: Vessel[];
  rfqRequests: RFQRequest[];
  marketActivity: MarketActivity[];
  createRFQ: (vesselId: string, marketId: string, side: RFQSide, pricePerShare: number, numberOfShares: number) => void;
  cancelRFQ: (rfqId: number) => void;
  // Wallet integration
  isWalletConnected: boolean;
  walletAddress: string | undefined;
  depositModalOpen: boolean;
  setDepositModalOpen: (open: boolean) => void;
};

const MarketDataContext = createContext<MarketDataContextType | null>(null);

export function MarketDataProvider({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount();
  const [vessels, setVessels] = useState<Vessel[]>(MOCK_VESSELS);
  const [rfqRequests, setRfqRequests] = useState<RFQRequest[]>([]);
  const [marketActivity, setMarketActivity] = useState<MarketActivity[]>(() =>
    generateMarketActivity(MOCK_VESSELS, 40)
  );
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const rfqIdRef = useRef(1);

  useEffect(() => {
    const interval = setInterval(() => {
      setMarketActivity((prev) => {
        const newEntries = generateMarketActivity(vessels, Math.floor(Math.random() * 2) + 1);
        return [...newEntries, ...prev].slice(0, 100);
      });
    }, 6000);
    return () => clearInterval(interval);
  }, [vessels]);

  const createRFQ = useCallback(
    (vesselId: string, marketId: string, side: RFQSide, pricePerShare: number, numberOfShares: number) => {
      const vessel = vessels.find((v) => v.id === vesselId);
      const market = vessel?.markets.find((m) => m.id === marketId);
      if (!vessel || !market) return;

      const totalPrice = Math.round(pricePerShare * numberOfShares * 100) / 100;

      const rfq: RFQRequest = {
        id: rfqIdRef.current++,
        vesselId,
        vesselName: vessel.name,
        marketId,
        marketName: market.name,
        side,
        pricePerShare,
        numberOfShares,
        totalPrice,
        status: "pending",
        fillPercent: 0,
        timestamp: new Date(),
        icon: market.icon,
      };

      console.log("RFQ created:", rfq);

      setRfqRequests((prev) => [rfq, ...prev]);

      setTimeout(() => {
        setRfqRequests((prev) =>
          prev.map((r) =>
            r.id === rfq.id && r.status === "pending"
              ? { ...r, status: "accepted" as const, fillPercent: Math.floor(Math.random() * 40) + 10 }
              : r
          )
        );
      }, 3000);

      setTimeout(() => {
        setRfqRequests((prev) =>
          prev.map((r) =>
            r.id === rfq.id && r.status === "accepted"
              ? { ...r, status: "filled" as const, fillPercent: 100 }
              : r
          )
        );
      }, 8000);

      setVessels((prev) =>
        prev.map((v) => {
          if (v.id !== vesselId) return v;
          return {
            ...v,
            markets: v.markets.map((m) => {
              if (m.id !== marketId) return m;
              return {
                ...m,
                totalPool: m.totalPool + totalPrice,
                bidCount: m.bidCount + 1,
              };
            }),
          };
        })
      );
    },
    [vessels]
  );

  const cancelRFQ = useCallback((rfqId: number) => {
    setRfqRequests((prev) =>
      prev.map((r) =>
        r.id === rfqId && (r.status === "pending" || r.status === "accepted")
          ? { ...r, status: "cancelled" as const }
          : r
      )
    );
  }, []);

  return (
    <MarketDataContext.Provider value={{ 
      vessels, 
      rfqRequests, 
      marketActivity, 
      createRFQ, 
      cancelRFQ,
      isWalletConnected: isConnected,
      walletAddress: address,
      depositModalOpen,
      setDepositModalOpen,
    }}>
      {children}
    </MarketDataContext.Provider>
  );
}

export function useMarketData() {
  const ctx = useContext(MarketDataContext);
  if (!ctx) throw new Error("useMarketData must be used within MarketDataProvider");
  return ctx;
}
