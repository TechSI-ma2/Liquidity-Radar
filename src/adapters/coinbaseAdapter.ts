import WebSocket from 'ws';
import { OrderBookManager } from '../engine/orderBookManager.ts';
import type { RawLevelUpdate } from '../engine/orderBookManager.ts';
import { CoinbasePredictionModule } from '../engine/coinbasePredictionModule.ts';
import { PRODUCTS_CONFIG } from '../types/radar.ts';
import type { ConnectionStatus } from '../types/radar.ts';

const COINBASE_WS_URL =
  process.env.COINBASE_WS_URL || 'wss://advanced-trade-ws.coinbase.com';
const COINBASE_EXCHANGE_WS_URL = 'wss://ws-feed.exchange.coinbase.com';
const COINBASE_EXCHANGE_REST_URL =
  process.env.COINBASE_EXCHANGE_REST_URL || 'https://api.exchange.coinbase.com/products';

export class CoinbaseAdvancedAdapter {
  private advWs: WebSocket | null = null;
  private exWs: WebSocket | null = null;
  private orderBookManager: OrderBookManager;
  private predictionModule: CoinbasePredictionModule;

  public status: ConnectionStatus = 'DISCONNECTED';
  public lastHeartbeat: string | null = null;
  public reconnectCount: number = 0;
  public latencyMs: number = 18;

  private lastGlobalSeqNum: number = -1;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private restDepthPollTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private isShuttingDown: boolean = false;

  constructor(
    orderBookManager: OrderBookManager,
    predictionModule: CoinbasePredictionModule
  ) {
    this.orderBookManager = orderBookManager;
    this.predictionModule = predictionModule;
  }

  public async start(): Promise<void> {
    this.isShuttingDown = false;
    this.status = 'CONNECTING';

    // Immediately hydrate all order books and 24h stats from public Coinbase REST API
    await this.hydrateAllOrderBooksFromRest();

    this.connectAdvancedTradeWs();
    this.connectExchangeTickerWs();

    // Keep L2 depth books continuously synchronized with Coinbase REST L2 snapshots every 4s
    // in addition to incremental WebSocket updates
    this.restDepthPollTimer = setInterval(() => {
      this.hydrateAllOrderBooksFromRest().catch((err) =>
        console.error('[CoinbaseAdapter] Depth sync error:', err)
      );
    }, 4000);
  }

  public stop(): void {
    this.isShuttingDown = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.restDepthPollTimer) clearInterval(this.restDepthPollTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.advWs?.close();
    this.exWs?.close();
    this.advWs = null;
    this.exWs = null;
    this.status = 'DISCONNECTED';
    this.orderBookManager.markAllDisconnected();
  }

  private async hydrateAllOrderBooksFromRest(): Promise<void> {
    const startMs = Date.now();
    await Promise.allSettled(
      PRODUCTS_CONFIG.map(async (prod) => {
        await this.syncSingleProductFromRest(prod.coinbaseProductId, prod.candleProductId);
      })
    );
    const elapsed = Date.now() - startMs;
    if (elapsed > 0 && elapsed < 5000) {
      this.latencyMs = Math.max(8, Math.min(250, Math.round(elapsed / PRODUCTS_CONFIG.length)));
    }
  }

  private async syncSingleProductFromRest(
    productId: string,
    fallbackProductId: string
  ): Promise<void> {
    const book = this.orderBookManager.getBookByProductId(productId);
    if (!book) return;

    const tryFetchBook = async (pid: string) => {
      const res = await fetch(`${COINBASE_EXCHANGE_REST_URL}/${pid}/book?level=2`, {
        headers: { 'User-Agent': 'LiquidityRadar-Institutional/1.0' }
      });
      if (!res.ok) return null;
      return (await res.json()) as {
        bids?: [string, string, number][];
        asks?: [string, string, number][];
        sequence?: number;
        time?: string;
      };
    };

    try {
      let data = await tryFetchBook(productId);
      if (!data || !Array.isArray(data.bids) || data.bids.length < 3) {
        data = await tryFetchBook(fallbackProductId);
      }

      if (data && Array.isArray(data.bids) && Array.isArray(data.asks) && data.bids.length > 0) {
        const updates: RawLevelUpdate[] = [
          ...data.bids.map((b) => ({
            side: 'bid' as const,
            price_level: b[0],
            new_quantity: b[1]
          })),
          ...data.asks.map((a) => ({
            side: 'offer' as const,
            price_level: a[0],
            new_quantity: a[1]
          }))
        ];
        const nowIso = data.time || new Date().toISOString();
        book.applySnapshot(updates, data.sequence || Date.now(), nowIso);
        this.lastHeartbeat = nowIso;
        if (this.status !== 'CONNECTED') {
          this.status = 'CONNECTED';
        }
      }

      // Also fetch 24h stats if liveTradePrice or 24h change is not yet populated
      if (book.lastTradePrice === 0 || book.priceChange24hPct === 0) {
        const statsRes = await fetch(`${COINBASE_EXCHANGE_REST_URL}/${fallbackProductId}/stats`, {
          headers: { 'User-Agent': 'LiquidityRadar-Institutional/1.0' }
        });
        if (statsRes.ok) {
          const stats = (await statsRes.json()) as { open?: string; last?: string };
          const open = parseFloat(stats.open || '0');
          const last = parseFloat(stats.last || '0');
          if (open > 0 && last > 0) {
            const chg = ((last - open) / open) * 100;
            book.updateTicker(last, chg, new Date().toISOString());
            this.predictionModule.onRealtimeTick(fallbackProductId, last);
          }
        }
      }
    } catch {
      // Ignore transient network hiccups
    }
  }

