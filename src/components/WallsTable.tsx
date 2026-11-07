import React from 'react';
import { LiquidityWall } from '../types/radar';

interface Props {
  walls: LiquidityWall[];
  sideFilter: 'ALL' | 'BUY' | 'SELL';
  maxDistancePct: number;
}

export const WallsTable: React.FC<Props> = ({ walls, sideFilter, maxDistancePct }) => {
  const filtered = walls.filter((w) => {
    const matchesSide = sideFilter === 'ALL' ? true : w.side === sideFilter;
    const matchesDist = Math.abs(w.distanceFromMidPct) <= maxDistancePct;
    return matchesSide && matchesDist;
  });

  const formatPrice = (val: number) => {
    if (val < 10) return `$${val.toFixed(4)}`;
    if (val < 1000) return `$${val.toFixed(2)}`;
    return `$${val.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  };

  return (
    <section className="bg-[#0D131F] border border-slate-800 rounded-xl p-4 overflow-x-auto">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">
            Detected Buy & Sell Liquidity Walls
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Live order concentrations verified against Coinbase Level 2 sequence numbers
          </p>
        </div>
        <span className="text-xs font-mono tabular-nums text-slate-400">
          {filtered.length} active walls within ±{maxDistancePct.toFixed(1)}%
        </span>
      </div>

      <table className="w-full text-left border-collapse text-xs font-mono tabular-nums">
        <thead>
          <tr className="border-b border-slate-800 text-slate-400">
            <th className="py-2.5 px-2 font-medium">Pair · Exchange</th>
            <th className="py-2.5 px-2 font-medium">Side</th>
            <th className="py-2.5 px-2 font-medium text-right">Price Level</th>
            <th className="py-2.5 px-2 font-medium text-right">Order Quantity</th>
            <th className="py-2.5 px-2 font-medium text-right">Total Value (USD)</th>
            <th className="py-2.5 px-2 font-medium text-right">Distance</th>
            <th className="py-2.5 px-2 font-medium text-right">Relative Size</th>
            <th className="py-2.5 px-2 font-medium">First Detected</th>
            <th className="py-2.5 px-2 font-medium">Last Observed</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60">
          {filtered.length === 0 ? (
            <tr>
              <td colSpan={9} className="py-8 text-center text-slate-400">
                No active order book walls match current filter criteria. Lower the minimum wall size or expand distance range.
              </td>
            </tr>
          ) : (
            filtered.map((wall) => (
              <tr
                key={wall.id}
                className="hover:bg-slate-900/60 transition-colors"
              >
                <td className="py-2.5 px-2">
                  <span className="font-semibold text-slate-100">{wall.symbol}</span>
                  <span className="text-slate-500"> · {wall.exchange}</span>
                </td>
                <td className="py-2.5 px-2">
                  <span
                    className={`font-semibold ${
                      wall.side === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {wall.side} WALL
                  </span>
                </td>
                <td className="py-2.5 px-2 text-right text-slate-100 font-semibold">
                  {formatPrice(wall.price)}
                </td>
                <td className="py-2.5 px-2 text-right text-slate-300">
                  {wall.quantity.toFixed(4)}
                </td>
                <td className="py-2.5 px-2 text-right font-semibold text-slate-100">
                  ${wall.usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </td>
                <td
                  className={`py-2.5 px-2 text-right ${
                    wall.distanceFromMidPct >= 0 ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {wall.distanceFromMidPct >= 0 ? '+' : ''}
                  {wall.distanceFromMidPct.toFixed(2)}%
                </td>
                <td className="py-2.5 px-2 text-right">
                  <span className="text-sky-400 font-semibold">
                    {wall.relativeSizeRatio.toFixed(1)}x
                  </span>{' '}
                  <span className="text-slate-400">· {wall.strength}</span>
                </td>
                <td className="py-2.5 px-2 text-slate-400">
                  {new Date(wall.firstDetectedAt).toLocaleTimeString()}
                </td>
                <td className="py-2.5 px-2 text-slate-400">
                  {new Date(wall.lastObservedAt).toLocaleTimeString()}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
};
