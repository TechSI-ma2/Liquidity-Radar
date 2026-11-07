import React from 'react';
import { PairTelemetry } from '../types/radar';

interface Props {
  telemetry: PairTelemetry | undefined;
}

export const OrderBookPanel: React.FC<Props> = ({ telemetry }) => {
  if (!telemetry || !telemetry.synchronized) {
    return (
      <div className="bg-[#0D131F] border border-slate-800 rounded-xl p-6 text-center text-slate-400 font-mono text-xs">
        Order Book Synchronizing — Waiting for Coinbase Level 2 Snapshot...
      </div>
    );
  }

  const maxBidUsd = Math.max(1, ...telemetry.topBids.map((b) => b.usdValue));
  const maxAskUsd = Math.max(1, ...telemetry.topAsks.map((a) => a.usdValue));

  const formatPrice = (val: number) => {
    if (val < 10) return `$${val.toFixed(4)}`;
    if (val < 1000) return `$${val.toFixed(2)}`;
    return `$${val.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  };

  return (
    <section className="bg-[#0D131F] border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">
            Synchronized Level 2 Order Book ({telemetry.symbol})
          </h2>
          <p className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
            Product: {telemetry.productId} · Sequence #{telemetry.sequenceNum} · Spread:{' '}
            {telemetry.spreadPct.toFixed(4)}% · Best Bid: {formatPrice(telemetry.bestBid)} · Best Ask:{' '}
            {formatPrice(telemetry.bestAsk)}
          </p>
        </div>
        <div className="text-xs font-mono text-emerald-400 font-semibold">
          Synchronized · {telemetry.exchange}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 font-mono tabular-nums text-xs">
        {/* Bids (Buy Side) */}
        <div>
          <div className="flex justify-between text-slate-400 pb-2 border-b border-slate-800 font-medium">
            <span>Bid Price (USD)</span>
            <span>Order Quantity</span>
            <span>Notional Depth (USD)</span>
          </div>
          <div className="divide-y divide-slate-800/50">
            {telemetry.topBids.slice(0, 22).map((b) => {
              const widthPct = Math.min(100, (b.usdValue / maxBidUsd) * 100);
              return (
                <div key={b.price} className="relative flex justify-between py-1.5 px-2">
                  <div
                    style={{ width: `${widthPct}%` }}
                    className="absolute inset-y-0 right-0 bg-emerald-500/15 pointer-events-none"
                  />
                  <span className="text-emerald-400 font-semibold relative z-10">
                    {formatPrice(b.price)}
                  </span>
                  <span className="text-slate-300 relative z-10">
                    {b.quantity.toFixed(4)}
                  </span>
                  <span className="text-slate-100 relative z-10">
                    ${b.usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Asks (Sell Side) */}
        <div>
          <div className="flex justify-between text-slate-400 pb-2 border-b border-slate-800 font-medium">
            <span>Ask Price (USD)</span>
            <span>Order Quantity</span>
            <span>Notional Depth (USD)</span>
          </div>
          <div className="divide-y divide-slate-800/50">
            {telemetry.topAsks.slice(0, 22).map((a) => {
              const widthPct = Math.min(100, (a.usdValue / maxAskUsd) * 100);
              return (
                <div key={a.price} className="relative flex justify-between py-1.5 px-2">
                  <div
                    style={{ width: `${widthPct}%` }}
                    className="absolute inset-y-0 left-0 bg-rose-500/15 pointer-events-none"
                  />
                  <span className="text-rose-400 font-semibold relative z-10">
                    {formatPrice(a.price)}
                  </span>
                  <span className="text-slate-300 relative z-10">
                    {a.quantity.toFixed(4)}
                  </span>
                  <span className="text-slate-100 relative z-10">
                    ${a.usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};
