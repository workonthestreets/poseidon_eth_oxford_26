import express, { Request, Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { marketManager } from '../clob/MarketManager.js';
import { CreateOrderRequest } from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, '../../public')));

// Track WebSocket clients by market
const marketSubscribers: Map<string, Set<WebSocket>> = new Map();

// Broadcast to market subscribers
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

// WebSocket handling
wss.on('connection', (ws: WebSocket) => {
  let subscribedMarket: string | null = null;

  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'SUBSCRIBE' && msg.marketId) {
        // Unsubscribe from previous
        if (subscribedMarket) {
          marketSubscribers.get(subscribedMarket)?.delete(ws);
        }

        subscribedMarket = msg.marketId as string;
        if (!marketSubscribers.has(subscribedMarket)) {
          marketSubscribers.set(subscribedMarket, new Set());
        }
        marketSubscribers.get(subscribedMarket)!.add(ws);

        // Send current orderbook
        const ob = marketManager.getOrderBook(subscribedMarket);
        if (ob) {
          ws.send(JSON.stringify({ type: 'ORDER_BOOK', data: ob.getOrderBook() }));
          ws.send(JSON.stringify({ type: 'TRADES', data: ob.getRecentTrades(20) }));
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

// REST API Routes

// Get all markets
app.get('/api/markets', (_req: Request, res: Response) => {
  const markets = marketManager.getAllMarkets();
  res.json(markets);
});

// Get market details
app.get('/api/markets/:id', (req: Request, res: Response) => {
  const stats = marketManager.getMarketStats(req.params.id as string);
  if (!stats) {
    res.status(404).json({ error: 'Market not found' });
    return;
  }
  res.json(stats);
});

// Create market (admin)
app.post('/api/markets', (req: Request, res: Response) => {
  try {
    const market = marketManager.createMarket({
      vesselName: req.body.vesselName,
      vesselIMO: req.body.vesselIMO,
      route: req.body.route,
      expectedArrival: new Date(req.body.expectedArrival),
      demurrageThresholdHours: req.body.demurrageThresholdHours || 24,
      maxPayout: req.body.maxPayout || 100000
    });
    res.status(201).json(market);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Get orderbook
app.get('/api/markets/:id/orderbook', (req: Request, res: Response) => {
  const ob = marketManager.getOrderBook(req.params.id as string);
  if (!ob) {
    res.status(404).json({ error: 'Market not found' });
    return;
  }
  res.json(ob.getOrderBook());
});

// Submit order
app.post('/api/orders', (req: Request, res: Response) => {
  try {
    const request: CreateOrderRequest = {
      marketId: req.body.marketId,
      userId: req.body.userId,
      side: req.body.side,
      type: req.body.type,
      price: req.body.price,
      quantity: req.body.quantity
    };

    const result = marketManager.submitOrder(request);
    if (!result) {
      res.status(400).json({ error: 'Market not available' });
      return;
    }

    // Broadcast updates
    const ob = marketManager.getOrderBook(request.marketId);
    if (ob) {
      broadcast(request.marketId, { type: 'ORDER_BOOK', data: ob.getOrderBook() });
      if (result.trades.length > 0) {
        broadcast(request.marketId, { type: 'TRADES', data: result.trades });
      }
    }

    res.status(201).json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// Cancel order
app.delete('/api/orders/:orderId', (req: Request, res: Response) => {
  const marketId = req.body.marketId as string;
  const userId = req.body.userId as string;
  const order = marketManager.cancelOrder(marketId, req.params.orderId as string, userId);

  if (!order) {
    res.status(404).json({ error: 'Order not found or cannot be cancelled' });
    return;
  }

  const ob = marketManager.getOrderBook(marketId);
  if (ob) {
    broadcast(marketId, { type: 'ORDER_BOOK', data: ob.getOrderBook() });
  }

  res.json(order);
});

// Get user orders
app.get('/api/users/:userId/orders', (req: Request, res: Response) => {
  const marketId = req.query.marketId;
  if (!marketId || typeof marketId !== 'string') {
    res.status(400).json({ error: 'marketId required' });
    return;
  }

  const ob = marketManager.getOrderBook(marketId);
  if (!ob) {
    res.status(404).json({ error: 'Market not found' });
    return;
  }

  res.json(ob.getUserOrders(req.params.userId as string));
});

// Settle market (admin/oracle)
app.post('/api/markets/:id/settle', (req: Request, res: Response) => {
  const { demurrageOccurred } = req.body;
  const marketId = req.params.id as string;
  const market = marketManager.settleMarket(marketId, demurrageOccurred);

  if (!market) {
    res.status(400).json({ error: 'Cannot settle market' });
    return;
  }

  broadcast(marketId, { type: 'MARKET_SETTLED', data: market });
  res.json(market);
});

// Initialize demo markets
function initDemoMarkets(): void {
  const demoMarkets = [
    {
      vesselName: 'MSC Oscar',
      vesselIMO: '9703318',
      route: 'Shanghai → Rotterdam',
      expectedArrival: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      demurrageThresholdHours: 24,
      maxPayout: 150000
    },
    {
      vesselName: 'Ever Given',
      vesselIMO: '9811000',
      route: 'Felixstowe → Singapore',
      expectedArrival: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      demurrageThresholdHours: 48,
      maxPayout: 200000
    },
    {
      vesselName: 'CMA CGM Marco Polo',
      vesselIMO: '9454450',
      route: 'Los Angeles → Tokyo',
      expectedArrival: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      demurrageThresholdHours: 36,
      maxPayout: 175000
    }
  ];

  demoMarkets.forEach(m => {
    const market = marketManager.createMarket(m);
    seedOrderBook(market.id);
  });
}

function seedOrderBook(marketId: string): void {
  const basePrice = 30 + Math.floor(Math.random() * 40); // 30-70 range

  // Seed some initial orders
  for (let i = 0; i < 5; i++) {
    marketManager.submitOrder({
      marketId,
      userId: `mm-${i}`,
      side: 'BUY',
      type: 'LIMIT',
      price: basePrice - 1 - i * 2,
      quantity: 100 + Math.floor(Math.random() * 200)
    });

    marketManager.submitOrder({
      marketId,
      userId: `mm-${i}`,
      side: 'SELL',
      type: 'LIMIT',
      price: basePrice + 1 + i * 2,
      quantity: 100 + Math.floor(Math.random() * 200)
    });
  }
}

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Maritime Insurance Market running on http://localhost:${PORT}`);
  initDemoMarkets();
  console.log('Demo markets initialized');
});



// ==========================================
// DATALASTIC PROXY ENDPOINTS FOR FDC
// ==========================================

const DATA_API = "https://api.datalastic.com/api";

// 1. PSC DETENTION & DEFICIENCIES
app.get('/api/proxy/risk/psc/:imo', async (req: Request, res: Response) => {
  const imo = req.params.imo;
  const apiKey = process.env.DATALASTIC_API_KEY;

  try {
    const url = `${DATA_API}/maritime_reports/inspections?api-key=${apiKey}&imo=${imo}`;
    console.log(`[PSC] Fetching: ${url.replace(apiKey || '', 'HIDDEN')}`);

    // Default Safe State
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

        // Logic: active detention or recent detention (last 12m)
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

        const recentDetentions = inspections.filter((i: any) => {
          const isDetained = i.detention === true || i.detention === "TRUE" || parseInt(i.detention) > 0;
          return isDetained && new Date(i.date || i.inspection_date) > oneYearAgo;
        });

        // Get latest inspection for deficiencies
        const latest = inspections[0];

        responseData.risk_detected = recentDetentions.length > 0;
        responseData.detention_count = recentDetentions.length;
        responseData.deficiency_count = latest ? parseInt(latest.ship_deficiencies || "0") : 0;
        responseData.deficiency_description = latest ? (latest.deficiency_description || "") : "";
        if (recentDetentions.length > 0) {
          responseData.last_detention_date = recentDetentions[0].date || recentDetentions[0].inspection_date;
        }
      } else {
        console.error(`[PSC] API Error: ${response.status}`);
      }
    } else {
      // Mock fallback for testing without key
      if (imo === '9703318') responseData.risk_detected = true;
    }

    res.json(responseData);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 2. DRY DOCK MAINTENANCE
app.get('/api/proxy/risk/drydock/:imo', async (req: Request, res: Response) => {
  const imo = req.params.imo;
  const apiKey = process.env.DATALASTIC_API_KEY;

  try {
    const url = `${DATA_API}/maritime_reports/dry_dock_dates?api-key=${apiKey}&imo=${imo}`;
    console.log(`[DryDock] Fetching: ${url.replace(apiKey || '', 'HIDDEN')}`);

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
        const data = json.data ? json.data[0] : null; // Assuming list or single obj

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
app.get('/api/proxy/risk/casualty/:imo', async (req: Request, res: Response) => {
  const imo = req.params.imo;
  const apiKey = process.env.DATALASTIC_API_KEY;

  try {
    const url = `${DATA_API}/maritime_reports/casualty?api-key=${apiKey}&imo=${imo}`;
    console.log(`[Casualty] Fetching: ${url.replace(apiKey || '', 'HIDDEN')}`);

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

        // Check for recent casualties (e.g. last 3 months, or just ANY returned)
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
app.get('/api/proxy/risk/voyage/:imo', async (req: Request, res: Response) => {
  const imo = req.params.imo;
  // Params for target destination (mocking standard params for now, usually passed in query)
  const targetLat = parseFloat(req.query.lat as string) || 0;
  const targetLon = parseFloat(req.query.lon as string) || 0;
  const radius = parseFloat(req.query.radius as string) || 10; // km

  const apiKey = process.env.DATALASTIC_API_KEY;

  try {
    const url = `${DATA_API}/v0/vessel?api-key=${apiKey}&imo=${imo}`;
    console.log(`[Voyage] Fetching: ${url.replace(apiKey || '', 'HIDDEN')}`);

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
        const vessel = json.data ? json.data[0] : null; // v0/vessel often returns array

        if (vessel) {
          responseData.current_lat = parseFloat(vessel.lat);
          responseData.current_lon = parseFloat(vessel.lon);
          responseData.destination = vessel.destination;
          responseData.eta = vessel.eta;

          // Simple Haversine (or just euclidean for short dist) to check radius
          // Mock check: if lat/lon is close to 0,0 (default) or target
          // For hackathon: we just return the raw position data mostly

          // If target provided, Check distance
          if (targetLat !== 0) {
            const dist = Math.sqrt(
              Math.pow(responseData.current_lat - targetLat, 2) +
              Math.pow(responseData.current_lon - targetLon, 2)
            );
            // Approx degree to km conversion roughly 111km
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
  // Expected params: lat, lon, radius
  const lat = req.query.lat;
  const lon = req.query.lon;
  const radius = req.query.radius || 10;
  const apiKey = process.env.DATALASTIC_API_KEY;

  try {
    const url = `${DATA_API}/v0/vessel_inradius?api-key=${apiKey}&lat=${lat}&lon=${lon}&radius=${radius}`;
    console.log(`[Congestion] Fetching: ${url.replace(apiKey || '', 'HIDDEN')}`);

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
        // FILTER: status 'At Anchor' (usually 'nav_status' field)
        // Status 1 = At Anchor, 5 = Moored
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

export { app, server };
