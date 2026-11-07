import crypto from 'crypto';
import { SynchronizedOrderBook } from './orderBookManager.ts';
import type {
  HeatmapBucket,
  LiquidityAlert,
  LiquidityCluster,
  LiquidityWall,
  PairTelemetry
} from '../types/radar.ts';

interface TrackedWallState {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  usdValue: number;
  peakUsdValue: number;
  firstDetectedAt: string;
  lastObservedAt: string;
  lastSeenMs: number;
}

export class LiquidityDetector {
  private trackedWalls: Map<string, TrackedWallState> = new Map();
  private previousTotalLiquidity: Map<string, { bidUsd: number; askUsd: number; ts: number }> = new Map();
  private minWallThresholdUsd: number;

  constructor(defaultThresholdUsd: number = 25000) {
    this.minWallThresholdUsd = defaultThresholdUsd;
  }

  public setMinWallThreshold(thresholdUsd: number): void {
    if (thresholdUsd >= 1000) {
      this.minWallThresholdUsd = thresholdUsd;
    }
  }

  public getMinWallThreshold(): number {
    return this.minWallThresholdUsd;
  }

  public analyzeOrderBook(
    book: SynchronizedOrderBook,
    maxDistancePct: number = 5.0
  ): { telemetry: PairTelemetry; newAlerts: LiquidityAlert[] } {
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    const newAlerts: LiquidityAlert[] = [];

    const midPrice = book.getMidPrice();
    const bestBid = book.getBestBid();
    const bestAsk = book.getBestAsk();
    const livePrice = book.lastTradePrice > 0 ? book.lastTradePrice : midPrice;

    if (!book.synchronized || midPrice <= 0) {
      return {
        telemetry: {
          symbol: book.displaySymbol,
          productId: book.productId,
          exchange: 'Coinbase Advanced Trade',
          marketType: book.marketType,
          synchronized: false,
          sequenceNum: book.lastSequenceNum,
          lastUpdateTimestamp: book.lastExchangeTimestamp || nowIso,
          livePrice: livePrice || 0,
          priceChange24hPct: book.priceChange24hPct,
          bestBid: bestBid || 0,
          bestAsk: bestAsk || 0,
          spreadPct: 0,
          totalBuyLiquidityUsd: 0,
          totalSellLiquidityUsd: 0,
          imbalancePct: 0,
          strongestBuyWall: null,
          strongestSellWall: null,
          largestCluster: null,
          walls: [],
          clusters: [],
          topBids: [],
          topAsks: [],
          currentHeatmapSlice: { timestamp: nowMs, midPrice: 0, buckets: [] }
        },
        newAlerts
      };
    }

    const { bids, asks } = book.getSortedLevels(maxDistancePct);

    const totalBuyLiquidityUsd = bids.reduce((acc, l) => acc + l.usdValue, 0);
    const totalSellLiquidityUsd = asks.reduce((acc, l) => acc + l.usdValue, 0);
    const combinedUsd = totalBuyLiquidityUsd + totalSellLiquidityUsd;
    const imbalancePct =
      combinedUsd > 0 ? ((totalBuyLiquidityUsd - totalSellLiquidityUsd) / combinedUsd) * 100 : 0;

    const allLevels = [...bids, ...asks];
    const avgLevelUsd =
      allLevels.length > 0 ? combinedUsd / allLevels.length : this.minWallThresholdUsd;

    const detectedWalls: LiquidityWall[] = [];
    const currentCycleWallKeys = new Set<string>();

    // Adaptive effective threshold for thinner books so walls are always surfaced accurately
    const effectiveThreshold = Math.min(
      this.minWallThresholdUsd,
      Math.max(5000, avgLevelUsd * 2.5)
    );

    const evaluateSide = (levels: typeof bids, side: 'BUY' | 'SELL') => {
      for (let i = 0; i < levels.length; i++) {
        const lvl = levels[i];
        if (lvl.usdValue < effectiveThreshold) continue;

        const startIdx = Math.max(0, i - 10);
        const endIdx = Math.min(levels.length - 1, i + 10);
        let neighborSum = 0;
        let neighborCount = 0;
        for (let j = startIdx; j <= endIdx; j++) {
          if (j !== i) {
            neighborSum += levels[j].usdValue;
            neighborCount++;
          }
        }
        const localAvgUsd = neighborCount > 0 ? neighborSum / neighborCount : avgLevelUsd;
        const relativeSizeRatio = localAvgUsd > 0 ? lvl.usdValue / localAvgUsd : 1;

        if (relativeSizeRatio < 1.3 && lvl.usdValue < this.minWallThresholdUsd) {
          continue;
        }

        const priceKey = `${book.displaySymbol}:${side}:${lvl.price.toFixed(4)}`;
        currentCycleWallKeys.add(priceKey);

        let tracked = this.trackedWalls.get(priceKey);
        let unusualSignal: LiquidityWall['unusualSignal'] = 'NONE';

        if (!tracked) {
          let migratedFromPrice: number | null = null;
          for (const [oldKey, oldWall] of this.trackedWalls.entries()) {
            if (
              oldWall.symbol === book.displaySymbol &&
              oldWall.side === side &&
              nowMs - oldWall.lastSeenMs < 2500 &&
              Math.abs(oldWall.usdValue - lvl.usdValue) / Math.max(1, oldWall.usdValue) < 0.15 &&
              oldWall.price !== lvl.price
            ) {
              migratedFromPrice = oldWall.price;
              this.trackedWalls.delete(oldKey);
              break;
            }
          }

          tracked = {
            id: crypto.randomUUID(),
            symbol: book.displaySymbol,
            side,
            price: lvl.price,
            quantity: lvl.quantity,
            usdValue: lvl.usdValue,
            peakUsdValue: lvl.usdValue,
            firstDetectedAt: nowIso,
            lastObservedAt: nowIso,
            lastSeenMs: nowMs
          };
          this.trackedWalls.set(priceKey, tracked);

          if (migratedFromPrice !== null) {
            unusualSignal = 'MIGRATED_WALL';
            newAlerts.push({
              id: crypto.randomUUID(),
              timestamp: nowIso,
              exchange: 'Coinbase Advanced Trade',
              symbol: book.displaySymbol,
              type: 'WALL_MOVED',
              severity: 'WARNING',
              title: `${book.displaySymbol} ${side} Wall Migrated`,
              message: `$${(lvl.usdValue / 1000).toFixed(1)}K ${side} wall shifted from $${migratedFromPrice.toLocaleString()} to $${lvl.price.toLocaleString()}`,
              priceLevel: lvl.price,
              usdValue: lvl.usdValue
            });
          } else if (lvl.usdValue >= this.minWallThresholdUsd) {
            newAlerts.push({
              id: crypto.randomUUID(),
              timestamp: nowIso,
              exchange: 'Coinbase Advanced Trade',
              symbol: book.displaySymbol,
              type: side === 'BUY' ? 'BUY_WALL_APPEARED' : 'SELL_WALL_APPEARED',
              severity: lvl.usdValue >= this.minWallThresholdUsd * 4 ? 'CRITICAL' : 'INFO',
              title: `Large ${book.displaySymbol} ${side} Wall Detected`,
              message: `${lvl.quantity.toFixed(3)} ($${(lvl.usdValue / 1000).toFixed(1)}K) at $${lvl.price.toLocaleString()} (${relativeSizeRatio.toFixed(1)}x local avg)`,
              priceLevel: lvl.price,
              usdValue: lvl.usdValue
            });
          }
        } else {
          if (lvl.usdValue > tracked.peakUsdValue * 1.4) {
            unusualSignal = 'RAPID_RELOAD';
          }
          tracked.quantity = lvl.quantity;
          tracked.usdValue = lvl.usdValue;
          tracked.peakUsdValue = Math.max(tracked.peakUsdValue, lvl.usdValue);
          tracked.lastObservedAt = nowIso;
          tracked.lastSeenMs = nowMs;
        }

        const distanceFromMidPct = ((lvl.price - midPrice) / midPrice) * 100;
        let strength: LiquidityWall['strength'] = 'MODERATE';
        if (lvl.usdValue >= this.minWallThresholdUsd * 6 || relativeSizeRatio >= 10) {
          strength = 'WHALE';
        } else if (lvl.usdValue >= this.minWallThresholdUsd * 3 || relativeSizeRatio >= 5) {
          strength = 'INSTITUTIONAL';
        } else if (lvl.usdValue >= this.minWallThresholdUsd * 1.5 || relativeSizeRatio >= 2.5) {
          strength = 'STRONG';
        }

        detectedWalls.push({
          id: tracked.id,
          symbol: book.displaySymbol,
          exchange: 'Coinbase Advanced Trade',
          marketType: book.marketType,
          side,
          price: lvl.price,
          quantity: lvl.quantity,
          usdValue: lvl.usdValue,
          distanceFromMidPct,
          firstDetectedAt: tracked.firstDetectedAt,
          lastObservedAt: tracked.lastObservedAt,
          relativeSizeRatio,
          strength,
          unusualSignal
        });
      }
    };

    evaluateSide(bids, 'BUY');
    evaluateSide(asks, 'SELL');

    for (const [key, tracked] of this.trackedWalls.entries()) {
      if (tracked.symbol !== book.displaySymbol) continue;
      if (!currentCycleWallKeys.has(key) && nowMs - tracked.lastSeenMs > 1500) {
        if (tracked.peakUsdValue >= this.minWallThresholdUsd * 1.5) {
          const executedUsd =
            tracked.side === 'BUY'
              ? book.recentTradeVolumeUsd.sellUsd
              : book.recentTradeVolumeUsd.buyUsd;
          const likelyPulled = executedUsd < tracked.peakUsdValue * 0.25;

          newAlerts.push({
            id: crypto.randomUUID(),
            timestamp: nowIso,
            exchange: 'Coinbase Advanced Trade',
            symbol: book.displaySymbol,
            type: 'WALL_DISAPPEARED',
            severity: 'WARNING',
            title: `${book.displaySymbol} ${tracked.side} Wall Removed`,
            message: likelyPulled
              ? `$${(tracked.peakUsdValue / 1000).toFixed(1)}K wall at $${tracked.price.toLocaleString()} vanished with minimal trade volume (Potential Liquidity Pull Signal — Unconfirmed)`
              : `$${(tracked.peakUsdValue / 1000).toFixed(1)}K wall at $${tracked.price.toLocaleString()} absorbed by market flow`,
            priceLevel: tracked.price,
            usdValue: tracked.peakUsdValue
          });
        }
        this.trackedWalls.delete(key);
      }
    }

    detectedWalls.sort((a, b) => b.usdValue - a.usdValue);

    const bucketSize = book.bucketSize;
    const centerBucket = Math.round(midPrice / bucketSize) * bucketSize;
    const numBucketsEachSide = 28;
    const bucketMap = new Map<number, { bidUsd: number; askUsd: number; bidQty: number; askQty: number }>();

    for (let i = -numBucketsEachSide; i <= numBucketsEachSide; i++) {
      const bPrice = Number((centerBucket + i * bucketSize).toFixed(4));
      if (bPrice > 0) {
        bucketMap.set(bPrice, { bidUsd: 0, askUsd: 0, bidQty: 0, askQty: 0 });
      }
    }

    for (const b of bids) {
      const bPrice = Number((Math.round(b.price / bucketSize) * bucketSize).toFixed(4));
      const entry = bucketMap.get(bPrice);
      if (entry) {
        entry.bidUsd += b.usdValue;
        entry.bidQty += b.quantity;
      }
    }

    for (const a of asks) {
      const bPrice = Number((Math.round(a.price / bucketSize) * bucketSize).toFixed(4));
      const entry = bucketMap.get(bPrice);
      if (entry) {
        entry.askUsd += a.usdValue;
        entry.askQty += a.quantity;
      }
    }

    let maxBucketUsd = 1;
    for (const v of bucketMap.values()) {
      maxBucketUsd = Math.max(maxBucketUsd, v.bidUsd, v.askUsd);
    }

    const heatmapBuckets: HeatmapBucket[] = [];
    for (const [price, v] of bucketMap.entries()) {
      const dominantSide =
        v.bidUsd > v.askUsd ? 'BUY' : v.askUsd > v.bidUsd ? 'SELL' : 'NEUTRAL';
      const dominantUsd = Math.max(v.bidUsd, v.askUsd);
      const intensity = Math.min(1, dominantUsd / maxBucketUsd);
      heatmapBuckets.push({
        price,
        bidUsd: v.bidUsd,
        askUsd: v.askUsd,
        bidQty: v.bidQty,
        askQty: v.askQty,
        dominantSide,
        intensity,
        isWhaleWall: dominantUsd >= effectiveThreshold * 1.5 && intensity >= 0.65
      });
    }
    heatmapBuckets.sort((a, b) => b.price - a.price);

    const clusters: LiquidityCluster[] = [];
    const sortedAscBuckets = [...heatmapBuckets].sort((a, b) => a.price - b.price);

    for (let i = 0; i < sortedAscBuckets.length; i++) {
      const b = sortedAscBuckets[i];
      const totalBucketUsd = b.bidUsd + b.askUsd;
      if (totalBucketUsd < effectiveThreshold * 0.6) continue;

      const side: 'BUY' | 'SELL' = b.bidUsd >= b.askUsd ? 'BUY' : 'SELL';
      const zoneLow = b.price - bucketSize / 2;
      let zoneHigh = b.price + bucketSize / 2;
      let sumUsd = side === 'BUY' ? b.bidUsd : b.askUsd;
      let sumQty = side === 'BUY' ? b.bidQty : b.askQty;
      let weightedPriceSum = b.price * sumUsd;
      let levelCount = 1;

      while (i + 1 < sortedAscBuckets.length) {
        const nextB = sortedAscBuckets[i + 1];
        const nextSide = nextB.bidUsd >= nextB.askUsd ? 'BUY' : 'SELL';
        const nextUsd = side === 'BUY' ? nextB.bidUsd : nextB.askUsd;
        if (nextSide === side && nextUsd >= effectiveThreshold * 0.4) {
          zoneHigh = nextB.price + bucketSize / 2;
          sumUsd += nextUsd;
          sumQty += side === 'BUY' ? nextB.bidQty : nextB.askQty;
          weightedPriceSum += nextB.price * nextUsd;
          levelCount++;
          i++;
        } else {
          break;
        }
      }

      if (sumUsd >= effectiveThreshold * 0.8) {
        const centroidPrice = sumUsd > 0 ? weightedPriceSum / sumUsd : b.price;
        const distanceFromMidPct = ((centroidPrice - midPrice) / midPrice) * 100;
        const strengthScore = Math.min(100, Math.round((sumUsd / (maxBucketUsd * 1.3)) * 100));

        clusters.push({
          id: `${book.displaySymbol}-cluster-${centroidPrice.toFixed(4)}`,
          symbol: book.displaySymbol,
          side,
          zoneLow,
          zoneHigh,
          centroidPrice,
          totalUsdValue: sumUsd,
          totalQuantity: sumQty,
          distanceFromMidPct,
          levelCount,
          strengthScore
        });

        if (Math.abs(distanceFromMidPct) <= 0.15 && sumUsd >= this.minWallThresholdUsd * 2) {
          newAlerts.push({
            id: crypto.randomUUID(),
            timestamp: nowIso,
            exchange: 'Coinbase Advanced Trade',
            symbol: book.displaySymbol,
            type: 'PRICE_NEAR_CLUSTER',
            severity: 'INFO',
            title: `${book.displaySymbol} Testing ${side === 'BUY' ? 'Support' : 'Resistance'} Cluster`,
            message: `Price ($${livePrice.toLocaleString()}) is within ${Math.abs(distanceFromMidPct).toFixed(2)}% of a $${(sumUsd / 1000).toFixed(0)}K liquidity zone`,
            priceLevel: centroidPrice,
            usdValue: sumUsd
          });
        }
      }
    }

    clusters.sort((a, b) => b.totalUsdValue - a.totalUsdValue);

    const prevLiq = this.previousTotalLiquidity.get(book.displaySymbol);
    if (prevLiq && nowMs - prevLiq.ts >= 5000) {
      const prevCombined = prevLiq.bidUsd + prevLiq.askUsd;
      if (prevCombined > 0) {
        const deltaRatio = (combinedUsd - prevCombined) / prevCombined;
        if (deltaRatio >= 0.35) {
          newAlerts.push({
            id: crypto.randomUUID(),
            timestamp: nowIso,
            exchange: 'Coinbase Advanced Trade',
            symbol: book.displaySymbol,
            type: 'LIQUIDITY_SURGE',
            severity: 'INFO',
            title: `${book.displaySymbol} Liquidity Surge (+${(deltaRatio * 100).toFixed(0)}%)`,
            message: `Order book depth expanded to $${(combinedUsd / 1_000_000).toFixed(2)}M`,
            usdValue: combinedUsd
          });
        } else if (deltaRatio <= -0.35) {
          newAlerts.push({
            id: crypto.randomUUID(),
            timestamp: nowIso,
            exchange: 'Coinbase Advanced Trade',
            symbol: book.displaySymbol,
            type: 'LIQUIDITY_DRAIN',
            severity: 'WARNING',
            title: `${book.displaySymbol} Liquidity Drain (${(deltaRatio * 100).toFixed(0)}%)`,
            message: `Visible depth contracted rapidly to $${(combinedUsd / 1_000_000).toFixed(2)}M`,
            usdValue: combinedUsd
          });
        }
      }
      if (Math.abs(imbalancePct) >= 50) {
        newAlerts.push({
          id: crypto.randomUUID(),
          timestamp: nowIso,
          exchange: 'Coinbase Advanced Trade',
          symbol: book.displaySymbol,
          type: 'ORDERBOOK_IMBALANCE',
          severity: 'WARNING',
          title: `${book.displaySymbol} Heavy Order Book Imbalance`,
          message: `${imbalancePct > 0 ? 'Buy-side' : 'Sell-side'} dominates book with ${imbalancePct.toFixed(1)}% net imbalance`,
          usdValue: combinedUsd
        });
      }
      this.previousTotalLiquidity.set(book.displaySymbol, {
        bidUsd: totalBuyLiquidityUsd,
        askUsd: totalSellLiquidityUsd,
        ts: nowMs
      });
    } else if (!prevLiq) {
      this.previousTotalLiquidity.set(book.displaySymbol, {
        bidUsd: totalBuyLiquidityUsd,
        askUsd: totalSellLiquidityUsd,
        ts: nowMs
      });
    }

    const strongestBuyWall = detectedWalls.find((w) => w.side === 'BUY') || null;
    const strongestSellWall = detectedWalls.find((w) => w.side === 'SELL') || null;
    const largestCluster = clusters[0] || null;
    const spreadPct = bestAsk > 0 && bestBid > 0 ? ((bestAsk - bestBid) / bestAsk) * 100 : 0;

    return {
      telemetry: {
        symbol: book.displaySymbol,
        productId: book.productId,
        exchange: 'Coinbase Advanced Trade',
        marketType: book.marketType,
        synchronized: true,
        sequenceNum: book.lastSequenceNum,
        lastUpdateTimestamp: book.lastExchangeTimestamp || nowIso,
        livePrice,
        priceChange24hPct: book.priceChange24hPct,
        bestBid,
        bestAsk,
        spreadPct,
        totalBuyLiquidityUsd,
        totalSellLiquidityUsd,
        imbalancePct,
        strongestBuyWall,
        strongestSellWall,
        largestCluster,
        walls: detectedWalls.slice(0, 40),
        clusters: clusters.slice(0, 16),
        topBids: bids.slice(0, 30),
        topAsks: asks.slice(0, 30),
        currentHeatmapSlice: {
          timestamp: nowMs,
          midPrice,
          buckets: heatmapBuckets
        }
      },
      newAlerts
    };
  }
}
