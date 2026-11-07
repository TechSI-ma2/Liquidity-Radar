import type { LiquidityAlert } from '../types/radar.ts';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';

export class AlertService {
  private alertsHistory: LiquidityAlert[] = [];
  private cooldownMap: Map<string, number> = new Map();

  public processNewAlerts(candidates: LiquidityAlert[]): LiquidityAlert[] {
    const accepted: LiquidityAlert[] = [];
    const now = Date.now();

    for (const alert of candidates) {
      const priceBucket = alert.priceLevel ? Math.round(alert.priceLevel) : 0;
      const dedupKey = `${alert.symbol}:${alert.type}:${priceBucket}`;
      const lastTriggered = this.cooldownMap.get(dedupKey) || 0;

      if (now - lastTriggered < 15000) continue;

      this.cooldownMap.set(dedupKey, now);
      accepted.push(alert);
      this.alertsHistory.unshift(alert);

      if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
        this.sendTelegramAlert(alert).catch((err) =>
          console.error('[AlertService] Telegram webhook error:', err)
        );
      }
    }

    if (this.alertsHistory.length > 150) {
      this.alertsHistory.length = 150;
    }

    return accepted;
  }

  public getRecentAlerts(limit: number = 40): LiquidityAlert[] {
    return this.alertsHistory.slice(0, limit);
  }

  public async sendTelegramAlert(alert: LiquidityAlert): Promise<boolean> {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return false;
    const text = `*Liquidity Radar Alert*\n*Pair:* ${alert.symbol} (${alert.exchange})\n*Event:* ${alert.title}\n*Details:* ${alert.message}\n*Time:* ${alert.timestamp}`;
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'Markdown'
      })
    });
    return res.ok;
  }
}
