import { PRODUCTS_CONFIG } from '../types/radar.ts';
import type { PriceLevel } from '../types/radar.ts';

export interface RawLevelUpdate {
  side: 'bid' | 'offer' | 'ask' | 'buy' | 'sell';
  price_level: string;
  new_quantity: string;
  event_time?: string;
}

export class SynchronizedOrderBook {
  public readonly displaySymbol: string;
  public readonly productId: string;
  public readonly marketType: 'SPOT' | 'FUTURES';
  public readonly bucketSize: number;

  private bids: Map<number, number> = new Map();
  private asks: Map<number, number> = new Map();

  public synchronized: boolean = false;
  public lastSequenceNum: number = 0;
  public lastExchangeTimestamp: string = '';
  public lastTradePrice: number = 0;
  public priceChange24hPct: number = 0;
  public recentTradeVolumeUsd: { buyUsd: number; sellUsd: number; resetAt: number } = {
    buyUsd: 0,
    sellUsd: 0,
    resetAt: Date.now()
  };

  constructor(displaySymbol: string, productId: string, marketType: 'SPOT' | 'FUTURES', bucketSize: number) {
    this.displaySymbol = displaySymbol;
    this.productId = productId;
    this.marketType = marketType;
    this.bucketSize = bucketSize;
  }

  public applySnapshot(updates: RawLevelUpdate[], sequenceNum: number, timestamp: string): void {
    this.bids.clear();
    this.asks.clear();

    for (const u of updates) {
      const price = parseFloat(u.price_level);
      const qty = parseFloat(u.new_quantity);
      if (isNaN(price) || isNaN(qty) || price <= 0) continue;

      if (qty > 0) {
        if (u.side === 'bid' || u.side === 'buy') {
          this.bids.set(price, qty);
        } else {
          this.asks.set(price, qty);
        }
      }
    }

    this.lastSequenceNum = sequenceNum;
    this.lastExchangeTimestamp = timestamp;
    this.synchronized = this.bids.size > 0 && this.asks.size > 0;
  }

  public applyIncrementalUpdate(
    updates: RawLevelUpdate[],
    sequenceNum: number,
    timestamp: string
  ): { ok: boolean; reason?: string } {
    if (!this.synchronized) {
      return { ok: false, reason: 'BOOK_NOT_INITIALIZED_WITH_SNAPSHOT' };
    }

    for (const u of updates) {
      const price = parseFloat(u.price_level);
      const qty = parseFloat(u.new_quantity);
      if (isNaN(price) || isNaN(qty) || price <= 0) continue;

      const targetMap = u.side === 'bid' || u.side === 'buy' ? this.bids : this.asks;
      if (qty === 0) {
        targetMap.delete(price);
      } else {
        targetMap.set(price, qty);
      }
    }

    this.lastSequenceNum = sequenceNum;
    this.lastExchangeTimestamp = timestamp;

    const bestBid = this.getBestBid();
    const bestAsk = this.getBestAsk();
    if (bestBid > 0 && bestAsk > 0 && bestBid >= bestAsk) {
      const crossPct = ((bestBid - bestAsk) / bestAsk) * 100;
      if (crossPct > 0.08) {
        this.synchronized = false;
        return { ok: false, reason: `CROSSED_BOOK_DETECTED_${bestBid}_VS_${bestAsk}` };
      }
      this.bids.delete(bestBid);
    }

    return { ok: true };
  }

  public updateTicker(price: number, change24hPct: number, timestamp: string): void {
    if (price > 0) this.lastTradePrice = price;
    if (!isNaN(change24hPct)) this.priceChange24hPct = change24hPct;
    if (timestamp) this.lastExchangeTimestamp = timestamp;
  }

  public recordTrade(price: number, size: number, side: 'BUY' | 'SELL'): void {
    const now = Date.now();
    if (now - this.recentTradeVolumeUsd.resetAt > 3000) {
      this.recentTradeVolumeUsd = { buyUsd: 0, sellUsd: 0, resetAt: now };
    }
    const usd = price * size;
    if (side === 'BUY') {
      this.recentTradeVolumeUsd.buyUsd += usd;
    } else {
      this.recentTradeVolumeUsd.sellUsd += usd;
    }
  }

  public markDisconnected(): void {
    this.synchronized = false;
  }

  public getBestBid(): number {
    let max = 0;
    for (const p of this.bids.keys()) {
      if (p > max) max = p;
    }
    return max;
  }

  public getBestAsk(): number {
    let min = Infinity;
    for (const p of this.asks.keys()) {
      if (p < min) min = p;
    }
    return min === Infinity ? 0 : min;
  }

  public getMidPrice(): number {
    const bb = this.getBestBid();
    const ba = this.getBestAsk();
    if (bb > 0 && ba > 0) return (bb + ba) / 2;
    return this.lastTradePrice || bb || ba || 0;
  }

  public getSortedLevels(maxDistancePct: number = 8): {
    bids: PriceLevel[];
    asks: PriceLevel[];
  } {
    const mid = this.getMidPrice();
    if (mid <= 0) return { bids: [], asks: [] };

    const minPrice = mid * (1 - maxDistancePct / 100);
    const maxPrice = mid * (1 + maxDistancePct / 100);

    const bids: PriceLevel[] = [];
    for (const [price, quantity] of this.bids.entries()) {
      if (price >= minPrice && price <= mid * 1.002) {
        bids.push({ price, quantity, usdValue: price * quantity });
      }
    }
    bids.sort((a, b) => b.price - a.price);

    const asks: PriceLevel[] = [];
    for (const [price, quantity] of this.asks.entries()) {
      if (price <= maxPrice && price >= mid * 0.998) {
        asks.push({ price, quantity, usdValue: price * quantity });
      }
    }
    asks.sort((a, b) => a.price - b.price);

    return { bids, asks };
  }
}

export class OrderBookManager {
  private booksByProductId: Map<string, SynchronizedOrderBook> = new Map();
  private booksByDisplaySymbol: Map<string, SynchronizedOrderBook> = new Map();

  constructor() {
    for (const prod of PRODUCTS_CONFIG) {
      const book = new SynchronizedOrderBook(
        prod.displaySymbol,
        prod.coinbaseProductId,
        prod.marketType,
        prod.bucketSize
      );
      this.booksByProductId.set(prod.coinbaseProductId, book);
      this.booksByDisplaySymbol.set(prod.displaySymbol, book);
    }
  }

  public getBookByProductId(productId: string): SynchronizedOrderBook | undefined {
    return this.booksByProductId.get(productId);
  }

  public getBookBySymbol(symbol: string): SynchronizedOrderBook | undefined {
    return this.booksByDisplaySymbol.get(symbol);
  }

  public getAllBooks(): SynchronizedOrderBook[] {
    return Array.from(this.booksByDisplaySymbol.values());
  }

  public markAllDisconnected(): void {
    for (const book of this.booksByDisplaySymbol.values()) {
      book.markDisconnected();
    }
  }
}
