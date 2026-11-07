import React, { useEffect, useRef } from 'react';
import { LiquidityCluster, LiquidityWall, PairTelemetry } from '../types/radar';

interface Props {
  telemetry: PairTelemetry | undefined;
  maxDistancePct: number;
}

export const LiquidityRadarCanvas: React.FC<Props> = ({
  telemetry,
  maxDistancePct
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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
    const cx = width / 2;
    const cy = height / 2;
    const maxRadius = Math.min(cx, cy) - 24;

    ctx.fillStyle = '#070B12';
    ctx.fillRect(0, 0, width, height);

    const rings = [0.25, 0.5, 0.75, 1.0];
    rings.forEach((rRatio) => {
      const r = maxRadius * rRatio;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = '#1E293B';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = '#64748B';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(
        `±${(maxDistancePct * rRatio).toFixed(1)}%`,
        cx + 6,
        cy - r + 12
      );
    });

    ctx.strokeStyle = '#1E293B';
    ctx.beginPath();
    ctx.moveTo(cx - maxRadius, cy);
    ctx.lineTo(cx + maxRadius, cy);
    ctx.moveTo(cx, cy - maxRadius);
    ctx.lineTo(cx, cy + maxRadius);
    ctx.stroke();

    if (!telemetry || !telemetry.synchronized) {
      ctx.fillStyle = '#64748B';
      ctx.font = '12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Awaiting synchronized Coinbase radar feed...', cx, cy + 44);
      return;
    }

    // Plot Liquidity Clusters as concentric support/resistance radar arcs
    telemetry.clusters.forEach((cluster: LiquidityCluster, idx: number) => {
      const absDist = Math.abs(cluster.distanceFromMidPct);
      if (absDist > maxDistancePct) return;

      const radius = Math.max(32, (absDist / maxDistancePct) * maxRadius);
      const arcSpan = Math.min(Math.PI * 0.45, 0.25 + (cluster.strengthScore / 100) * 0.55);
      const baseAngle =
        cluster.side === 'SELL'
          ? -Math.PI / 2 + ((idx % 3) - 1) * 0.35
          : Math.PI / 2 + ((idx % 3) - 1) * 0.35;

      ctx.beginPath();
      ctx.arc(cx, cy, radius, baseAngle - arcSpan / 2, baseAngle + arcSpan / 2);
      ctx.strokeStyle =
        cluster.side === 'BUY'
          ? 'rgba(16, 185, 129, 0.34)'
          : 'rgba(244, 63, 94, 0.34)';
      ctx.lineWidth = 9;
      ctx.stroke();
    });

    const maxWallUsd = Math.max(
      50000,
      ...telemetry.walls.map((w) => w.usdValue)
    );

    const sellWalls = telemetry.walls.filter((w) => w.side === 'SELL').slice(0, 8);
    const buyWalls = telemetry.walls.filter((w) => w.side === 'BUY').slice(0, 8);
    const placedLabelBoxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

    const renderHemisphereWalls = (list: LiquidityWall[], isSell: boolean) => {
      list.forEach((wall, idx) => {
        const absDist = Math.abs(wall.distanceFromMidPct);
        if (absDist > maxDistancePct) return;

        const r = Math.max(38, (absDist / maxDistancePct) * maxRadius);
        const count = Math.max(1, list.length);
        const fraction = count === 1 ? 0.5 : idx / (count - 1);
        const spreadAngle = (fraction - 0.5) * Math.PI * 0.72;
        const angle = (isSell ? -Math.PI / 2 : Math.PI / 2) + spreadAngle;

        const bx = cx + Math.cos(angle) * r;
        const by = cy + Math.sin(angle) * r;
        const blipRadius = Math.max(
          5,
          Math.min(14, 5 + (wall.usdValue / maxWallUsd) * 10)
        );

        ctx.beginPath();
        ctx.arc(bx, by, blipRadius + 4, 0, Math.PI * 2);
        ctx.fillStyle = isSell
          ? 'rgba(244, 63, 94, 0.22)'
          : 'rgba(16, 185, 129, 0.22)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(bx, by, blipRadius, 0, Math.PI * 2);
        ctx.fillStyle = isSell ? '#F43F5E' : '#10B981';
        ctx.fill();

        if (idx < 3) {
          const text = `${formatPrice(wall.price)} ($${(wall.usdValue / 1000).toFixed(0)}K)`;
          const textWidth = text.length * 5.8;
          const lx = Math.max(textWidth / 2 + 6, Math.min(width - textWidth / 2 - 6, bx));
          const ly = isSell ? by - blipRadius - 7 : by + blipRadius + 13;
          const box = {
            x1: lx - textWidth / 2 - 2,
            y1: ly - 10,
            x2: lx + textWidth / 2 + 2,
            y2: ly + 3
          };

          const overlaps = placedLabelBoxes.some(
            (b) => !(box.x2 < b.x1 || box.x1 > b.x2 || box.y2 < b.y1 || box.y1 > b.y2)
          );

          if (!overlaps && ly > 14 && ly < height - 8) {
            placedLabelBoxes.push(box);
            ctx.fillStyle = '#070B12';
            ctx.fillRect(box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1);
            ctx.fillStyle = '#E2E8F0';
            ctx.font = '10px "JetBrains Mono", monospace';
            ctx.textAlign = 'center';
            ctx.fillText(text, lx, ly);
          }
        }
      });
    };

    renderHemisphereWalls(sellWalls, true);
    renderHemisphereWalls(buyWalls, false);

    // Center Hub: Live Market Price
    ctx.beginPath();
    ctx.arc(cx, cy, 30, 0, Math.PI * 2);
    ctx.fillStyle = '#0F172A';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#38BDF8';
    ctx.stroke();

    ctx.fillStyle = '#F8FAFC';
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(telemetry.symbol, cx, cy - 4);
    ctx.fillStyle = '#38BDF8';
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.fillText(formatPrice(telemetry.livePrice), cx, cy + 10);
  }, [telemetry, maxDistancePct]);

  return (
    <section className="bg-[#0D131F] border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">
            Liquidity Radar ({telemetry?.symbol || 'BTC/USDT'})
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Upper Hemisphere: Sell Resistance · Lower Hemisphere: Buy Support
          </p>
        </div>
        <div className="text-xs font-mono text-slate-400">
          <span className="text-emerald-400">Buy Zones</span> ·{' '}
          <span className="text-rose-400">Sell Zones</span>
        </div>
      </div>

      <div className="w-full h-[380px] relative rounded-lg overflow-hidden border border-slate-800">
        <canvas
          ref={canvasRef}
          data-testid="liquidity-radar-canvas"
          className="w-full h-full block"
        />
      </div>

      {telemetry && (
        <div className="grid grid-cols-2 gap-3 text-xs font-mono tabular-nums pt-1 border-t border-slate-800/80">
          <div>
            <span className="text-slate-400">Strongest Support Above/Below:</span>
            <div className="text-emerald-400 font-semibold mt-0.5">
              {telemetry.strongestBuyWall
                ? `${formatPrice(telemetry.strongestBuyWall.price)} ($${(
                    telemetry.strongestBuyWall.usdValue / 1000
                  ).toFixed(1)}K)`
                : 'Scanning...'}
            </div>
          </div>
          <div>
            <span className="text-slate-400">Strongest Resistance Level:</span>
            <div className="text-rose-400 font-semibold mt-0.5">
              {telemetry.strongestSellWall
                ? `${formatPrice(telemetry.strongestSellWall.price)} ($${(
                    telemetry.strongestSellWall.usdValue / 1000
                  ).toFixed(1)}K)`
                : 'Scanning...'}
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
