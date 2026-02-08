import express, { Request, Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { quoteEngine } from './QuoteEngine.js';
import { positionManager } from './PositionManager.js';
import { QuoteRequest, ShareSide, Direction } from './types.js';

// Route param types
type IdParams = { id: string };
type ImoParams = { imo: string };
type UserIdParams = { userId: string };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, '../../public')));

// CORS for dev
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  next();
});

// Track WebSocket clients by market
const marketSubscribers: Map<string, Set<WebSocket>> = new Map();

function broadcast(marketId: string, message: object): void {
  const subscribers = marketSubscribers.get(marketId);
  if (!subscribers) return;
  const data = JSON.stringify(message);
  subscribers.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

function broadcastAll(message: object): void {
  const data = JSON.stringify(message);
  wss.clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });
}

// WebSocket handling
wss.on('connection', (ws: WebSocket) => {
  let subscribedMarket: string | null = null;

  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'SUBSCRIBE' && msg.marketId) {
        if (subscribedMarket) {
          marketSubscribers.get(subscribedMarket)?.delete(ws);
        }

        subscribedMarket = msg.marketId as string;
        if (!marketSubscribers.has(subscribedMarket)) {
          marketSubscribers.set(subscribedMarket, new Set());
        }
        marketSubscribers.get(subscribedMarket)!.add(ws);

        // Send current market state
        const stats = quoteEngine.getMarketStats(subscribedMarket);
        if (stats) {
          ws.send(JSON.stringify({ type: 'MARKET_UPDATE', data: stats }));
        }
      }
    } catch (e) {
      console.error('WebSocket message error:', e);
    }
  });

  ws.on('close', () => {
    if (subscribedMarket) {
      marketSubscribers.get(subscribedMarket)?.delete(ws);
    }
  });
});

// ==========================================
// MARKET ENDPOINTS
// ==========================================

// Get all markets
app.get('/api/markets', (_req: Request, res: Response) => {
  const markets = quoteEngine.getAllMarkets();
  const marketsWithPrices = markets.map(m => {
    const prices = quoteEngine.getMarketPrices(m.id);
    return { ...m, ...prices };
  });
  res.json(marketsWithPrices);
});

// Get market details
app.get('/api/markets/:id', (req: Request<IdParams>, res: Response) => {
  const stats = quoteEngine.getMarketStats(req.params.id);
  if (!stats) {
    res.status(404).json({ error: 'Market not found' });
    return;
  }
  res.json(stats);
});

