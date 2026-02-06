import express, { Request, Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import path from 'path';
import { marketManager } from '../clob/MarketManager';
import { CreateOrderRequest } from '../types';

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

export { app, server };
