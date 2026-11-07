import type {
  BinaryPredictionContract,
  Candle15m,
  CoinbasePredictionTelemetry,
  PairTelemetry,
  PredictionSignalFactor,
  SupportedCryptoAsset
} from '../types/radar.ts';

const ASSETS: Array<{ asset: SupportedCryptoAsset; productId: string; pairSymbol: string }> = [
  { asset: 'BTC', productId: 'BTC-USD', pairSymbol: 'BTC/USDT' },
  { asset: 'ETH', productId: 'ETH-USD', pairSymbol: 'ETH/USDT' },
  { asset: 'XRP', productId: 'XRP-USD', pairSymbol: 'XRP/USDT' },
  { asset: 'SOL', productId: 'SOL-USD', pairSymbol: 'SOL/USDT' }
];

const COINBASE_V3_PRODUCTS_URL =
  process.env.COINBASE_V3_PRODUCTS_URL || 'https://api.coinbase.com/api/v3/brokerage/market/products';
const COINBASE_EXCHANGE_REST_URL =
  process.env.COINBASE_EXCHANGE_REST_URL || 'https://api.exchange.coinbase.com/products';

export class CoinbasePredictionModule {
  private candlesByAsset: Map<SupportedCryptoAsset, Map<number, Candle15m>> = new Map();
  private tradeFlowByAsset: Map<
    SupportedCryptoAsset,
    { buyUsd: number; sellUsd: number; windowStartMs: number }
  > = new Map();

  constructor() {
    for (const item of ASSETS) {
      this.candlesByAsset.set(item.asset, new Map());
      this.tradeFlowByAsset.set(item.asset, {
        buyUsd: 0,
        sellUsd: 0,
        windowStartMs: Date.now()
      });
    }
  }

  public async start(): Promise<void> {
    await this.seedAllHistorical15mCandles();
    setInterval(() => {
      this.seedAllHistorical15mCandles().catch((err) =>
        console.error('[PredictionModule] Periodic candle sync error:', err)
      );
    }, 60_000);
  }

  private async seedAllHistorical15mCandles(): Promise<void> {
    await Promise.allSettled(
      ASSETS.map((item) => this.fetchCoinbase15mCandles(item.asset, item.productId))
    );
  }

  public async fetchCoinbase15mCandles(
    asset: SupportedCryptoAsset,
    productId: string
  ): Promise<void> {
    const nowSec = Math.floor(Date.now() / 1000);
    const startSec = nowSec - 100 * 900;
    const candleMap = this.candlesByAsset.get(asset);
    if (!candleMap) return;

    // 1. Primary: Coinbase Exchange Public Candles API (granularity=900)
    try {
      const exUrl = `${COINBASE_EXCHANGE_REST_URL}/${productId}/candles?granularity=900`;
      const res = await fetch(exUrl, {
        headers: { 'User-Agent': 'LiquidityRadar-Institutional/1.0' }
      });
      if (res.ok) {
        const rows = (await res.json()) as Array<[number, number, number, number, number, number]>;
        if (Array.isArray(rows) && rows.length > 0) {
          for (const r of rows) {
            const [time, low, high, open, close, volume] = r;
            candleMap.set(time, { time, low, high, open, close, volume });
          }
          this.pruneOldCandles(candleMap);
          return;
        }
      }
    } catch {
      // Fallback to v3 public endpoint below
    }

    // 2. Fallback: Coinbase Advanced Trade v3 Public Market Data endpoint
    try {
      const v3Url = `${COINBASE_V3_PRODUCTS_URL}/${productId}/candles?start=${startSec}&end=${nowSec}&granularity=FIFTEEN_MINUTE`;
      const res = await fetch(v3Url);
      if (res.ok) {
        const data = (await res.json()) as {
          candles?: Array<{
            start: string;
            low: string;
            high: string;
            open: string;
            close: string;
            volume: string;
          }>;
        };
        if (Array.isArray(data.candles) && data.candles.length > 0) {
          for (const c of data.candles) {
            const time = parseInt(c.start, 10);
            candleMap.set(time, {
              time,
              open: parseFloat(c.open),
              high: parseFloat(c.high),
              low: parseFloat(c.low),
              close: parseFloat(c.close),
              volume: parseFloat(c.volume)
            });
          }
          this.pruneOldCandles(candleMap);
        }
      }
    } catch (err) {
      console.error(`[PredictionModule] Failed to fetch 15m candles for ${productId}:`, err);
    }
  }

