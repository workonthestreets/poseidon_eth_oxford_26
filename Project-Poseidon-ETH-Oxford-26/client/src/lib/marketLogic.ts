import { Shield, Skull, Navigation } from "lucide-react";

export type RiskMarket = {
  id: string;
  name: string;
  description: string;
  icon: typeof Shield;
  estimatedProbability: number;
  auctionCloseTime: Date;
  departureTime: Date;
  totalPool: number;
  bidCount: number;
  bestBid: number;
  rules: string[];
};

export type Vessel = {
  id: string;
  name: string;
  imo: string;
  flag: string;
  type: string;
  route: string;
  dwt: string;
  lat: number;
  lng: number;
  markets: RiskMarket[];
};

export type RFQSide = "buy" | "sell";

export type RFQStatus = "pending" | "accepted" | "rejected" | "filled" | "cancelled" | "won" | "lost";

export type RFQRequest = {
  id: number;
  vesselId: string;
  vesselName: string;
  marketId: string;
  marketName: string;
  side: RFQSide;
  pricePerShare: number;
  numberOfShares: number;
  totalPrice: number;
  status: RFQStatus;
  fillPercent: number;
  timestamp: Date;
  icon: typeof Shield;
};

export type MarketActivity = {
  id: number;
  vesselId: string;
  vesselName: string;
  marketId: string;
  marketName: string;
  side: RFQSide;
  pricePerShare: number;
  numberOfShares: number;
  totalPrice: number;
  status: "filled" | "pending" | "accepted";
  trader: string;
  timestamp: Date;
};

const TRADER_NAMES = [
  "Meridian Capital", "Triton Risk", "Harbor Point", "Vanguard Maritime",
  "Anchor Insurance", "Blue Horizon", "Neptune Re", "Compass Underwriting",
  "Oceanic Partners", "Signal Group", "Broadwater Capital", "Ironshore",
  "Maersk Re", "Pacific Rim Capital", "SeaRisk Ltd", "Atlas Maritime",
];

let activityIdCounter = 1000;