  private connectAdvancedTradeWs(): void {
    if (this.isShuttingDown) return;

    try {
      this.advWs = new WebSocket(COINBASE_WS_URL, {
        perMessageDeflate: true,
        handshakeTimeout: 10000,
        maxPayload: 64 * 1024 * 1024
      });

      this.advWs.on('open', () => {
        this.status = 'CONNECTED';
        this.lastHeartbeat = new Date().toISOString();
        const productIds = Array.from(
          new Set(PRODUCTS_CONFIG.flatMap((p) => [p.coinbaseProductId, p.candleProductId]))
        );

        const channels = ['heartbeats', 'ticker', 'market_trades', 'level2'];
        channels.forEach((channel, idx) => {
          setTimeout(() => {
            if (this.advWs && this.advWs.readyState === WebSocket.OPEN) {
              this.advWs.send(
                JSON.stringify({
                  type: 'subscribe',
                  product_ids: productIds,
                  channel
                })
              );
            }
          }, idx * 100);
        });
        this.startWatchdog();
      });

      this.advWs.on('message', (data: WebSocket.RawData) => {
        this.handleAdvancedMessage(data.toString());
      });

      this.advWs.on('error', () => {
        // Handled via close/fallback
      });

      this.advWs.on('close', () => {
        this.scheduleReconnect();
      });
    } catch {
      this.scheduleReconnect();
    }
  }