  public seedCandlesForAsset(asset: SupportedCryptoAsset, candles: Candle15m[]): void {
    const candleMap = this.candlesByAsset.get(asset);
    if (!candleMap) return;
    for (const c of candles) {
      candleMap.set(c.time, { ...c });
    }
    this.pruneOldCandles(candleMap);
  }

  private pruneOldCandles(candleMap: Map<number, Candle15m>): void {
    if (candleMap.size <= 120) return;
    const sortedTimes = Array.from(candleMap.keys()).sort((a, b) => a - b);
    while (sortedTimes.length > 120) {
      const oldest = sortedTimes.shift();
      if (oldest !== undefined) candleMap.delete(oldest);
    }
  }

  public onRealtimeTick(
    productId: string,
    price: number,
    tradeSize: number = 0,
    tradeSide?: 'BUY' | 'SELL'
  ): void {
    if (price <= 0 || isNaN(price)) return;
    const prefix = productId.split('-')[0] as SupportedCryptoAsset;
    const candleMap = this.candlesByAsset.get(prefix);
    if (!candleMap) return;

    const nowSec = Math.floor(Date.now() / 1000);
    const bucketStart = Math.floor(nowSec / 900) * 900;

    const existing = candleMap.get(bucketStart);
    if (!existing) {
      candleMap.set(bucketStart, {
        time: bucketStart,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: tradeSize > 0 ? tradeSize : 0
      });
      this.pruneOldCandles(candleMap);
    } else {
      existing.high = Math.max(existing.high, price);
      existing.low = Math.min(existing.low, price);
      existing.close = price;
      if (tradeSize > 0) {
        existing.volume += tradeSize;
      }
    }

    if (tradeSize > 0 && tradeSide) {
      const flow = this.tradeFlowByAsset.get(prefix);
      if (flow) {
        const nowMs = Date.now();
        if (nowMs - flow.windowStartMs > 900_000) {
          flow.buyUsd = 0;
          flow.sellUsd = 0;
          flow.windowStartMs = nowMs;
        }
        const usd = price * tradeSize;
        if (tradeSide === 'BUY') flow.buyUsd += usd;
        else flow.sellUsd += usd;
      }
    }
  }

  public computeAllPredictions(
    pairsTelemetry: Record<string, PairTelemetry>
  ): Record<SupportedCryptoAsset, CoinbasePredictionTelemetry> {
    const result = {} as Record<SupportedCryptoAsset, CoinbasePredictionTelemetry>;

    for (const item of ASSETS) {
      const pairData =
        pairsTelemetry[item.pairSymbol] || pairsTelemetry[`${item.asset}/USD`];
      result[item.asset] = this.computeAssetPrediction(item.asset, item.productId, pairData);
    }

    return result;
  }

