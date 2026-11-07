import React, { useEffect, useRef, useState } from 'react';
import { HeatmapBucket, HeatmapSlice } from '../types/radar';

interface Props {
  symbol: string;
  slices: HeatmapSlice[];
  livePrice: number;
  synchronized: boolean;
}

interface HoverCell {
  x: number;
  y: number;
  timestamp: number;
  bucket: HeatmapBucket;
}

export const LiquidityHeatmap: React.FC<Props> = ({
  symbol,
  slices,
  livePrice,
  synchronized
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [timeWindowColumns, setTimeWindowColumns] = useState<number>(120);
  const [priceZoomFactor, setPriceZoomFactor] = useState<number>(1);
  const [hoverCell, setHoverCell] = useState<HoverCell | null>(null);

  const visibleSlices = slices.slice(-timeWindowColumns);

  const formatPrice = (val: number) => {
    if (val < 10) return `$${val.toFixed(4)}`;
    if (val < 1000) return `$${val.toFixed(2)}`;
    return `$${val.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
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
    const rightAxisWidth = 88;
    const bottomAxisHeight = 26;
    const plotWidth = width - rightAxisWidth;
    const plotHeight = height - bottomAxisHeight;

    ctx.fillStyle = '#070B12';
    ctx.fillRect(0, 0, width, height);

    if (!synchronized || visibleSlices.length === 0) {
      ctx.fillStyle = '#64748B';
      ctx.font = '12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        synchronized
          ? `Accumulating real-time Coinbase Level 2 order book depth for ${symbol}...`
          : `Synchronizing order book feed from Coinbase Advanced Trade...`,
        plotWidth / 2,
        plotHeight / 2
      );
      return;
    }

    const latestSlice = visibleSlices[visibleSlices.length - 1];
    const allBuckets = latestSlice.buckets;
    if (allBuckets.length === 0) return;

    const totalRows = Math.max(
      12,
      Math.floor(allBuckets.length / priceZoomFactor)
    );
    const centerIdx = Math.floor(allBuckets.length / 2);
    const halfRows = Math.floor(totalRows / 2);
    const startIdx = Math.max(0, centerIdx - halfRows);
    const displayedBuckets = allBuckets.slice(startIdx, startIdx + totalRows);

    const maxPrice = displayedBuckets[0].price;
    const minPrice = displayedBuckets[displayedBuckets.length - 1].price;
    const priceSpan = Math.max(0.0001, maxPrice - minPrice);

    const colWidth = plotWidth / Math.max(1, visibleSlices.length);
    const rowHeight = plotHeight / displayedBuckets.length;

    visibleSlices.forEach((slice, colIdx) => {
      const x = colIdx * colWidth;
      const sliceBucketMap = new Map<number, HeatmapBucket>();
      for (const b of slice.buckets) sliceBucketMap.set(b.price, b);

      displayedBuckets.forEach((refBucket, rowIdx) => {
        const y = rowIdx * rowHeight;
        const cell = sliceBucketMap.get(refBucket.price);
        if (!cell || cell.intensity <= 0.02) return;

        const alpha = Math.min(0.95, 0.14 + cell.intensity * 0.84);
        if (cell.dominantSide === 'BUY') {
          ctx.fillStyle = cell.isWhaleWall
            ? `rgba(52, 211, 153, ${Math.min(1, alpha + 0.2)})`
            : `rgba(16, 185, 129, ${alpha})`;
        } else if (cell.dominantSide === 'SELL') {
          ctx.fillStyle = cell.isWhaleWall
            ? `rgba(251, 113, 133, ${Math.min(1, alpha + 0.2)})`
            : `rgba(244, 63, 94, ${alpha})`;
        } else {
          ctx.fillStyle = `rgba(148, 163, 184, ${alpha * 0.4})`;
        }

        ctx.fillRect(x, y, Math.ceil(colWidth), Math.ceil(rowHeight));

        if (cell.isWhaleWall && cell.intensity > 0.72) {
          ctx.strokeStyle =
            cell.dominantSide === 'BUY' ? '#A7F3D0' : '#FECDD3';
          ctx.lineWidth = 0.8;
          ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, colWidth - 1), Math.max(1, rowHeight - 1));
        }
      });
    });

    // Mid-Price Trajectory Line
    ctx.beginPath();
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 2;
    visibleSlices.forEach((slice, colIdx) => {
      const x = colIdx * colWidth + colWidth / 2;
      const yRatio = (maxPrice - slice.midPrice) / priceSpan;
      const y = Math.max(0, Math.min(plotHeight, yRatio * plotHeight));
      if (colIdx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Right Price Axis
    ctx.fillStyle = '#0D131F';
    ctx.fillRect(plotWidth, 0, rightAxisWidth, height);
    ctx.strokeStyle = '#1E293B';
    ctx.beginPath();
    ctx.moveTo(plotWidth, 0);
    ctx.lineTo(plotWidth, plotHeight);
    ctx.stroke();

    ctx.fillStyle = '#94A3B8';
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    const step = Math.max(1, Math.floor(displayedBuckets.length / 9));
    for (let i = 0; i < displayedBuckets.length; i += step) {
      const b = displayedBuckets[i];
      const y = i * rowHeight + rowHeight / 2 + 4;
      ctx.fillText(formatPrice(b.price), plotWidth + 6, y);
    }

    // Current Live Price Indicator on Right Axis
    const liveYRatio = (maxPrice - livePrice) / priceSpan;
    const liveY = Math.max(12, Math.min(plotHeight - 12, liveYRatio * plotHeight));
    ctx.fillStyle = '#0284C7';
    ctx.fillRect(plotWidth + 2, liveY - 10, rightAxisWidth - 4, 20);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.fillText(formatPrice(livePrice), plotWidth + 6, liveY + 4);

    // Bottom Time Axis
    ctx.fillStyle = '#0D131F';
    ctx.fillRect(0, plotHeight, plotWidth, bottomAxisHeight);
    ctx.fillStyle = '#64748B';
    ctx.font = '10px "JetBrains Mono", monospace';
    const timeStep = Math.max(1, Math.floor(visibleSlices.length / 5));
    for (let i = 0; i < visibleSlices.length; i += timeStep) {
      const x = i * colWidth;
      const tStr = new Date(visibleSlices[i].timestamp).toLocaleTimeString();
      ctx.fillText(tStr, x + 4, plotHeight + 17);
    }
  }, [visibleSlices, priceZoomFactor, livePrice, symbol, synchronized]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || visibleSlices.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const plotWidth = rect.width - 88;
    const plotHeight = rect.height - 26;
    if (x < 0 || x > plotWidth || y < 0 || y > plotHeight) {
      setHoverCell(null);
      return;
    }

    const colIdx = Math.min(
      visibleSlices.length - 1,
      Math.max(0, Math.floor((x / plotWidth) * visibleSlices.length))
    );
    const slice = visibleSlices[colIdx];
    const totalRows = Math.max(
      12,
      Math.floor(slice.buckets.length / priceZoomFactor)
    );
    const centerIdx = Math.floor(slice.buckets.length / 2);
    const startIdx = Math.max(0, centerIdx - Math.floor(totalRows / 2));
    const displayedBuckets = slice.buckets.slice(startIdx, startIdx + totalRows);

    const rowIdx = Math.min(
      displayedBuckets.length - 1,
      Math.max(0, Math.floor((y / plotHeight) * displayedBuckets.length))
    );
    const bucket = displayedBuckets[rowIdx];

    if (bucket) {
      setHoverCell({
        x,
        y,
        timestamp: slice.timestamp,
        bucket
      });
    }
  };

  return (
    <section className="bg-[#0D131F] border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">
            Order Book Liquidity Heatmap ({symbol})
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Green Buy Depth · Red Sell Depth · Brightness = Relative USD Concentration · Cyan Line = Live Mid-Price
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-slate-400">Range:</span>
          {[60, 120, 240].map((cols) => (
            <button
              key={cols}
              type="button"
              onClick={() => setTimeWindowColumns(cols)}
              className={`px-2.5 py-1 rounded font-mono transition whitespace-nowrap shrink-0 ${
                timeWindowColumns === cols
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 font-semibold'
                  : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
              }`}
            >
              {cols}s
            </button>
          ))}

          <span className="text-slate-400 ml-1">Zoom:</span>
          <button
            type="button"
            aria-label="Zoom in heatmap price axis"
            onClick={() => setPriceZoomFactor((z) => Math.min(3, +(z + 0.5).toFixed(1)))}
            className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 font-mono whitespace-nowrap shrink-0"
          >
            + In
          </button>
          <button
            type="button"
            aria-label="Zoom out heatmap price axis"
            onClick={() => setPriceZoomFactor((z) => Math.max(1, +(z - 0.5).toFixed(1)))}
            className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 font-mono whitespace-nowrap shrink-0"
          >
            - Out
          </button>
        </div>
      </div>

      <div className="relative w-full h-[380px] rounded-lg overflow-hidden border border-slate-800">
        <canvas
          ref={canvasRef}
          data-testid="liquidity-heatmap-canvas"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverCell(null)}
          onWheel={(e) => {
            e.preventDefault();
            if (e.deltaY < 0) {
              setPriceZoomFactor((z) => Math.min(3, +(z + 0.25).toFixed(2)));
            } else {
              setPriceZoomFactor((z) => Math.max(1, +(z - 0.25).toFixed(2)));
            }
          }}
          className="w-full h-full cursor-crosshair block"
        />

        {hoverCell && (
          <div
            style={{
              left: Math.min(hoverCell.x + 14, 420),
              top: Math.max(12, hoverCell.y - 76)
            }}
            className="pointer-events-none absolute z-20 bg-slate-950/95 border border-slate-700 rounded-lg p-2.5 text-xs font-mono tabular-nums shadow-xl"
          >
            <div className="text-slate-200 font-semibold mb-1">
              Price Bucket: {formatPrice(hoverCell.bucket.price)}
            </div>
            <div className="text-emerald-400">
              Bid Depth: $
              {hoverCell.bucket.bidUsd.toLocaleString(undefined, {
                maximumFractionDigits: 0
              })}{' '}
              ({hoverCell.bucket.bidQty.toFixed(3)})
            </div>
            <div className="text-rose-400">
              Ask Depth: $
              {hoverCell.bucket.askUsd.toLocaleString(undefined, {
                maximumFractionDigits: 0
              })}{' '}
              ({hoverCell.bucket.askQty.toFixed(3)})
            </div>
            <div className="text-slate-400 mt-1 text-[11px]">
              {new Date(hoverCell.timestamp).toLocaleTimeString()} · Intensity:{' '}
              {(hoverCell.bucket.intensity * 100).toFixed(0)}%
              {hoverCell.bucket.isWhaleWall ? ' · Whale Order Concentration' : ''}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
