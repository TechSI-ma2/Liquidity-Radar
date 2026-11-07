import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { OrderBookManager } from './src/engine/orderBookManager.ts';
import { LiquidityDetector } from './src/engine/liquidityDetector.ts';
import { CoinbasePredictionModule } from './src/engine/coinbasePredictionModule.ts';
import { CoinbaseAdvancedAdapter } from './src/adapters/coinbaseAdapter.ts';
import { AlertService } from './src/services/alertService.ts';
import { StorageService } from './src/services/storageService.ts';
import type {
  PairTelemetry,
  RadarBroadcastPayload,
  SupportedCryptoAsset
} from './src/types/radar.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const COINBASE_WS_URL =
  process.env.COINBASE_WS_URL || 'wss://advanced-trade-ws.coinbase.com';

async function startServer() {
  const app = express();
  app.use(express.json());

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  const orderBookManager = new OrderBookManager();
  const liquidityDetector = new LiquidityDetector(50000);
  const predictionModule = new CoinbasePredictionModule();
  const coinbaseAdapter = new CoinbaseAdvancedAdapter(
    orderBookManager,
    predictionModule
  );
  const alertService = new AlertService();
  const storageService = new StorageService();

  let latestPairsTelemetry: Record<string, PairTelemetry> = {};

  const runAnalysisCycle = () => {
    const updatedPairs: Record<string, PairTelemetry> = {};

    for (const book of orderBookManager.getAllBooks()) {
      const { telemetry, newAlerts } = liquidityDetector.analyzeOrderBook(book, 5.0);
      updatedPairs[book.displaySymbol] = telemetry;

      if (newAlerts.length > 0) {
        const accepted = alertService.processNewAlerts(newAlerts);
        if (accepted.length > 0) {
          storageService.saveAlerts(accepted);
        }
      }
    }

    latestPairsTelemetry = updatedPairs;
    const predictions = predictionModule.computeAllPredictions(updatedPairs);

    const payload: RadarBroadcastPayload = {
      type: 'RADAR_STATE_UPDATE',
      serverTimestamp: new Date().toISOString(),
      exchangeStatus: {
        exchange: 'Coinbase Advanced Trade',
        endpoint: COINBASE_WS_URL,
        status: coinbaseAdapter.status,
        lastHeartbeat: coinbaseAdapter.lastHeartbeat,
        reconnectCount: coinbaseAdapter.reconnectCount,
        latencyMs: coinbaseAdapter.latencyMs
      },
      pairs: updatedPairs,
      predictions,
      recentAlerts: alertService.getRecentAlerts(40)
    };

    return payload;
  };

  // Start real-time Coinbase feeds & 15m candle seeding in background
  Promise.all([coinbaseAdapter.start(), predictionModule.start()])
    .then(() => {
      const initialPayload = runAnalysisCycle();
      for (const telemetry of Object.values(initialPayload.pairs)) {
        storageService.archiveSnapshot(telemetry);
      }
    })
    .catch((err) => {
      console.error('[Server] Startup feed initialization error:', err);
    });

  // REST API Endpoints
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      exchange: 'Coinbase Advanced Trade',
      connectionStatus: coinbaseAdapter.status,
      lastHeartbeat: coinbaseAdapter.lastHeartbeat,
      reconnectCount: coinbaseAdapter.reconnectCount,
      latencyMs: coinbaseAdapter.latencyMs,
      minWallThresholdUsd: liquidityDetector.getMinWallThreshold(),
      serverTimestamp: new Date().toISOString()
    });
  });

  app.get('/api/state', (_req, res) => {
    const payload = runAnalysisCycle();
    res.json(payload);
  });

  app.get('/api/history', async (req, res) => {
    const symbol = (req.query.symbol as string) || 'BTC/USDT';
    const limit = Math.min(500, parseInt((req.query.limit as string) || '180', 10));
    const snapshots = await storageService.getHistoricalSnapshots(symbol, limit);
    res.json({ symbol, count: snapshots.length, snapshots });
  });

  app.get('/api/alerts', (_req, res) => {
    res.json({ alerts: alertService.getRecentAlerts(60) });
  });

  app.get('/api/prediction/:asset', (req, res) => {
    const asset = (req.params.asset?.toUpperCase() || 'BTC') as SupportedCryptoAsset;
    const allPredictions = predictionModule.computeAllPredictions(latestPairsTelemetry);
    const data = allPredictions[asset] || allPredictions.BTC;
    res.json(data);
  });

  app.post('/api/settings/threshold', (req, res) => {
    const { minWallThresholdUsd } = req.body;
    if (typeof minWallThresholdUsd === 'number' && minWallThresholdUsd >= 1000) {
      liquidityDetector.setMinWallThreshold(minWallThresholdUsd);
      res.json({ ok: true, minWallThresholdUsd: liquidityDetector.getMinWallThreshold() });
    } else {
      res.status(400).json({ ok: false, error: 'Minimum wall threshold must be at least $1,000 USD.' });
    }
  });

  // WebSocket Client Handling
  wss.on('connection', (client: WebSocket) => {
    const initialPayload = runAnalysisCycle();
    client.send(JSON.stringify(initialPayload));

    client.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'SET_WALL_THRESHOLD' && typeof msg.thresholdUsd === 'number') {
          liquidityDetector.setMinWallThreshold(msg.thresholdUsd);
        }
      } catch {
        // Ignore malformed client message
      }
    });
  });

  // Continuous Real-Time Liquidity Detection & Broadcast Loop (every 400ms)
  setInterval(() => {
    const payload = runAnalysisCycle();
    const serialized = JSON.stringify(payload);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  }, 400);

  // Periodic Historical Snapshot Archiver (every 2 seconds)
  setInterval(() => {
    for (const telemetry of Object.values(latestPairsTelemetry)) {
      storageService.archiveSnapshot(telemetry);
    }
  }, 2000);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Liquidity Radar Terminal] Server running on http://localhost:${PORT}`);
  });
}

startServer();
