import type { HistoricalSnapshotRecord, LiquidityAlert, PairTelemetry } from '../types/radar.ts';

export class StorageService {
  private memorySnapshots: Map<string, HistoricalSnapshotRecord[]> = new Map();
  private savedAlerts: LiquidityAlert[] = [];

  public async archiveSnapshot(telemetry: PairTelemetry): Promise<void> {
    if (!telemetry.synchronized || telemetry.livePrice <= 0) return;

    const record: HistoricalSnapshotRecord = {
      ts: telemetry.lastUpdateTimestamp,
      exchange: telemetry.exchange,
      symbol: telemetry.symbol,
      midPrice: telemetry.currentHeatmapSlice.midPrice,
      bestBid: telemetry.bestBid,
      bestAsk: telemetry.bestAsk,
      totalBidUsd: telemetry.totalBuyLiquidityUsd,
      totalAskUsd: telemetry.totalSellLiquidityUsd,
      imbalancePct: telemetry.imbalancePct,
      buckets: telemetry.currentHeatmapSlice.buckets
    };

    const list = this.memorySnapshots.get(telemetry.symbol) || [];
    list.push(record);
    if (list.length > 600) list.shift();
    this.memorySnapshots.set(telemetry.symbol, list);
  }

  public async saveAlerts(alerts: LiquidityAlert[]): Promise<void> {
    if (alerts.length === 0) return;
    this.savedAlerts.unshift(...alerts);
    if (this.savedAlerts.length > 200) {
      this.savedAlerts.length = 200;
    }
  }

  public async getHistoricalSnapshots(
    symbol: string,
    limit: number = 180
  ): Promise<HistoricalSnapshotRecord[]> {
    const mem = this.memorySnapshots.get(symbol) || [];
    return mem.slice(-limit);
  }
}