// Create market (admin)
app.post('/api/markets', (req: Request, res: Response) => {
  try {
    const market = quoteEngine.createMarket({
      vesselName: req.body.vesselName,
      vesselIMO: req.body.vesselIMO,
      description: req.body.description || `Will ${req.body.vesselName} be detained?`,
      expiresAt: new Date(req.body.expiresAt || Date.now() + 7 * 24 * 60 * 60 * 1000)
    });
    res.status(201).json(market);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Settle market (admin/oracle)
app.post('/api/markets/:id/settle', (req: Request<IdParams>, res: Response) => {
  const { outcome } = req.body; // true = YES wins, false = NO wins
  const marketId = req.params.id;

  const market = quoteEngine.settleMarket(marketId, outcome);
  if (!market) {
    res.status(400).json({ error: 'Cannot settle market' });
    return;
  }

  // Settle positions and get payouts
  const payouts = positionManager.settleMarket(marketId, outcome);

  broadcast(marketId, { type: 'MARKET_SETTLED', data: { market, payouts: Object.fromEntries(payouts) } });
  res.json({ market, payouts: Object.fromEntries(payouts) });
});

// ==========================================
// RFQ ENDPOINTS
// ==========================================

// Request a quote
app.post('/api/quotes/request', (req: Request, res: Response) => {
  try {
    const request: QuoteRequest = {
      marketId: req.body.marketId,
      userId: req.body.userId,
      side: req.body.side as ShareSide,
      direction: req.body.direction as Direction,
      quantity: parseInt(req.body.quantity)
    };

    if (!request.marketId || !request.userId || !request.side || !request.direction || !request.quantity) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Check balance for buys
    if (request.direction === 'BUY') {
      const estimatedCost = request.quantity * 100; // Max possible cost
      if (!positionManager.canAfford(request.userId, estimatedCost)) {
        res.status(400).json({ error: 'Insufficient balance' });
        return;
      }
    }

    const quote = quoteEngine.requestQuote(request);
    if (!quote) {
      res.status(400).json({ error: 'Cannot create quote - market may be closed' });
      return;
    }

    res.status(201).json(quote);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Get quote by ID
app.get('/api/quotes/:id', (req: Request<IdParams>, res: Response) => {
  const quote = quoteEngine.getQuote(req.params.id);
  if (!quote) {
    res.status(404).json({ error: 'Quote not found' });
    return;
  }
  res.json(quote);
});

// Accept a quote
app.post('/api/quotes/:id/accept', (req: Request<IdParams>, res: Response) => {
  const userId = req.body.userId;
  if (!userId) {
    res.status(400).json({ error: 'userId required' });
    return;
  }

  const result = quoteEngine.acceptQuote(req.params.id, userId);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  // Execute the trade in position manager
  const positionResult = positionManager.executeTrade(result.trade!);
  if (!positionResult.success) {
    res.status(400).json({ error: positionResult.error });
    return;
  }

  // Broadcast updates
  const trade = result.trade!;
  broadcast(trade.marketId, { type: 'TRADE', data: trade });
  
  const stats = quoteEngine.getMarketStats(trade.marketId);
  if (stats) {
    broadcast(trade.marketId, { type: 'PRICE_UPDATE', data: { yesPrice: stats.yesPrice, noPrice: stats.noPrice } });
  }

  // Return trade and updated position
  const position = positionManager.getPosition(userId, trade.marketId);
  const balance = positionManager.getBalance(userId);

  res.json({
    trade,
    position,
    balance
  });
});

// Reject a quote
app.post('/api/quotes/:id/reject', (req: Request<IdParams>, res: Response) => {
  const userId = req.body.userId;
  if (!userId) {
    res.status(400).json({ error: 'userId required' });
    return;
  }

  const success = quoteEngine.rejectQuote(req.params.id, userId);
  if (!success) {
    res.status(400).json({ error: 'Cannot reject quote' });
    return;
  }

  res.json({ success: true });
});

// ==========================================
// USER/POSITION ENDPOINTS
// ==========================================

// Get user summary (balance + positions)
app.get('/api/users/:userId', (req: Request<UserIdParams>, res: Response) => {
  const summary = positionManager.getUserSummary(req.params.userId);
  res.json(summary);
});

// Get user positions
app.get('/api/users/:userId/positions', (req: Request<UserIdParams>, res: Response) => {
  const positions = positionManager.getAllPositions(req.params.userId);
  res.json(positions);
});

// Get user trades
app.get('/api/users/:userId/trades', (req: Request<UserIdParams>, res: Response) => {
  const trades = quoteEngine.getUserTrades(req.params.userId);
  res.json(trades);
});

// Add funds (demo)
app.post('/api/users/:userId/fund', (req: Request<UserIdParams>, res: Response) => {
  const amount = parseInt(req.body.amount) || 10000; // Default $100
  const newBalance = positionManager.addFunds(req.params.userId, amount);
  res.json({ balanceUSD: newBalance });
});

// Get leaderboard
app.get('/api/leaderboard', (_req: Request, res: Response) => {
  const leaderboard = positionManager.getLeaderboard(20);
  res.json(leaderboard);
});

// ==========================================
// DATALASTIC PROXY ENDPOINTS FOR FDC
// ==========================================

const DATA_API = "https://api.datalastic.com/api";

// 1. PSC DETENTION & DEFICIENCIES
app.get('/api/proxy/risk/psc/:imo', async (req: Request<ImoParams>, res: Response) => {
  const imo = req.params.imo;
  const apiKey = process.env.DATALASTIC_API_KEY;

  try {
    const url = `${DATA_API}/maritime_reports/inspections?api-key=${apiKey}&imo=${imo}`;
    console.log(`[PSC] Fetching: ${url.replace(apiKey || '', 'HIDDEN')}`);

    let responseData = {
      imo: imo,
      risk_detected: false,
      detention_count: 0,
      deficiency_count: 0,
      deficiency_description: "",
      last_detention_date: null as string | null,
      timestamp: new Date().toISOString()
    };

    if (apiKey) {
      const response = await fetch(url);
      if (response.ok) {
        const json: any = await response.json();
        const inspections = json.data || [];

        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

        const recentDetentions = inspections.filter((i: any) => {
          const isDetained = i.detention === true || i.detention === "TRUE" || parseInt(i.detention) > 0;
          return isDetained && new Date(i.date || i.inspection_date) > oneYearAgo;
        });

        const latest = inspections[0];

        responseData.risk_detected = recentDetentions.length > 0;
        responseData.detention_count = recentDetentions.length;
        responseData.deficiency_count = latest ? parseInt(latest.ship_deficiencies || "0") : 0;
        responseData.deficiency_description = latest ? (latest.deficiency_description || "") : "";
        if (recentDetentions.length > 0) {
          responseData.last_detention_date = recentDetentions[0].date || recentDetentions[0].inspection_date;
        }
      }
    } else {
      if (imo === '9703318') responseData.risk_detected = true;
    }

    res.json(responseData);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 2. DRY DOCK MAINTENANCE
app.get('/api/proxy/risk/drydock/:imo', async (req: Request<ImoParams>, res: Response) => {
  const imo = req.params.imo;
  const apiKey = process.env.DATALASTIC_API_KEY;

  try {
    const url = `${DATA_API}/maritime_reports/dry_dock_dates?api-key=${apiKey}&imo=${imo}`;

    let responseData = {
      imo: imo,
      next_due_date: null as string | null,
      is_overdue: false,
      timestamp: new Date().toISOString()
    };

    if (apiKey) {
      const response = await fetch(url);
      if (response.ok) {
        const json: any = await response.json();
        const data = json.data ? json.data[0] : null;

        if (data && data.dry_dock_next_due) {
          responseData.next_due_date = data.dry_dock_next_due;
          responseData.is_overdue = new Date(data.dry_dock_next_due) < new Date();
        }
      }
    }

    res.json(responseData);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 3. CASUALTY / SINKING
app.get('/api/proxy/risk/casualty/:imo', async (req: Request<ImoParams>, res: Response) => {
  const imo = req.params.imo;
  const apiKey = process.env.DATALASTIC_API_KEY;

  try {
    const url = `${DATA_API}/maritime_reports/casualty?api-key=${apiKey}&imo=${imo}`;

    let responseData = {
      imo: imo,
      casualty_detected: false,
      casualty_type: "",
      casualty_date: null as string | null,
      timestamp: new Date().toISOString()
    };

    if (apiKey) {
      const response = await fetch(url);
      if (response.ok) {
        const json: any = await response.json();
        const casualties = json.data || [];

        if (casualties.length > 0) {
          const latest = casualties[0];
          responseData.casualty_detected = true;
          responseData.casualty_type = latest.casualty_type;
          responseData.casualty_date = latest.casualty_date || latest.date;
        }
      }
    }
    res.json(responseData);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 4. VOYAGE COMPLETION
app.get('/api/proxy/risk/voyage/:imo', async (req: Request<ImoParams>, res: Response) => {
  const imo = req.params.imo;
  const targetLat = parseFloat(req.query.lat as string) || 0;
  const targetLon = parseFloat(req.query.lon as string) || 0;
  const radius = parseFloat(req.query.radius as string) || 10;

  const apiKey = process.env.DATALASTIC_API_KEY;

  try {
    const url = `${DATA_API}/v0/vessel?api-key=${apiKey}&imo=${imo}`;

    let responseData = {
      imo: imo,
      voyage_completed: false,
      current_lat: 0,
      current_lon: 0,
      destination: "",
      eta: "",
      timestamp: new Date().toISOString()
    };

    if (apiKey) {
      const response = await fetch(url);
      if (response.ok) {
        const json: any = await response.json();
        const vessel = json.data ? json.data[0] : null;

        if (vessel) {
          responseData.current_lat = parseFloat(vessel.lat);
          responseData.current_lon = parseFloat(vessel.lon);
          responseData.destination = vessel.destination;
          responseData.eta = vessel.eta;

          if (targetLat !== 0) {
            const dist = Math.sqrt(
              Math.pow(responseData.current_lat - targetLat, 2) +
              Math.pow(responseData.current_lon - targetLon, 2)
            );
            if (dist * 111 < radius) {
              responseData.voyage_completed = true;
            }
          }
        }
      }
    }
    res.json(responseData);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 5. PORT CONGESTION
app.get('/api/proxy/risk/congestion', async (req: Request, res: Response) => {
  const lat = req.query.lat;
  const lon = req.query.lon;
  const radius = req.query.radius || 10;
  const apiKey = process.env.DATALASTIC_API_KEY;

  try {
    const url = `${DATA_API}/v0/vessel_inradius?api-key=${apiKey}&lat=${lat}&lon=${lon}&radius=${radius}`;

    let responseData = {
      vessel_count: 0,
      anchored_count: 0,
      timestamp: new Date().toISOString()
    };

    if (apiKey && lat && lon) {
      const response = await fetch(url);
      if (response.ok) {
        const json: any = await response.json();
        const vessels = json.data || [];

        responseData.vessel_count = vessels.length;
        responseData.anchored_count = vessels.filter((v: any) =>
          v.nav_status === "At Anchor" || v.nav_status_code === 1 || v.nav_status === "1"
        ).length;
      }
    }
    res.json(responseData);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================================
// HEALTH & INIT
// ==========================================

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', mode: 'RFQ', timestamp: new Date().toISOString() });
});

// Initialize demo markets
function initDemoMarkets(): void {
  const demoMarkets = [
    {
      vesselName: 'MSC Oscar',
      vesselIMO: '9703318',
      description: 'Will MSC Oscar be detained at Rotterdam port inspection?',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    },
    {
      vesselName: 'Ever Given',
      vesselIMO: '9811000',
      description: 'Will Ever Given experience a grounding incident in the next 30 days?',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    },
    {
      vesselName: 'CMA CGM Marco Polo',
      vesselIMO: '9454450',
      description: 'Will CMA CGM Marco Polo complete its voyage to Tokyo on schedule?',
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
    }
  ];

  demoMarkets.forEach(m => {
    const market = quoteEngine.createMarket(m);
    console.log(`Created market: ${market.vesselName} (${market.id})`);
  });
}

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`\n🚢 Maritime Shield RFQ Server`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`\n📡 WebSocket: ws://localhost:${PORT}`);
  console.log(`\n🔌 API Endpoints:`);
  console.log(`   GET  /api/markets          - List all markets`);
  console.log(`   GET  /api/markets/:id      - Market details`);
  console.log(`   POST /api/quotes/request   - Request a quote`);
  console.log(`   POST /api/quotes/:id/accept - Accept quote`);
  console.log(`   GET  /api/users/:id        - User summary`);
  console.log(`   GET  /api/health           - Health check\n`);
  
  initDemoMarkets();
});

export { app, server };
