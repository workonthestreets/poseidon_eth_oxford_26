"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.server = exports.app = void 0;
const express_1 = __importDefault(require("express"));
const ws_1 = require("ws");
const http_1 = __importDefault(require("http"));
const path_1 = __importDefault(require("path"));
const MarketManager_1 = require("../clob/MarketManager");
const app = (0, express_1.default)();
exports.app = app;
const server = http_1.default.createServer(app);
exports.server = server;
const wss = new ws_1.WebSocketServer({ server });
app.use(express_1.default.json());
app.use(express_1.default.static(path_1.default.join(__dirname, '../../public')));
// Track WebSocket clients by market
const marketSubscribers = new Map();
// Broadcast to market subscribers
function broadcast(marketId, message) {
    const subscribers = marketSubscribers.get(marketId);
    if (!subscribers)
        return;
    const data = JSON.stringify(message);
    subscribers.forEach(ws => {
        if (ws.readyState === ws_1.WebSocket.OPEN) {
            ws.send(data);
        }
    });
}
// WebSocket handling
wss.on('connection', (ws) => {
    let subscribedMarket = null;
    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'SUBSCRIBE' && msg.marketId) {
                // Unsubscribe from previous
                if (subscribedMarket) {
                    marketSubscribers.get(subscribedMarket)?.delete(ws);
                }
                subscribedMarket = msg.marketId;
                if (!marketSubscribers.has(subscribedMarket)) {
                    marketSubscribers.set(subscribedMarket, new Set());
                }
                marketSubscribers.get(subscribedMarket).add(ws);
                // Send current orderbook
                const ob = MarketManager_1.marketManager.getOrderBook(subscribedMarket);
                if (ob) {
                    ws.send(JSON.stringify({ type: 'ORDER_BOOK', data: ob.getOrderBook() }));
                    ws.send(JSON.stringify({ type: 'TRADES', data: ob.getRecentTrades(20) }));
                }
            }
        }
        catch (e) {
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
app.get('/api/markets', (_req, res) => {
    const markets = MarketManager_1.marketManager.getAllMarkets();
    res.json(markets);
});
// Get market details
app.get('/api/markets/:id', (req, res) => {
    const stats = MarketManager_1.marketManager.getMarketStats(req.params.id);
    if (!stats) {
        res.status(404).json({ error: 'Market not found' });
        return;
    }
    res.json(stats);
});
// Create market (admin)
app.post('/api/markets', (req, res) => {
    try {
        const market = MarketManager_1.marketManager.createMarket({
            vesselName: req.body.vesselName,
            vesselIMO: req.body.vesselIMO,
            route: req.body.route,
            expectedArrival: new Date(req.body.expectedArrival),
            demurrageThresholdHours: req.body.demurrageThresholdHours || 24,
            maxPayout: req.body.maxPayout || 100000
        });
        res.status(201).json(market);
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
// Get orderbook
app.get('/api/markets/:id/orderbook', (req, res) => {
    const ob = MarketManager_1.marketManager.getOrderBook(req.params.id);
    if (!ob) {
        res.status(404).json({ error: 'Market not found' });
        return;
    }
    res.json(ob.getOrderBook());
});
// Submit order
app.post('/api/orders', (req, res) => {
    try {
        const request = {
            marketId: req.body.marketId,
            userId: req.body.userId,
            side: req.body.side,
            type: req.body.type,
            price: req.body.price,
            quantity: req.body.quantity
        };
        const result = MarketManager_1.marketManager.submitOrder(request);
        if (!result) {
            res.status(400).json({ error: 'Market not available' });
            return;
        }
        // Broadcast updates
        const ob = MarketManager_1.marketManager.getOrderBook(request.marketId);
        if (ob) {
            broadcast(request.marketId, { type: 'ORDER_BOOK', data: ob.getOrderBook() });
            if (result.trades.length > 0) {
                broadcast(request.marketId, { type: 'TRADES', data: result.trades });
            }
        }
        res.status(201).json(result);
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
// Cancel order
app.delete('/api/orders/:orderId', (req, res) => {
    const marketId = req.body.marketId;
    const userId = req.body.userId;
    const order = MarketManager_1.marketManager.cancelOrder(marketId, req.params.orderId, userId);
    if (!order) {
        res.status(404).json({ error: 'Order not found or cannot be cancelled' });
        return;
    }
    const ob = MarketManager_1.marketManager.getOrderBook(marketId);
    if (ob) {
        broadcast(marketId, { type: 'ORDER_BOOK', data: ob.getOrderBook() });
    }
    res.json(order);
});
// Get user orders
app.get('/api/users/:userId/orders', (req, res) => {
    const marketId = req.query.marketId;
    if (!marketId || typeof marketId !== 'string') {
        res.status(400).json({ error: 'marketId required' });
        return;
    }
    const ob = MarketManager_1.marketManager.getOrderBook(marketId);
    if (!ob) {
        res.status(404).json({ error: 'Market not found' });
        return;
    }
    res.json(ob.getUserOrders(req.params.userId));
});
// Settle market (admin/oracle)
app.post('/api/markets/:id/settle', (req, res) => {
    const { demurrageOccurred } = req.body;
    const marketId = req.params.id;
    const market = MarketManager_1.marketManager.settleMarket(marketId, demurrageOccurred);
    if (!market) {
        res.status(400).json({ error: 'Cannot settle market' });
        return;
    }
    broadcast(marketId, { type: 'MARKET_SETTLED', data: market });
    res.json(market);
});
// Initialize demo markets
function initDemoMarkets() {
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
        const market = MarketManager_1.marketManager.createMarket(m);
        seedOrderBook(market.id);
    });
}
function seedOrderBook(marketId) {
    const basePrice = 30 + Math.floor(Math.random() * 40); // 30-70 range
    // Seed some initial orders
    for (let i = 0; i < 5; i++) {
        MarketManager_1.marketManager.submitOrder({
            marketId,
            userId: `mm-${i}`,
            side: 'BUY',
            type: 'LIMIT',
            price: basePrice - 1 - i * 2,
            quantity: 100 + Math.floor(Math.random() * 200)
        });
        MarketManager_1.marketManager.submitOrder({
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
// Terminal49 Proxy for Flare FDC
app.get('/api/proxy/demurrage/:containerId', async (req, res) => {
    const containerId = req.params.containerId;
    const apiKey = process.env.TERMINAL49_API_KEY;
    // In a real scenario, we would fetch from Terminal49 API
    // const response = await fetch(`https://api.terminal49.com/v2/containers/${containerId}?include=shipment`, {
    //   headers: { 'Authorization': `Token ${apiKey}` }
    // });
    // const data = await response.json();
    // MOCK DATA for Hackathon/Testing purposes
    // Simulating a response that would come from T49
    const mockT49Data = {
        data: {
            id: containerId,
            attributes: {
                number: containerId,
                fees: [
                    { type: 'Demurrage', amount: 150.00, currency: 'USD' }, // Example fee
                    { type: 'Exam', amount: 50.00, currency: 'USD' }
                ],
                pod_arrived_at: "2023-10-27T10:00:00Z",
            },
            relationships: {
                shipment: {
                    data: {
                        attributes: {
                            pod_locode: "USNYC", // New York
                            vessel_imo: "9703318" // MSC Oscar (from our demo market)
                        }
                    }
                }
            }
        }
    };
    // Logic to process the data for FDC
    const attrs = mockT49Data.data.attributes;
    const shipmentAttrs = mockT49Data.data.relationships.shipment.data.attributes;
    // 1. Check for Demurrage Fee
    const demurrageFee = attrs.fees.find((f) => f.type === 'Demurrage' && f.amount > 0);
    const isDemurrage = !!demurrageFee;
    // 2. data construction
    const fdcResponse = {
        container_id: attrs.number,
        vessel_imo: shipmentAttrs.vessel_imo,
        pod_locode: shipmentAttrs.pod_locode,
        demurrage_fee_detected: isDemurrage,
        demurrage_amount: demurrageFee ? demurrageFee.amount : 0,
        arrival_ts: attrs.pod_arrived_at,
        timestamp: new Date().toISOString()
    };
    res.json(fdcResponse);
});
