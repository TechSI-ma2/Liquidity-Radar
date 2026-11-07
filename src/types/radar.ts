export type MarketType = 'SPOT' | 'FUTURES';
export type ConnectionStatus = 'CONNECTED' | 'CONNECTING' | 'RESYNCING' | 'DISCONNECTED' | 'ERROR';
export type SupportedCryptoAsset = 'BTC' | 'ETH' | 'XRP' | 'SOL';

export interface ProductConfig {
  asset: SupportedCryptoAsset;
  displaySymbol: string;
  coinbaseProductId: string;
  candleProductId: string;
  marketType: MarketType;
  bucketSize: number;
}

export const PRODUCTS_CONFIG: ProductConfig[] = [
  { asset: 'BTC', displaySymbol: 'BTC/USDT', coinbaseProductId: 'BTC-USDT', candleProductId: 'BTC-USD', marketType: 'SPOT', bucketSize: 25 },
  { asset: 'ETH', displaySymbol: 'ETH/USDT', coinbaseProductId: 'ETH-USDT', candleProductId: 'ETH-USD', marketType: 'SPOT', bucketSize: 2 },
  { asset: 'XRP', displaySymbol: 'XRP/USDT', coinbaseProductId: 'XRP-USDT', candleProductId: 'XRP-USD', marketType: 'SPOT', bucketSize: 0.005 },
  { asset: 'SOL', displaySymbol: 'SOL/USDT', coinbaseProductId: 'SOL-USDT', candleProductId: 'SOL-USD', marketType: 'SPOT', bucketSize: 0.25 },
  { asset: 'BTC', displaySymbol: 'BTC/USD', coinbaseProductId: 'BTC-USD', candleProductId: 'BTC-USD', marketType: 'SPOT', bucketSize: 25 },
  { asset: 'ETH', displaySymbol: 'ETH/USD', coinbaseProductId: 'ETH-USD', candleProductId: 'ETH-USD', marketType: 'SPOT', bucketSize: 2 },
  { asset: 'XRP', displaySymbol: 'XRP/USD', coinbaseProductId: 'XRP-USD', candleProductId: 'XRP-USD', marketType: 'SPOT', bucketSize: 0.005 },
  { asset: 'SOL', displaySymbol: 'SOL/USD', coinbaseProductId: 'SOL-USD', candleProductId: 'SOL-USD', marketType: 'SPOT', bucketSize: 0.25 }
];

export interface PriceLevel {
  price: number;
  quantity: number;
  usdValue: number;
}

export interface HeatmapBucket {
  price: number;
  bidUsd: number;
  askUsd: number;
  bidQty: number;
  askQty: number;
  dominantSide: 'BUY' | 'SELL' | 'NEUTRAL';
  intensity: number;
  isWhaleWall: boolean;
}

export interface HeatmapSlice {
  timestamp: number;
  midPrice: number;
  buckets: HeatmapBucket[];
}

export interface LiquidityWall {
  id: string;
  symbol: string;
  exchange: string;
  marketType: MarketType;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  usdValue: number;
  distanceFromMidPct: number;
  firstDetectedAt: string;
  lastObservedAt: string;
  relativeSizeRatio: number;
  strength: 'MODERATE' | 'STRONG' | 'INSTITUTIONAL' | 'WHALE';
  unusualSignal?: 'NONE' | 'POTENTIAL_SPOOF_PULL' | 'RAPID_RELOAD' | 'MIGRATED_WALL';
}

export interface LiquidityCluster {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  zoneLow: number;
  zoneHigh: number;
  centroidPrice: number;
  totalUsdValue: number;
  totalQuantity: number;
  distanceFromMidPct: number;
  levelCount: number;
  strengthScore: number;
}

export interface LiquidityAlert {
  id: string;
  timestamp: string;
  exchange: string;
  symbol: string;
  type:
    | 'BUY_WALL_APPEARED'
    | 'SELL_WALL_APPEARED'
    | 'WALL_DISAPPEARED'
    | 'WALL_MOVED'
    | 'LIQUIDITY_SURGE'
    | 'LIQUIDITY_DRAIN'
    | 'PRICE_NEAR_CLUSTER'
    | 'ORDERBOOK_IMBALANCE';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  message: string;
  priceLevel?: number;
  usdValue?: number;
}

export interface Candle15m {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema9?: number;
  ema21?: number;
  vwap?: number;
}

export interface PredictionSignalFactor {
  name: string;
  score: number;
  weight: number;
  detail: string;
}

export interface BinaryPredictionContract {
  contractId: string;
  question: string;
  strikePrice: number;
  yesProbabilityPct: number;
  noProbabilityPct: number;
  expiryTimeIso: string;
}

export interface CoinbasePredictionTelemetry {
  asset: SupportedCryptoAsset;
  productId: string;
  exchange: string;
  granularity: '15m';
  lastUpdated: string;
  livePrice: number;
  currentCandleStart: number;
  secondsRemainingInCandle: number;
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  bullishProbabilityPct: number;
  bearishProbabilityPct: number;
  confidenceScore: number;
  predictedNext15mClose: number;
  predictedRangeHigh: number;
  predictedRangeLow: number;
  horizonProjections: Array<{
    step: number;
    time: number;
    predictedPrice: number;
    upperBand: number;
    lowerBand: number;
  }>;
  indicators: {
    rsi14: number;
    ema9: number;
    ema21: number;
    vwap: number;
    atr14: number;
    orderBookImbalancePct: number;
    netTradeFlowDeltaUsd: number;
  };
  factors: PredictionSignalFactor[];
  binaryContracts: BinaryPredictionContract[];
  candles: Candle15m[];
}

export interface PairTelemetry {
  symbol: string;
  productId: string;
  exchange: string;
  marketType: MarketType;
  synchronized: boolean;
  sequenceNum: number;
  lastUpdateTimestamp: string;
  livePrice: number;
  priceChange24hPct: number;
  bestBid: number;
  bestAsk: number;
  spreadPct: number;
  totalBuyLiquidityUsd: number;
  totalSellLiquidityUsd: number;
  imbalancePct: number;
  strongestBuyWall: LiquidityWall | null;
  strongestSellWall: LiquidityWall | null;
  largestCluster: LiquidityCluster | null;
  walls: LiquidityWall[];
  clusters: LiquidityCluster[];
  topBids: PriceLevel[];
  topAsks: PriceLevel[];
  currentHeatmapSlice: HeatmapSlice;
}

export interface HistoricalSnapshotRecord {
  ts: string;
  exchange: string;
  symbol: string;
  midPrice: number;
  bestBid: number;
  bestAsk: number;
  totalBidUsd: number;
  totalAskUsd: number;
  imbalancePct: number;
  buckets: HeatmapBucket[];
}

export interface RadarBroadcastPayload {
  type: 'RADAR_STATE_UPDATE';
  serverTimestamp: string;
  exchangeStatus: {
    exchange: string;
    endpoint: string;
    status: ConnectionStatus;
    lastHeartbeat: string | null;
    reconnectCount: number;
    latencyMs: number;
  };
  pairs: Record<string, PairTelemetry>;
  predictions: Record<SupportedCryptoAsset, CoinbasePredictionTelemetry>;
  recentAlerts: LiquidityAlert[];
}