  private connectExchangeTickerWs(): void {
    if (this.isShuttingDown) return;

    try {
      this.exWs = new WebSocket(COINBASE_EXCHANGE_WS_URL, {
        handshakeTimeout: 10000
      });

      this.exWs.on('open', () => {
        this.status = 'CONNECTED';
        const productIds = Array.from(
          new Set(PRODUCTS_CONFIG.flatMap((p) => [p.coinbaseProductId, p.candleProductId]))
        );
        this.exWs?.send(
          JSON.stringify({
            type: 'subscribe',
            product_ids: productIds,
            channels: ['ticker', 'matches', 'heartbeat']
          })
        );
      });

      this.exWs.on('message', (raw: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(raw.toString());
          const nowIso = msg.time || new Date().toISOString();

          if (msg.type === 'heartbeat') {
            this.lastHeartbeat = nowIso;
            this.status = 'CONNECTED';
            return;
          }

          if (msg.type === 'ticker' && msg.product_id && msg.price) {
            const price = parseFloat(msg.price);
            const open24h = parseFloat(msg.open_24h || '0');
            const chgPct = open24h > 0 ? ((price - open24h) / open24h) * 100 : 0;

            this.updateMatchingBooksTicker(msg.product_id, price, chgPct, nowIso);
            this.predictionModule.onRealtimeTick(msg.product_id, price);

            if (msg.best_bid && msg.best_ask) {
              const bb = parseFloat(msg.best_bid);
              const ba = parseFloat(msg.best_ask);
              const bbSize = parseFloat(msg.best_bid_size || '1.5');
              const baSize = parseFloat(msg.best_ask_size || '1.5');
              this.applyTopOfBookTick(msg.product_id, bb, bbSize, ba, baSize, msg.sequence || Date.now(), nowIso);
            }
          }

          if ((msg.type === 'match' || msg.type === 'last_match') && msg.product_id && msg.price && msg.size) {
            const price = parseFloat(msg.price);
            const size = parseFloat(msg.size);
            const side: 'BUY' | 'SELL' = msg.side === 'buy' ? 'BUY' : 'SELL';
            this.recordMatchingBooksTrade(msg.product_id, price, size, side);
            this.predictionModule.onRealtimeTick(msg.product_id, price, size, side);
          }
        } catch {
          // Ignore malformed frame
        }
      });

      this.exWs.on('close', () => {
        if (!this.isShuttingDown) {
          setTimeout(() => this.connectExchangeTickerWs(), 3000);
        }
      });
    } catch {
      // Ignore error
    }
  }

  private updateMatchingBooksTicker(
    productId: string,
    price: number,
    chgPct: number,
    timestamp: string
  ): void {
    const prefix = productId.split('-')[0];
    for (const prod of PRODUCTS_CONFIG) {
      if (prod.coinbaseProductId === productId || prod.asset === prefix) {
        const book = this.orderBookManager.getBookBySymbol(prod.displaySymbol);
        book?.updateTicker(price, chgPct, timestamp);
      }
    }
  }

  private applyTopOfBookTick(
    productId: string,
    bestBid: number,
    bestBidSize: number,
    bestAsk: number,
    bestAskSize: number,
    seq: number,
    timestamp: string
  ): void {
    const prefix = productId.split('-')[0];
    for (const prod of PRODUCTS_CONFIG) {
      if (prod.coinbaseProductId === productId || prod.asset === prefix) {
        const book = this.orderBookManager.getBookBySymbol(prod.displaySymbol);
        if (book && book.synchronized) {
          book.applyIncrementalUpdate(
            [
              { side: 'bid', price_level: String(bestBid), new_quantity: String(bestBidSize) },
              { side: 'offer', price_level: String(bestAsk), new_quantity: String(bestAskSize) }
            ],
            seq,
            timestamp
          );
        }
      }
    }
  }

  private recordMatchingBooksTrade(
    productId: string,
    price: number,
    size: number,
    side: 'BUY' | 'SELL'
  ): void {
    const prefix = productId.split('-')[0];
    for (const prod of PRODUCTS_CONFIG) {
      if (prod.coinbaseProductId === productId || prod.asset === prefix) {
        const book = this.orderBookManager.getBookBySymbol(prod.displaySymbol);
        book?.recordTrade(price, size, side);
      }
    }
  }

  private handleAdvancedMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'error') return;

      const msgTimestamp: string = msg.timestamp || new Date().toISOString();
      if (msg.timestamp) {
        const diff = Date.now() - new Date(msg.timestamp).getTime();
        if (diff >= 0 && diff < 60000) this.latencyMs = Math.max(5, diff);
      }

      if (typeof msg.sequence_num === 'number') {
        this.lastGlobalSeqNum = msg.sequence_num;
      }

      if (msg.channel === 'heartbeats' && Array.isArray(msg.events)) {
        this.lastHeartbeat = msgTimestamp;
        this.status = 'CONNECTED';
        return;
      }

      if (msg.channel === 'l2_data' && Array.isArray(msg.events)) {
        for (const ev of msg.events) {
          const productId: string = ev.product_id;
          const book = this.orderBookManager.getBookByProductId(productId);
          if (!book || !Array.isArray(ev.updates)) continue;

          if (ev.type === 'snapshot') {
            book.applySnapshot(ev.updates as RawLevelUpdate[], msg.sequence_num || 0, msgTimestamp);
          } else if (ev.type === 'update') {
            const result = book.applyIncrementalUpdate(
              ev.updates as RawLevelUpdate[],
              msg.sequence_num || 0,
              msgTimestamp
            );
            if (!result.ok) {
              this.syncSingleProductFromRest(productId, productId);
            }
          }
        }
        return;
      }

      if (msg.channel === 'ticker' && Array.isArray(msg.events)) {
        for (const ev of msg.events) {
          if (!Array.isArray(ev.tickers)) continue;
          for (const t of ev.tickers) {
            const price = parseFloat(t.price);
            const change24h = parseFloat(t.price_percent_chg_24_h || '0');
            if (!isNaN(price) && price > 0) {
              this.updateMatchingBooksTicker(t.product_id, price, change24h, msgTimestamp);
              this.predictionModule.onRealtimeTick(t.product_id, price);
            }
          }
        }
        return;
      }

      if (msg.channel === 'market_trades' && Array.isArray(msg.events)) {
        for (const ev of msg.events) {
          if (!Array.isArray(ev.trades)) continue;
          for (const tr of ev.trades) {
            const price = parseFloat(tr.price);
            const size = parseFloat(tr.size);
            if (!isNaN(price) && !isNaN(size)) {
              const side = tr.side === 'BUY' ? 'BUY' : 'SELL';
              this.recordMatchingBooksTrade(tr.product_id, price, size, side);
              this.predictionModule.onRealtimeTick(tr.product_id, price, size, side);
            }
          }
        }
      }
    } catch {
      // Ignore parse error
    }
  }

  private startWatchdog(): void {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = setInterval(() => {
      if (this.status === 'CONNECTED' && this.lastHeartbeat) {
        const elapsedMs = Date.now() - new Date(this.lastHeartbeat).getTime();
        if (elapsedMs > 20000) {
          this.advWs?.terminate();
        }
      }
    }, 5000);
  }

  private scheduleReconnect(): void {
    if (this.isShuttingDown) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    this.reconnectCount++;
    const backoffMs = Math.min(20000, 1000 * Math.pow(1.5, Math.min(6, this.reconnectCount)));
    this.reconnectTimer = setTimeout(() => {
      this.connectAdvancedTradeWs();
    }, backoffMs);
  }
}