  public computeAssetPrediction(
    asset: SupportedCryptoAsset,
    productId: string,
    pairTelemetry?: PairTelemetry
  ): CoinbasePredictionTelemetry {
    const candleMap = this.candlesByAsset.get(asset)!;
    const sortedCandles: Candle15m[] = Array.from(candleMap.values())
      .sort((a, b) => a.time - b.time)
      .slice(-96);

    const nowSec = Math.floor(Date.now() / 1000);
    const currentCandleStart = Math.floor(nowSec / 900) * 900;
    const secondsRemainingInCandle = Math.max(0, currentCandleStart + 900 - nowSec);

    const lastCandle = sortedCandles[sortedCandles.length - 1];
    const livePrice =
      pairTelemetry?.livePrice && pairTelemetry.livePrice > 0
        ? pairTelemetry.livePrice
        : lastCandle?.close || 0;

    const k9 = 2 / (9 + 1);
    const k21 = 2 / (21 + 1);
    let ema9 = sortedCandles[0]?.close || livePrice;
    let ema21 = sortedCandles[0]?.close || livePrice;
    let cumPv = 0;
    let cumVol = 0;

    for (const c of sortedCandles) {
      ema9 = c.close * k9 + ema9 * (1 - k9);
      ema21 = c.close * k21 + ema21 * (1 - k21);
      const typicalPrice = (c.high + c.low + c.close) / 3;
      const volWeight = c.volume > 0 ? c.volume : 1;
      cumPv += typicalPrice * volWeight;
      cumVol += volWeight;
      c.ema9 = ema9;
      c.ema21 = ema21;
      c.vwap = cumVol > 0 ? cumPv / cumVol : c.close;
    }

    const vwap = cumVol > 0 ? cumPv / cumVol : livePrice;
    const rsi14 = this.calculateRSI(sortedCandles, 14);
    const atr14 = this.calculateATR(sortedCandles, 14) || livePrice * 0.004;

    const obImbalancePct = pairTelemetry?.imbalancePct || 0;
    const obScore = Math.max(-100, Math.min(100, obImbalancePct * 1.4));

    const emaSpreadPct = livePrice > 0 ? ((ema9 - ema21) / livePrice) * 100 : 0;
    const vwapDistPct = vwap > 0 ? ((livePrice - vwap) / vwap) * 100 : 0;
    const trendScore = Math.max(
      -100,
      Math.min(100, emaSpreadPct * 120 + vwapDistPct * 45)
    );

    const flow = this.tradeFlowByAsset.get(asset) || { buyUsd: 0, sellUsd: 0 };
    const totalFlowUsd = flow.buyUsd + flow.sellUsd;
    const netTradeFlowDeltaUsd = flow.buyUsd - flow.sellUsd;
    const flowImbalanceScore =
      totalFlowUsd > 0
        ? Math.max(-100, Math.min(100, (netTradeFlowDeltaUsd / totalFlowUsd) * 130))
        : 0;

    let wallMagnetScore = 0;
    if (pairTelemetry) {
      const buyWallUsd = pairTelemetry.strongestBuyWall?.usdValue || 0;
      const sellWallUsd = pairTelemetry.strongestSellWall?.usdValue || 0;
      if (buyWallUsd + sellWallUsd > 0) {
        wallMagnetScore = ((buyWallUsd - sellWallUsd) / (buyWallUsd + sellWallUsd)) * 60;
      }
    }
    const rsiCentered = (rsi14 - 50) * 1.2;
    const momentumWallScore = Math.max(
      -100,
      Math.min(100, rsiCentered * 0.5 + wallMagnetScore * 0.5)
    );

    const factors: PredictionSignalFactor[] = [
      {
        name: 'Coinbase L2 Order Book Imbalance',
        score: Math.round(obScore),
        weight: 0.35,
        detail: `${obImbalancePct >= 0 ? '+' : ''}${obImbalancePct.toFixed(1)}% net book depth skew`
      },
      {
        name: '15m EMA (9/21) & VWAP Structure',
        score: Math.round(trendScore),
        weight: 0.25,
        detail: `EMA9 $${ema9.toFixed(2)} vs VWAP $${vwap.toFixed(2)}`
      },
      {
        name: 'Coinbase Aggressive Trade Delta',
        score: Math.round(flowImbalanceScore),
        weight: 0.20,
        detail: `Net $${(netTradeFlowDeltaUsd / 1000).toFixed(1)}K aggressive flow`
      },
      {
        name: 'Liquidity Wall Support/Resistance Magnet',
        score: Math.round(momentumWallScore),
        weight: 0.20,
        detail: `RSI-14 at ${rsi14.toFixed(1)} + institutional wall skew`
      }
    ];

    const compositeScore = factors.reduce((acc, f) => acc + f.score * f.weight, 0);

    const bullishProbRaw = 100 / (1 + Math.exp(-compositeScore / 28));
    const bullishProbabilityPct = Math.round(Math.max(8, Math.min(92, bullishProbRaw)));
    const bearishProbabilityPct = 100 - bullishProbabilityPct;

    const bias: CoinbasePredictionTelemetry['bias'] =
      bullishProbabilityPct >= 55
        ? 'BULLISH'
        : bullishProbabilityPct <= 45
        ? 'BEARISH'
        : 'NEUTRAL';

    const normalizedDrift = (compositeScore / 100) * (atr14 * 0.55);
    const horizonProjections = [1, 2, 3].map((step) => {
      const predictedPrice = Math.max(0.0001, livePrice + normalizedDrift * Math.sqrt(step));
      const bandWidth = atr14 * 0.85 * Math.sqrt(step);
      return {
        step,
        time: currentCandleStart + step * 900,
        predictedPrice,
        upperBand: predictedPrice + bandWidth,
        lowerBand: Math.max(0.0001, predictedPrice - bandWidth)
      };
    });

    const next15m = horizonProjections[0];
    const expiryIso = new Date((currentCandleStart + 900) * 1000).toISOString();

    const strikeUp = Number((livePrice + atr14 * 0.5).toPrecision(5));
    const strikeDown = Number((livePrice - atr14 * 0.5).toPrecision(5));

    const probAboveCurrent = bullishProbabilityPct;
    const probAboveStrikeUp = Math.max(
      4,
      Math.min(95, Math.round(bullishProbabilityPct * 0.62))
    );
    const probAboveStrikeDown = Math.max(
      5,
      Math.min(96, Math.round(100 - bearishProbabilityPct * 0.58))
    );

    const binaryContracts: BinaryPredictionContract[] = [
      {
        contractId: `${asset}-15M-ABOVE-SPOT`,
        question: `Will ${asset} close above $${livePrice.toLocaleString()} at 15m candle close?`,
        strikePrice: livePrice,
        yesProbabilityPct: probAboveCurrent,
        noProbabilityPct: 100 - probAboveCurrent,
        expiryTimeIso: expiryIso
      },
      {
        contractId: `${asset}-15M-BULL-TARGET`,
        question: `Will ${asset} break above $${strikeUp.toLocaleString()} (+0.5 ATR) in 15m?`,
        strikePrice: strikeUp,
        yesProbabilityPct: probAboveStrikeUp,
        noProbabilityPct: 100 - probAboveStrikeUp,
        expiryTimeIso: expiryIso
      },
      {
        contractId: `${asset}-15M-SUPPORT-HOLD`,
        question: `Will ${asset} hold above $${strikeDown.toLocaleString()} (-0.5 ATR) in 15m?`,
        strikePrice: strikeDown,
        yesProbabilityPct: probAboveStrikeDown,
        noProbabilityPct: 100 - probAboveStrikeDown,
        expiryTimeIso: expiryIso
      }
    ];

    const confidenceScore = Math.min(
      98,
      Math.round(45 + Math.abs(compositeScore) * 0.55)
    );

    return {
      asset,
      productId,
      exchange: 'Coinbase Advanced Trade',
      granularity: '15m',
      lastUpdated: new Date().toISOString(),
      livePrice,
      currentCandleStart,
      secondsRemainingInCandle,
      bias,
      bullishProbabilityPct,
      bearishProbabilityPct,
      confidenceScore,
      predictedNext15mClose: next15m.predictedPrice,
      predictedRangeHigh: next15m.upperBand,
      predictedRangeLow: next15m.lowerBand,
      horizonProjections,
      indicators: {
        rsi14,
        ema9,
        ema21,
        vwap,
        atr14,
        orderBookImbalancePct: obImbalancePct,
        netTradeFlowDeltaUsd
      },
      factors,
      binaryContracts,
      candles: sortedCandles
    };
  }

  private calculateRSI(candles: Candle15m[], period: number = 14): number {
    if (candles.length <= period) return 50;
    let gains = 0;
    let losses = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
      const diff = candles[i].close - candles[i - 1].close;
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  private calculateATR(candles: Candle15m[], period: number = 14): number {
    if (candles.length <= 2) return 0;
    const slice = candles.slice(-period);
    let trSum = 0;
    for (let i = 1; i < slice.length; i++) {
      const high = slice[i].high;
      const low = slice[i].low;
      const prevClose = slice[i - 1].close;
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trSum += tr;
    }
    return trSum / Math.max(1, slice.length - 1);
  }
}