export function generateMarketActivity(vessels: Vessel[], count: number): MarketActivity[] {
  const activities: MarketActivity[] = [];
  for (let i = 0; i < count; i++) {
    const vessel = vessels[Math.floor(Math.random() * vessels.length)];
    const market = vessel.markets[Math.floor(Math.random() * vessel.markets.length)];
    const side: RFQSide = Math.random() > 0.45 ? "buy" : "sell";
    const spread = (Math.random() - 0.5) * 0.12;
    const price = Math.max(0.01, Math.min(0.99, Math.round((market.bestBid + spread) * 100) / 100));
    const shares = Math.floor(Math.random() * 900 + 100);
    const statuses: Array<"filled" | "pending" | "accepted"> = ["filled", "filled", "filled", "pending", "accepted"];
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const minutesAgo = Math.floor(Math.random() * 120);

    activities.push({
      id: activityIdCounter++,
      vesselId: vessel.id,
      vesselName: vessel.name,
      marketId: market.id,
      marketName: market.name,
      side,
      pricePerShare: price,
      numberOfShares: shares,
      totalPrice: Math.round(price * shares * 100) / 100,
      status,
      trader: TRADER_NAMES[Math.floor(Math.random() * TRADER_NAMES.length)],
      timestamp: new Date(Date.now() - minutesAgo * 60 * 1000),
    });
  }
  return activities.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

const PSC_RULES = [
  "Binary outcome: Vessel either passes PSC inspection without detention, or is detained",
  "Settlement based on official PSC inspection report at destination port",
  "Auction closes before vessel departure — no bids accepted after close",
  "Payout calculated as: Amount / Probability for the outcome that occurs",
  "If vessel does not reach destination port, market is voided and bids refunded",
];

const CASUALTY_RULES = [
  "Binary outcome: Vessel either suffers a major casualty/total loss, or completes voyage safely",
  "Major casualty defined per IMO guidelines: sinking, grounding with damage, fire causing structural damage",
  "Settlement verified through maritime authority incident reports",
  "Auction closes before vessel departure — no bids accepted after close",
  "Payout calculated as: Amount / Probability for the outcome that occurs",
];

const VOYAGE_RULES = [
  "Binary outcome: Vessel either completes scheduled voyage on time (+/- 48h), or fails to complete",
  "Completion defined as arrival at scheduled destination with cargo intact",
  "Delays beyond 48 hours of ETA count as non-completion",
  "Auction closes before vessel departure — no bids accepted after close",
  "Payout calculated as: Amount / Probability for the outcome that occurs",
];

function createDefaultMarkets(): RiskMarket[] {
  return [
    {
      id: "psc",
      name: "PSC Clearance",
      description: "Will this vessel pass Port State Control inspection without detention?",
      icon: Shield,
      estimatedProbability: 0.82,
      auctionCloseTime: hoursFromNow(18),
      departureTime: hoursFromNow(24),
      totalPool: 125000,
      bidCount: 47,
      bestBid: 0.84,
      rules: PSC_RULES,
    },
    {
      id: "casualty",
      name: "Casualty / Sinking",
      description: "Will this vessel suffer a major casualty or total loss during voyage?",
      icon: Skull,
      estimatedProbability: 0.04,
      auctionCloseTime: hoursFromNow(22),
      departureTime: hoursFromNow(28),
      totalPool: 340000,
      bidCount: 112,
      bestBid: 0.05,
      rules: CASUALTY_RULES,
    },
    {
      id: "voyage",
      name: "Voyage Completion",
      description: "Will this vessel complete its scheduled voyage on time and in full?",
      icon: Navigation,
      estimatedProbability: 0.88,
      auctionCloseTime: hoursFromNow(14),
      departureTime: hoursFromNow(20),
      totalPool: 89000,
      bidCount: 31,
      bestBid: 0.90,
      rules: VOYAGE_RULES,
    },
  ];
}

export const MOCK_VESSELS: Vessel[] = [
  {
    id: "v1",
    name: "MV Pacific Sentinel",
    imo: "IMO 9876543",
    flag: "Panama",
    type: "Bulk Carrier",
    route: "Shanghai - Rotterdam",
    dwt: "82,000 DWT",
    lat: 29.5,
    lng: 78.2,
    markets: createDefaultMarkets(),
  },
  {
    id: "v2",
    name: "MV Atlantic Horizon",
    imo: "IMO 9234567",
    flag: "Liberia",
    type: "Container Ship",
    route: "Singapore - Los Angeles",
    dwt: "65,000 DWT",
    lat: 21.3,
    lng: -157.8,
    markets: createDefaultMarkets(),
  },
  {
    id: "v3",
    name: "MV Nordic Aurora",
    imo: "IMO 9345678",
    flag: "Marshall Islands",
    type: "Oil Tanker",
    route: "Ras Tanura - Houston",
    dwt: "120,000 DWT",
    lat: 14.6,
    lng: -52.3,
    markets: createDefaultMarkets(),
  },
  {
    id: "v4",
    name: "MV Caspian Voyager",
    imo: "IMO 9456789",
    flag: "Singapore",
    type: "LNG Carrier",
    route: "Doha - Yokohama",
    dwt: "95,000 DWT",
    lat: 12.8,
    lng: 100.5,
    markets: createDefaultMarkets(),
  },
  {
    id: "v5",
    name: "MV Iron Meridian",
    imo: "IMO 9567890",
    flag: "Hong Kong",
    type: "Bulk Carrier",
    route: "Port Hedland - Qingdao",
    dwt: "180,000 DWT",
    lat: 2.1,
    lng: 115.4,
    markets: createDefaultMarkets(),
  },
  {
    id: "v6",
    name: "MV Emerald Strait",
    imo: "IMO 9678901",
    flag: "Greece",
    type: "Chemical Tanker",
    route: "Antwerp - Mumbai",
    dwt: "45,000 DWT",
    lat: 12.3,
    lng: 43.1,
    markets: createDefaultMarkets(),
  },
  {
    id: "v7",
    name: "MV Southern Cross",
    imo: "IMO 9789012",
    flag: "Bahamas",
    type: "Container Ship",
    route: "Santos - Hamburg",
    dwt: "72,000 DWT",
    lat: -5.2,
    lng: -20.8,
    markets: createDefaultMarkets(),
  },
  {
    id: "v8",
    name: "MV Arctic Pioneer",
    imo: "IMO 9890123",
    flag: "Norway",
    type: "Ice-Class Tanker",
    route: "Murmansk - Rotterdam",
    dwt: "110,000 DWT",
    lat: 62.5,
    lng: 6.1,
    markets: createDefaultMarkets(),
  },
  {
    id: "v9",
    name: "MV Bengal Tiger",
    imo: "IMO 9901234",
    flag: "India",
    type: "Bulk Carrier",
    route: "Paradip - Busan",
    dwt: "58,000 DWT",
    lat: 16.4,
    lng: 91.7,
    markets: createDefaultMarkets(),
  },
];
