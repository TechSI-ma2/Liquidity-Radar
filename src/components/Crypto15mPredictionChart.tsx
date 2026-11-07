import React, { useEffect, useRef, useState } from 'react';
import {
  Candle15m,
  CoinbasePredictionTelemetry,
  PairTelemetry,
  SupportedCryptoAsset
} from '../types/radar';

interface Props {
  predictions: Record<SupportedCryptoAsset, CoinbasePredictionTelemetry> | undefined;
  pairs: Record<string, PairTelemetry> | undefined;
  selectedAsset: SupportedCryptoAsset;
  onSelectAsset: (asset: SupportedCryptoAsset) => void;
}

const ASSET_OPTIONS: Array<{
  asset: SupportedCryptoAsset;
  name: string;
  pairKey: string;
}> = [
  { asset: 'BTC', name: 'Bitcoin (BTC)', pairKey: 'BTC/USDT' },
  { asset: 'ETH', name: 'Ethereum (ETH)', pairKey: 'ETH/USDT' },
  { asset: 'XRP', name: 'XRP (XRP)', pairKey: 'XRP/USDT' },
  { asset: 'SOL', name: 'Solana (SOL)', pairKey: 'SOL/USDT' }
];

export const Crypto15mPredictionChart: React.FC<Props> = ({
  predictions,
  pairs,
  selectedAsset,
  onSelectAsset
}) => {
  const [visibleCandleCount, setVisibleCandleCount] = useState<number>(64);
  const [hoveredCandle, setHoveredCandle] = useState<Candle15m | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const pred = predictions?.[selectedAsset];
  const pairTelemetry = pairs?.[`${selectedAsset}/USDT`] || pairs?.[`${selectedAsset}/USD`];

  const formatPrice = (val: number) => {
    if (!val && val !== 0) return '$0.00';
    if (val < 10) return `$${val.toFixed(4)}`;
    if (val < 1000) return `$${val.toFixed(2)}`;
    return `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const rightAxisWidth = 94;
    const bottomAxisHeight = 28;
    const plotWidth = width - rightAxisWidth;
    const plotHeight = height - bottomAxisHeight;
    const volumeHeight = plotHeight * 0.18;

    ctx.fillStyle = '#070B12';
    ctx.fillRect(0, 0, width, height);

    if (!pred || !pred.candles || pred.candles.length === 0) {
      ctx.fillStyle = '#64748B';
      ctx.font = '12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        `Loading live 15-minute Coinbase candles & prediction model for ${selectedAsset}...`,
        plotWidth / 2,
        plotHeight / 2
      );
      return;
    }

    const candles = pred.candles.slice(-visibleCandleCount);
    const futureSlots = 4;
    const totalSlots = candles.length + futureSlots;
    const slotWidth = plotWidth / Math.max(1, totalSlots);

    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let maxVol = 1;

    for (const c of candles) {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
      if (c.volume > maxVol) maxVol = c.volume;
    }

    for (const proj of pred.horizonProjections) {
      if (proj.lowerBand < minPrice) minPrice = proj.lowerBand;
      if (proj.upperBand > maxPrice) maxPrice = proj.upperBand;
    }

    const padding = (maxPrice - minPrice) * 0.08 || maxPrice * 0.01;
    minPrice -= padding;
    maxPrice += padding;
    const priceSpan = Math.max(0.00001, maxPrice - minPrice);

    const priceToY = (p: number) =>
      ((maxPrice - p) / priceSpan) * (plotHeight - volumeHeight - 16) + 8;

    // 1. Horizontal Grid Lines & Right Price Axis Labels
    ctx.strokeStyle = '#111827';
    ctx.lineWidth = 1;
    const gridSteps = 7;
    for (let i = 0; i <= gridSteps; i++) {
      const y = (i / gridSteps) * (plotHeight - volumeHeight);
      const pVal = maxPrice - (i / gridSteps) * priceSpan;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(plotWidth, y);
      ctx.stroke();

      ctx.fillStyle = '#64748B';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      const labelY = Math.max(13, Math.min(plotHeight - 6, y + 4));
      ctx.fillText(formatPrice(pVal), plotWidth + 6, labelY);
    }

    // 2. Strongest Buy Wall & Sell Wall Horizontal Liquidity Lines
    if (pairTelemetry?.strongestBuyWall) {
      const bwPrice = pairTelemetry.strongestBuyWall.price;
      if (bwPrice >= minPrice && bwPrice <= maxPrice) {
        const y = priceToY(bwPrice);
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.65)';
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(plotWidth, y);
        ctx.stroke();
        ctx.fillStyle = '#10B981';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillText(
          `BUY WALL ${formatPrice(bwPrice)} ($${(pairTelemetry.strongestBuyWall.usdValue / 1000).toFixed(0)}K)`,
          8,
          y - 4
        );
        ctx.restore();
      }
    }

    if (pairTelemetry?.strongestSellWall) {
      const swPrice = pairTelemetry.strongestSellWall.price;
      if (swPrice >= minPrice && swPrice <= maxPrice) {
        const y = priceToY(swPrice);
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.65)';
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(plotWidth, y);
        ctx.stroke();
        ctx.fillStyle = '#F43F5E';
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.fillText(
          `SELL WALL ${formatPrice(swPrice)} ($${(pairTelemetry.strongestSellWall.usdValue / 1000).toFixed(0)}K)`,
          8,
          y - 4
        );
        ctx.restore();
      }
    }

    // 3. Draw 15m Candlesticks & Volume Bars
    const candleBodyWidth = Math.max(3, Math.min(14, slotWidth * 0.68));
    candles.forEach((c, idx) => {
      const cx = idx * slotWidth + slotWidth / 2;
      const isBull = c.close >= c.open;
      const color = isBull ? '#10B981' : '#F43F5E';

      const vHeight = (c.volume / maxVol) * volumeHeight;
      ctx.fillStyle = isBull
        ? 'rgba(16, 185, 129, 0.22)'
        : 'rgba(244, 63, 94, 0.22)';
      ctx.fillRect(
        cx - candleBodyWidth / 2,
        plotHeight - vHeight,
        candleBodyWidth,
        vHeight
      );

      const highY = priceToY(c.high);
      const lowY = priceToY(c.low);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx, highY);
      ctx.lineTo(cx, lowY);
      ctx.stroke();

      const openY = priceToY(c.open);
      const closeY = priceToY(c.close);
      const bodyTop = Math.min(openY, closeY);
      const bodyHeight = Math.max(2, Math.abs(closeY - openY));
      ctx.fillStyle = color;
      ctx.fillRect(
        cx - candleBodyWidth / 2,
        bodyTop,
        candleBodyWidth,
        bodyHeight
      );
    });

    // 4. Draw EMA-9 & EMA-21 Overlay Lines
    const drawOverlayLine = (
      getter: (c: Candle15m) => number | undefined,
      stroke: string
    ) => {
      ctx.beginPath();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      let started = false;
      candles.forEach((c, idx) => {
        const val = getter(c);
        if (!val) return;
        const x = idx * slotWidth + slotWidth / 2;
        const y = priceToY(val);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
    };

    drawOverlayLine((c) => c.ema9, '#38BDF8');
    drawOverlayLine((c) => c.ema21, '#F59E0B');

    // 5. Draw Coinbase Prediction Module Cone (+15m, +30m, +45m ahead)
    if (pred.horizonProjections.length > 0) {
      const lastIdx = candles.length - 1;
      const startX = lastIdx * slotWidth + slotWidth / 2;
      const startY = priceToY(pred.livePrice);

      const coneColor =
        pred.bias === 'BULLISH'
          ? 'rgba(16, 185, 129, 0.18)'
          : pred.bias === 'BEARISH'
          ? 'rgba(244, 63, 94, 0.18)'
          : 'rgba(56, 189, 248, 0.18)';

      const strokeColor =
        pred.bias === 'BULLISH'
          ? '#10B981'
          : pred.bias === 'BEARISH'
          ? '#F43F5E'
          : '#38BDF8';

      ctx.beginPath();
      ctx.moveTo(startX, startY);
      pred.horizonProjections.forEach((p) => {
        const px = (lastIdx + p.step) * slotWidth + slotWidth / 2;
        const py = priceToY(p.upperBand);
        ctx.lineTo(px, py);
      });
      for (let i = pred.horizonProjections.length - 1; i >= 0; i--) {
        const p = pred.horizonProjections[i];
        const px = (lastIdx + p.step) * slotWidth + slotWidth / 2;
        const py = priceToY(p.lowerBand);
        ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = coneColor;
      ctx.fill();

      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      pred.horizonProjections.forEach((p) => {
        const px = (lastIdx + p.step) * slotWidth + slotWidth / 2;
        const py = priceToY(p.predictedPrice);
        ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();

      pred.horizonProjections.forEach((p) => {
        const px = (lastIdx + p.step) * slotWidth + slotWidth / 2;
        const py = priceToY(p.predictedPrice);
        ctx.beginPath();
        ctx.arc(px, py, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = strokeColor;
        ctx.fill();
      });
    }

    // 6. Live Price & Predicted 15m Target Tags on Right Axis
    const liveY = priceToY(pred.livePrice);
    ctx.fillStyle = '#0284C7';
    ctx.fillRect(plotWidth + 2, liveY - 9, rightAxisWidth - 4, 18);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.fillText(formatPrice(pred.livePrice), plotWidth + 6, liveY + 3);

    const predY = priceToY(pred.predictedNext15mClose);
    ctx.fillStyle =
      pred.bias === 'BULLISH'
        ? '#059669'
        : pred.bias === 'BEARISH'
        ? '#E11D48'
        : '#475569';
    ctx.fillRect(plotWidth + 2, predY - 9, rightAxisWidth - 4, 18);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(formatPrice(pred.predictedNext15mClose), plotWidth + 6, predY + 3);

    // 7. Bottom Time Axis
    ctx.fillStyle = '#0D131F';
    ctx.fillRect(0, plotHeight, width, bottomAxisHeight);
    ctx.fillStyle = '#64748B';
    ctx.font = '10px "JetBrains Mono", monospace';
    const step = Math.max(1, Math.floor(candles.length / 7));
    for (let i = 0; i < candles.length; i += step) {
      const x = i * slotWidth;
      const d = new Date(candles[i].time * 1000);
      const label = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      ctx.fillText(label, x + 4, plotHeight + 18);
    }
  }, [pred, pairTelemetry, selectedAsset, visibleCandleCount]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current || !pred || pred.candles.length === 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const plotWidth = rect.width - 94;
    const candles = pred.candles.slice(-visibleCandleCount);
    const totalSlots = candles.length + 4;
    const slotWidth = plotWidth / totalSlots;
    const idx = Math.floor(x / slotWidth);
    if (idx >= 0 && idx < candles.length) {
      setHoveredCandle(candles[idx]);
    } else {
      setHoveredCandle(null);
    }
  };

  const minsLeft = pred ? Math.floor(pred.secondsRemainingInCandle / 60) : 0;
  const secsLeft = pred ? pred.secondsRemainingInCandle % 60 : 0;

  return (
    <div className="space-y-4">
      {/* Top Bar: Dropdown Selector for BTC, ETH, XRP, SOL + 15m Prediction Header */}
      <div className="bg-[#0D131F] border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-5">
          <div>
            <label
              htmlFor="crypto-15m-asset-select"
              className="block text-xs text-slate-400 mb-1"
            >
              Select Crypto Asset (15m Timeframe)
            </label>
            <select
              id="crypto-15m-asset-select"
              aria-label="Select Crypto Asset"
              value={selectedAsset}
              onChange={(e) => onSelectAsset(e.target.value as SupportedCryptoAsset)}
              className="bg-slate-900 border border-sky-500/50 text-slate-100 text-sm font-semibold rounded-lg px-3.5 py-2 font-mono focus:outline-none focus:border-sky-400 cursor-pointer"
            >
              {ASSET_OPTIONS.map((opt) => (
                <option key={opt.asset} value={opt.asset}>
                  {opt.name} — 15m Chart & Prediction
                </option>
              ))}
            </select>
          </div>

          {pred && (
            <div className="flex flex-wrap items-center gap-6 pl-4 border-l border-slate-800 font-mono tabular-nums">
              <div>
                <div className="text-xs text-slate-400">Coinbase Live Price</div>
                <div className="text-lg font-bold text-white">
                  {formatPrice(pred.livePrice)}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Predicted Next 15m Close</div>
                <div
                  className={`text-lg font-bold ${
                    pred.bias === 'BULLISH'
                      ? 'text-emerald-400'
                      : pred.bias === 'BEARISH'
                      ? 'text-rose-400'
                      : 'text-sky-400'
                  }`}
                >
                  {formatPrice(pred.predictedNext15mClose)}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">15m Bar Countdown</div>
                <div className="text-sm font-semibold text-sky-400">
                  {String(minsLeft).padStart(2, '0')}m : {String(secsLeft).padStart(2, '0')}s
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-slate-400">History Window:</span>
          {[36, 64, 96].map((count) => (
            <button
              key={count}
              type="button"
              onClick={() => setVisibleCandleCount(count)}
              className={`px-2.5 py-1 rounded border transition whitespace-nowrap shrink-0 ${
                visibleCandleCount === count
                  ? 'bg-sky-500/20 border-sky-500/40 text-sky-300 font-semibold'
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {count} Bars ({Math.round((count * 15) / 60)}h)
            </button>
          ))}
        </div>
      </div>

      {/* Main Grid: Left 2/3 Interactive 15m Candlestick Chart, Right 1/3 Coinbase Prediction Module */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
        <div className="lg:col-span-2 bg-[#0D131F] border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
            <div className="text-slate-300">
              <span className="font-semibold text-slate-100">
                {selectedAsset}/USD · 15-Minute Candlesticks
              </span>{' '}
              · <span className="text-sky-400">EMA 9</span> ·{' '}
              <span className="text-amber-400">EMA 21</span> ·{' '}
              <span className="text-emerald-400">1σ Prediction Cone</span>
            </div>

            {hoveredCandle && (
              <div className="text-[11px] text-slate-300 tabular-nums">
                {new Date(hoveredCandle.time * 1000).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit'
                })}{' '}
                · O: {formatPrice(hoveredCandle.open)} · H: {formatPrice(hoveredCandle.high)} · L:{' '}
                {formatPrice(hoveredCandle.low)} · C: {formatPrice(hoveredCandle.close)} · Vol:{' '}
                {hoveredCandle.volume.toFixed(2)}
              </div>
            )}
          </div>

          <div className="w-full h-[460px] relative rounded-lg overflow-hidden border border-slate-800">
            <canvas
              ref={canvasRef}
              data-testid="prediction-15m-canvas"
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setHoveredCandle(null)}
              className="w-full h-full block cursor-crosshair"
            />
          </div>
        </div>

        {/* Right Column: Coinbase Prediction Module Telemetry */}
        <div className="bg-[#0D131F] border border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-4 font-mono tabular-nums">
          <div>
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-sm font-bold text-white">
                  Coinbase Prediction Module
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  L2 Order Flow + 15m Volatility Model
                </p>
              </div>
              {pred && (
                <span
                  className={`text-xs font-bold whitespace-nowrap shrink-0 ${
                    pred.bias === 'BULLISH'
                      ? 'text-emerald-400'
                      : pred.bias === 'BEARISH'
                      ? 'text-rose-400'
                      : 'text-slate-300'
                  }`}
                >
                  {pred.bias} · {pred.confidenceScore}% Conf
                </span>
              )}
            </div>

            {pred && (
              <div className="mt-4 space-y-4">
                {/* Directional Probability Bar */}
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-emerald-400 font-semibold">
                      Bullish {pred.bullishProbabilityPct}%
                    </span>
                    <span className="text-rose-400 font-semibold">
                      Bearish {pred.bearishProbabilityPct}%
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-rose-500/30 rounded-full overflow-hidden flex">
                    <div
                      style={{ width: `${pred.bullishProbabilityPct}%` }}
                      className="bg-emerald-500 h-full transition-opacity duration-200"
                    />
                  </div>
                </div>

                {/* 15m Projected Price Range & Indicators */}
                <div className="grid grid-cols-2 gap-3 text-xs py-2 border-y border-slate-800/80">
                  <div>
                    <div className="text-slate-400 text-[11px]">15m Upper Band (+1σ)</div>
                    <div className="text-emerald-400 font-semibold mt-0.5">
                      {formatPrice(pred.predictedRangeHigh)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-[11px]">15m Lower Band (-1σ)</div>
                    <div className="text-rose-400 font-semibold mt-0.5">
                      {formatPrice(pred.predictedRangeLow)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-[11px]">15m RSI (14) / ATR</div>
                    <div className="text-slate-100 font-semibold mt-0.5">
                      {pred.indicators.rsi14.toFixed(1)} / {formatPrice(pred.indicators.atr14)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400 text-[11px]">Session VWAP</div>
                    <div className="text-sky-400 font-semibold mt-0.5">
                      {formatPrice(pred.indicators.vwap)}
                    </div>
                  </div>
                </div>

                {/* Implied Binary Prediction Contracts */}
                <div>
                  <div className="text-xs font-semibold text-slate-200 mb-2">
                    Implied 15m Event Contract Probabilities
                  </div>
                  <div className="divide-y divide-slate-800/70">
                    {pred.binaryContracts.map((c) => (
                      <div key={c.contractId} className="py-2 text-xs">
                        <div className="text-slate-300 text-[11px] mb-1">
                          {c.question}
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-emerald-400 font-semibold">
                            YES {c.yesProbabilityPct}¢ ({c.yesProbabilityPct}%)
                          </span>
                          <span className="text-rose-400 font-semibold">
                            NO {c.noProbabilityPct}¢ ({c.noProbabilityPct}%)
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Quantitative Factor Attribution */}
                <div>
                  <div className="text-xs font-semibold text-slate-200 mb-2">
                    Live Signal Attribution
                  </div>
                  <div className="divide-y divide-slate-800/70 text-[11px]">
                    {pred.factors.map((f) => (
                      <div
                        key={f.name}
                        className="py-1.5 flex items-center justify-between gap-2"
                      >
                        <div>
                          <div className="text-slate-200">{f.name}</div>
                          <div className="text-[10px] text-slate-400">{f.detail}</div>
                        </div>
                        <span
                          className={`font-bold ${
                            f.score > 0
                              ? 'text-emerald-400'
                              : f.score < 0
                              ? 'text-rose-400'
                              : 'text-slate-400'
                          }`}
                        >
                          {f.score > 0 ? '+' : ''}
                          {f.score}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="text-[11px] text-slate-400 border-t border-slate-800 pt-2">
            Source: Coinbase Advanced Trade 15m OHLCV + Level 2 Order Book Stream.
          </div>
        </div>
      </div>
    </div>
  );
};
