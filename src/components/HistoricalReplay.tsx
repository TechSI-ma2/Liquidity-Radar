import React, { useEffect, useState, useCallback } from 'react';
import { HistoricalSnapshotRecord } from '../types/radar';

export const HistoricalReplay: React.FC<{ symbol: string }> = ({ symbol }) => {
  const [snapshots, setSnapshots] = useState<HistoricalSnapshotRecord[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/history?symbol=${encodeURIComponent(symbol)}&limit=180`
      );
      if (res.ok) {
        const data = await res.json();
        const list: HistoricalSnapshotRecord[] = data.snapshots || [];
        setSnapshots(list);
        if (list.length > 0) {
          setSelectedIndex(list.length - 1);
        }
      }
    } catch (err) {
      console.error('Error fetching historical snapshots:', err);
    }
  }, [symbol]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    if (!isPlaying || snapshots.length === 0) return;
    const timer = setInterval(() => {
      setSelectedIndex((prev) => {
        if (prev >= snapshots.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 400);
    return () => clearInterval(timer);
  }, [isPlaying, snapshots.length]);

  const current = snapshots[selectedIndex];
  const baseline = snapshots[0];

  const formatPrice = (val: number) => {
    if (val < 10) return `$${val.toFixed(4)}`;
    if (val < 1000) return `$${val.toFixed(2)}`;
    return `$${val.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  };

  return (
    <section className="bg-[#0D131F] border border-slate-800 rounded-xl p-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">
            Historical Liquidity Time-Series Replay ({symbol})
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Scrub archived order book snapshots to inspect historical liquidity shifts and wall movements
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchHistory}
            className="px-3 py-1.5 rounded bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs font-mono text-slate-200 whitespace-nowrap shrink-0"
          >
            Refresh Archive
          </button>
          <button
            type="button"
            onClick={() => {
              if (selectedIndex >= snapshots.length - 1) setSelectedIndex(0);
              setIsPlaying((p) => !p);
            }}
            className="px-3 py-1.5 rounded bg-sky-500/20 border border-sky-500/40 text-xs font-mono text-sky-300 font-semibold whitespace-nowrap shrink-0"
          >
            {isPlaying ? 'Pause Replay' : 'Play Liquidity Replay'}
          </button>
        </div>
      </div>

      {snapshots.length === 0 ? (
        <div className="py-10 text-center text-slate-400 font-mono text-xs">
          Archiving initial live snapshots... Click Refresh Archive in a moment.
        </div>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <label htmlFor="historical-scrubber" className="sr-only">
              Historical Snapshot Timeline Scrubber
            </label>
            <input
              id="historical-scrubber"
              type="range"
              min={0}
              max={Math.max(0, snapshots.length - 1)}
              value={selectedIndex}
              onChange={(e) => setSelectedIndex(parseInt(e.target.value, 10))}
              className="w-full accent-sky-400 cursor-pointer"
            />
            <span className="text-xs font-mono tabular-nums text-slate-300 whitespace-nowrap">
              Frame {selectedIndex + 1} / {snapshots.length}
            </span>
          </div>

          {current && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 pt-3 border-t border-slate-800 text-xs font-mono tabular-nums">
              <div>
                <div className="text-slate-400">Snapshot Timestamp</div>
                <div className="text-slate-100 font-semibold mt-1">
                  {new Date(current.ts).toLocaleTimeString()}
                </div>
              </div>
              <div>
                <div className="text-slate-400">Mid Price</div>
                <div className="text-sky-400 font-semibold mt-1">
                  {formatPrice(current.midPrice)}
                </div>
              </div>
              <div>
                <div className="text-slate-400">Historical Bid Depth</div>
                <div className="text-emerald-400 font-semibold mt-1">
                  ${current.totalBidUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
              </div>
              <div>
                <div className="text-slate-400">Historical Ask Depth</div>
                <div className="text-rose-400 font-semibold mt-1">
                  ${current.totalAskUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
              </div>
              <div>
                <div className="text-slate-400">Net Imbalance / Delta</div>
                <div
                  className={`font-semibold mt-1 ${
                    current.imbalancePct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {current.imbalancePct >= 0 ? '+' : ''}
                  {current.imbalancePct.toFixed(1)}%
                  {baseline && (
                    <span className="text-slate-400 font-normal">
                      {' '}
                      (vs {baseline.imbalancePct.toFixed(1)}%)
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {current && current.buckets.length > 0 && (
            <div className="pt-3 border-t border-slate-800">
              <h3 className="text-xs font-semibold text-slate-300 mb-2">
                Snapshot Top Liquidity Buckets at {new Date(current.ts).toLocaleTimeString()}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs font-mono tabular-nums">
                {[...current.buckets]
                  .sort((a, b) => Math.max(b.bidUsd, b.askUsd) - Math.max(a.bidUsd, a.askUsd))
                  .slice(0, 6)
                  .map((b) => (
                    <div
                      key={b.price}
                      className="flex items-center justify-between py-1.5 px-2.5 bg-slate-900/70 rounded border border-slate-800/80"
                    >
                      <span className="text-slate-200 font-semibold">
                        {formatPrice(b.price)}
                      </span>
                      <span
                        className={
                          b.dominantSide === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                        }
                      >
                        {b.dominantSide}: $
                        {Math.max(b.bidUsd, b.askUsd).toLocaleString(undefined, {
                          maximumFractionDigits: 0
                        })}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
};
