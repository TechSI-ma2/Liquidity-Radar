import React, { useState } from 'react';
import { useLiquidityStream } from './hooks/useLiquidityStream';
import { LiquidityHeatmap } from './components/LiquidityHeatmap';
import { LiquidityRadarCanvas } from './components/LiquidityRadarCanvas';
import { WallsTable } from './components/WallsTable';
import { OrderBookPanel } from './components/OrderBookPanel';
import { HistoricalReplay } from './components/HistoricalReplay';
import { Crypto15mPredictionChart } from './components/Crypto15mPredictionChart';

type NavTab =
  | 'Overview'
  | '15m Chart'
  | 'Liquidity Radar'
  | 'Heatmap'
  | 'Liquidity Walls'
  | 'Order Book'
  | 'Historical Analysis'
  | 'Alerts'
  | 'Settings';

const NAV_TABS: NavTab[] = [
  'Overview',
  '15m Chart',
  'Liquidity Radar',
  'Heatmap',
  'Liquidity Walls',
  'Order Book',
  'Historical Analysis',
  'Alerts',
  'Settings'
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('Overview');
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTC/USDT');
  const [minWallUsd, setMinWallUsd] = useState<number>(50000);
  const [customWallInput, setCustomWallInput] = useState<string>('50000');
  const [maxDistancePct, setMaxDistancePct] = useState<number>(3.5);
  const [sideFilter, setSideFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const [browserPushEnabled, setBrowserPushEnabled] = useState<boolean>(false);
  const [settingsSavedNotice, setSettingsSavedNotice] = useState<string>('');

  const { payload, wsConnected, heatmapHistory, updateWallThreshold } =
    useLiquidityStream(browserPushEnabled);

  const activeTelemetry = payload?.pairs?.[selectedSymbol];
  const overviewSymbols = ['BTC/USDT', 'ETH/USDT', 'XRP/USDT', 'SOL/USDT'];

  const handleThresholdSelect = (val: number) => {
    setMinWallUsd(val);
    setCustomWallInput(String(val));
    updateWallThreshold(val);
  };

  const enableBrowserNotifications = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        setBrowserPushEnabled(true);
      }
    }
  };

  const formatPrice = (val: number | undefined) => {
    if (!val || val <= 0) return '---';
    if (val < 10) return `$${val.toFixed(4)}`;
    if (val < 1000) return `$${val.toFixed(2)}`;
    return `$${val.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="min-h-screen bg-[#070B12] text-slate-100 flex flex-col md:flex-row">
      {/* Sidebar Navigation */}
      <aside className="w-full md:w-64 bg-[#0D131F] border-b md:border-b-0 md:border-r border-slate-800 flex flex-col justify-between p-4 shrink-0">
        <div>
          <div className="px-2 pb-5 border-b border-slate-800">
            <h1 className="text-base font-bold tracking-tight text-white whitespace-nowrap">
              Liquidity Radar
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Created By Tech.SI ma2 - Arsalan Nasir
            </p>
          </div>

          <nav aria-label="Main Terminal Navigation" className="mt-4 space-y-1">
            {NAV_TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-xs font-medium transition flex items-center justify-between whitespace-nowrap shrink-0 ${
                  activeTab === tab
                    ? 'bg-sky-500/15 text-sky-300 border border-sky-500/30 font-semibold'
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200 border border-transparent'
                }`}
              >
                <span>{tab}</span>
                {tab === '15m Chart' && (
                  <span className="text-[11px] font-mono text-emerald-400">
                    Coinbase 15m
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Exchange Feed Integrity Telemetry */}
        <div className="mt-6 pt-4 border-t border-slate-800 text-xs font-mono tabular-nums space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Exchange:</span>
            <span className="text-slate-200">Coinbase Adv</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Feed Status:</span>
            <span
              className={`font-semibold ${
                wsConnected && payload?.exchangeStatus.status === 'CONNECTED'
                  ? 'text-emerald-400'
                  : 'text-amber-400'
              }`}
            >
              {wsConnected
                ? payload?.exchangeStatus.status || 'CONNECTED'
                : 'RECONNECTING'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Book Sync:</span>
            <span
              className={
                activeTelemetry?.synchronized ? 'text-emerald-400' : 'text-amber-400'
              }
            >
              {activeTelemetry?.synchronized ? 'SYNCHRONIZED' : 'SYNCING'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Latency:</span>
            <span className="text-sky-400">
              {payload?.exchangeStatus.latencyMs ?? 18} ms
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Updated:</span>
            <span className="text-slate-300">
              {activeTelemetry?.lastUpdateTimestamp
                ? new Date(activeTelemetry.lastUpdateTimestamp).toLocaleTimeString()
                : '--:--:--'}
            </span>
          </div>
        </div>
      </aside>

      {/* Main Content Viewport */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: Context Breadcrumb on Left, Primary Controls on Right */}
        <header className="flex items-center justify-between gap-8 px-6 py-3.5 bg-[#0D131F] border-b border-slate-800">
          <div className="text-sm font-semibold text-slate-100 whitespace-nowrap shrink-0">
            {activeTab} · {selectedSymbol}
          </div>

          <div className="hidden lg:flex items-center gap-6 text-xs font-mono tabular-nums text-slate-300">
            <span>
              Live Price:{' '}
              <strong className="text-white">
                {formatPrice(activeTelemetry?.livePrice)}
              </strong>
            </span>
            <span>
              Buy Depth:{' '}
              <strong className="text-emerald-400">
                ${((activeTelemetry?.totalBuyLiquidityUsd || 0) / 1000).toFixed(0)}K
              </strong>
            </span>
            <span>
              Sell Depth:{' '}
              <strong className="text-rose-400">
                ${((activeTelemetry?.totalSellLiquidityUsd || 0) / 1000).toFixed(0)}K
              </strong>
            </span>
            <span>
              Imbalance:{' '}
              <strong
                className={
                  (activeTelemetry?.imbalancePct || 0) >= 0
                    ? 'text-emerald-400'
                    : 'text-rose-400'
                }
              >
                {(activeTelemetry?.imbalancePct || 0) >= 0 ? '+' : ''}
                {(activeTelemetry?.imbalancePct || 0).toFixed(1)}%
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('15m Chart')}
              className="px-3.5 py-1.5 text-xs font-medium text-slate-950 bg-sky-400 hover:bg-sky-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              15m Prediction Chart
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6 space-y-5 overflow-y-auto">
          {/* Workspace Filter & Pair Toolbar */}
          <div className="bg-[#0D131F] border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-mono text-slate-400 mr-1">Pair:</span>
              {[
                'BTC/USDT',
                'ETH/USDT',
                'XRP/USDT',
                'SOL/USDT',
                'BTC/USD',
                'ETH/USD',
                'XRP/USD',
                'SOL/USD'
              ].map((sym) => (
                <button
                  key={sym}
                  type="button"
                  onClick={() => setSelectedSymbol(sym)}
                  className={`px-2.5 py-1 rounded text-xs font-mono transition whitespace-nowrap shrink-0 ${
                    selectedSymbol === sym
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 font-semibold'
                      : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {sym}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
              <span className="text-slate-400">Min Wall:</span>
              {[25000, 50000, 100000, 500000, 1000000].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => handleThresholdSelect(val)}
                  className={`px-2 py-1 rounded border transition whitespace-nowrap shrink-0 ${
                    minWallUsd === val
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 font-semibold'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ${val >= 1000000 ? `${val / 1000000}M` : `${val / 1000}K`}
                </button>
              ))}

              <label htmlFor="wall-side-filter" className="sr-only">
                Filter Walls by Side
              </label>
              <select
                id="wall-side-filter"
                aria-label="Filter Walls by Side"
                value={sideFilter}
                onChange={(e) => setSideFilter(e.target.value as 'ALL' | 'BUY' | 'SELL')}
                className="bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-200 cursor-pointer"
              >
                <option value="ALL">All Walls</option>
                <option value="BUY">Buy Walls Only</option>
                <option value="SELL">Sell Walls Only</option>
              </select>
            </div>
          </div>

          {/* TAB 1: OVERVIEW */}
          {activeTab === 'Overview' && (
            <div className="space-y-5">
              {/* Multi-Asset Liquidity Overview Cards (BTC/USDT, ETH/USDT, XRP/USDT, SOL/USDT) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {overviewSymbols.map((sym) => {
                  const t = payload?.pairs?.[sym];
                  const isSelected = selectedSymbol === sym;
                  return (
                    <button
                      key={sym}
                      type="button"
                      onClick={() => setSelectedSymbol(sym)}
                      className={`text-left bg-[#0D131F] border rounded-xl p-4 transition ${
                        isSelected
                          ? 'border-sky-500/60'
                          : 'border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-bold text-sm text-white">{sym}</span>
                        <span
                          className={`text-xs font-mono tabular-nums font-semibold ${
                            (t?.priceChange24hPct || 0) >= 0
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {(t?.priceChange24hPct || 0) >= 0 ? '+' : ''}
                          {(t?.priceChange24hPct || 0).toFixed(2)}% (24h)
                        </span>
                      </div>
                      <div className="text-xl font-bold font-mono tabular-nums text-slate-100 mb-3">
                        {formatPrice(t?.livePrice)}
                      </div>
                      <div className="space-y-1 text-xs font-mono tabular-nums border-t border-slate-800/80 pt-2.5">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Buy Liquidity:</span>
                          <span className="text-emerald-400 font-semibold">
                            ${((t?.totalBuyLiquidityUsd || 0) / 1000).toFixed(1)}K
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Sell Liquidity:</span>
                          <span className="text-rose-400 font-semibold">
                            ${((t?.totalSellLiquidityUsd || 0) / 1000).toFixed(1)}K
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Imbalance:</span>
                          <span
                            className={`font-semibold ${
                              (t?.imbalancePct || 0) >= 0
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {(t?.imbalancePct || 0) >= 0 ? '+' : ''}
                            {(t?.imbalancePct || 0).toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Active Pair Key Institutional Metrics Strip */}
              {activeTelemetry && (
                <div className="bg-[#0D131F] border border-slate-800 rounded-xl p-4 grid grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono tabular-nums">
                  <div>
                    <div className="text-slate-400">Strongest Buy Wall</div>
                    <div className="text-emerald-400 font-semibold text-sm mt-1">
                      {activeTelemetry.strongestBuyWall
                        ? `${formatPrice(activeTelemetry.strongestBuyWall.price)} · $${(
                            activeTelemetry.strongestBuyWall.usdValue / 1000
                          ).toFixed(1)}K`
                        : 'Scanning depth...'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Strongest Sell Wall</div>
                    <div className="text-rose-400 font-semibold text-sm mt-1">
                      {activeTelemetry.strongestSellWall
                        ? `${formatPrice(activeTelemetry.strongestSellWall.price)} · $${(
                            activeTelemetry.strongestSellWall.usdValue / 1000
                          ).toFixed(1)}K`
                        : 'Scanning depth...'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Largest Liquidity Cluster</div>
                    <div className="text-sky-400 font-semibold text-sm mt-1">
                      {activeTelemetry.largestCluster
                        ? `${formatPrice(activeTelemetry.largestCluster.centroidPrice)} (${
                            activeTelemetry.largestCluster.side
                          } · $${(activeTelemetry.largestCluster.totalUsdValue / 1000).toFixed(0)}K)`
                        : 'Calculating clusters...'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Last Exchange Sequence</div>
                    <div className="text-slate-200 font-semibold text-sm mt-1">
                      #{activeTelemetry.sequenceNum} ·{' '}
                      {new Date(activeTelemetry.lastUpdateTimestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              )}

              {/* Active Pair Heatmap & Concentric Radar */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-stretch">
                <div className="xl:col-span-2">
                  <LiquidityHeatmap
                    symbol={selectedSymbol}
                    slices={heatmapHistory[selectedSymbol] || []}
                    livePrice={activeTelemetry?.livePrice || 0}
                    synchronized={Boolean(activeTelemetry?.synchronized)}
                  />
                </div>
                <div>
                  <LiquidityRadarCanvas
                    telemetry={activeTelemetry}
                    maxDistancePct={maxDistancePct}
                  />
                </div>
              </div>

              <WallsTable
                walls={activeTelemetry?.walls || []}
                sideFilter={sideFilter}
                maxDistancePct={maxDistancePct}
              />
            </div>
          )}

          {/* TAB 2: 15M CHART & COINBASE PREDICTION MODULE */}
          {activeTab === '15m Chart' && (
            <Crypto15mPredictionChart
              predictions={payload?.predictions}
              pairs={payload?.pairs}
              selectedAsset={
                (selectedSymbol.split('/')[0] as 'BTC' | 'ETH' | 'XRP' | 'SOL') || 'BTC'
              }
              onSelectAsset={(asset) => {
                const quote = selectedSymbol.endsWith('/USD') ? 'USD' : 'USDT';
                setSelectedSymbol(`${asset}/${quote}`);
              }}
            />
          )}

          {/* TAB 3: LIQUIDITY RADAR */}
          {activeTab === 'Liquidity Radar' && (
            <div className="space-y-4">
              <LiquidityRadarCanvas
                telemetry={activeTelemetry}
                maxDistancePct={maxDistancePct}
              />
              <WallsTable
                walls={activeTelemetry?.walls || []}
                sideFilter={sideFilter}
                maxDistancePct={maxDistancePct}
              />
            </div>
          )}

          {/* TAB 4: HEATMAP */}
          {activeTab === 'Heatmap' && (
            <LiquidityHeatmap
              symbol={selectedSymbol}
              slices={heatmapHistory[selectedSymbol] || []}
              livePrice={activeTelemetry?.livePrice || 0}
              synchronized={Boolean(activeTelemetry?.synchronized)}
            />
          )}

          {/* TAB 5: LIQUIDITY WALLS */}
          {activeTab === 'Liquidity Walls' && (
            <WallsTable
              walls={activeTelemetry?.walls || []}
              sideFilter={sideFilter}
              maxDistancePct={maxDistancePct}
            />
          )}

          {/* TAB 6: ORDER BOOK */}
          {activeTab === 'Order Book' && (
            <OrderBookPanel telemetry={activeTelemetry} />
          )}

          {/* TAB 7: HISTORICAL ANALYSIS */}
          {activeTab === 'Historical Analysis' && (
            <HistoricalReplay symbol={selectedSymbol} />
          )}

          {/* TAB 8: ALERTS */}
          {activeTab === 'Alerts' && (
            <section className="bg-[#0D131F] border border-slate-800 rounded-xl p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    Real-Time Liquidity & Wall Alerts
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Live event stream for large wall appearances, removals, migrations, cluster tests, and imbalances
                  </p>
                </div>
                <button
                  type="button"
                  onClick={enableBrowserNotifications}
                  className="px-3 py-1.5 rounded bg-sky-500/20 border border-sky-500/40 text-xs font-mono text-sky-300 font-semibold whitespace-nowrap shrink-0"
                >
                  {browserPushEnabled
                    ? 'Browser Push Enabled'
                    : 'Enable Browser Notifications'}
                </button>
              </div>

              <div className="divide-y divide-slate-800/70 font-mono tabular-nums text-xs">
                {(payload?.recentAlerts || []).length === 0 ? (
                  <div className="py-8 text-center text-slate-400">
                    Monitoring live Coinbase order books for threshold wall events...
                  </div>
                ) : (
                  (payload?.recentAlerts || []).map((a) => (
                    <div
                      key={a.id}
                      className="py-3 flex items-start justify-between gap-4"
                    >
                      <div>
                        <span
                          className={`font-bold mr-2 ${
                            a.severity === 'CRITICAL'
                              ? 'text-rose-400'
                              : a.severity === 'WARNING'
                              ? 'text-amber-400'
                              : 'text-sky-400'
                          }`}
                        >
                          [{a.severity}]
                        </span>
                        <span className="font-semibold text-slate-100">{a.title}</span>
                        <span className="text-slate-500"> · {a.exchange}</span>
                        <p className="text-slate-300 mt-1">{a.message}</p>
                      </div>
                      <span className="text-slate-400 whitespace-nowrap">
                        {new Date(a.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {/* TAB 9: SETTINGS */}
          {activeTab === 'Settings' && (
            <section className="bg-[#0D131F] border border-slate-800 rounded-xl p-4 space-y-5 font-mono text-xs">
              <div>
                <h2 className="text-sm font-semibold text-white">
                  Detection & Radar Configuration
                </h2>
                <p className="text-xs text-slate-400 mt-0.5 font-sans">
                  Customize liquidity wall detection thresholds and radar distance parameters
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-slate-800">
                <div>
                  <label
                    htmlFor="custom-wall-size-input"
                    className="block text-slate-300 mb-1.5"
                  >
                    Custom Minimum Wall Size (USD)
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="custom-wall-size-input"
                      type="number"
                      min={1000}
                      step={5000}
                      value={customWallInput}
                      onChange={(e) => setCustomWallInput(e.target.value)}
                      className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 w-44"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const parsed = parseInt(customWallInput, 10);
                        if (!isNaN(parsed) && parsed >= 1000) {
                          handleThresholdSelect(parsed);
                          setSettingsSavedNotice(`Updated minimum wall threshold to $${parsed.toLocaleString()} USD.`);
                        } else {
                          setSettingsSavedNotice('Please enter a valid USD threshold of at least $1,000.');
                        }
                      }}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-semibold whitespace-nowrap shrink-0"
                    >
                      Apply Threshold
                    </button>
                  </div>
                  {settingsSavedNotice && (
                    <p className="text-emerald-400 mt-2 text-[11px]">{settingsSavedNotice}</p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="radar-distance-slider"
                    className="block text-slate-300 mb-1.5"
                  >
                    Maximum Distance from Market Price (±{maxDistancePct.toFixed(1)}%)
                  </label>
                  <input
                    id="radar-distance-slider"
                    type="range"
                    min={1}
                    max={8}
                    step={0.5}
                    value={maxDistancePct}
                    onChange={(e) => setMaxDistancePct(parseFloat(e.target.value))}
                    className="w-full accent-sky-400 cursor-pointer"
                  />
                  <div className="flex justify-between text-[11px] text-slate-400 mt-1">
                    <span>±1.0% (Tight Scalp)</span>
                    <span>±3.5% (Standard)</span>
                    <span>±8.0% (Wide Macro)</span>
                  </div>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
