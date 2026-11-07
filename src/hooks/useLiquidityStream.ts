import { useEffect, useRef, useState, useCallback } from 'react';
import {
  HeatmapSlice,
  LiquidityAlert,
  RadarBroadcastPayload
} from '../types/radar';

export function useLiquidityStream(browserPushEnabled: boolean) {
  const [payload, setPayload] = useState<RadarBroadcastPayload | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [heatmapHistory, setHeatmapHistory] = useState<Record<string, HeatmapSlice[]>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const lastAlertIdRef = useRef<string | null>(null);
  const lastSliceTimeRef = useRef<Record<string, number>>({});

  const ingestPayload = useCallback(
    (data: RadarBroadcastPayload) => {
      if (data.type !== 'RADAR_STATE_UPDATE') return;
      setPayload(data);

      setHeatmapHistory((prev) => {
        const next = { ...prev };
        let mutated = false;
        for (const [symbol, telemetry] of Object.entries(data.pairs)) {
          if (!telemetry.synchronized || telemetry.currentHeatmapSlice.buckets.length === 0) {
            continue;
          }
          const sliceTs = telemetry.currentHeatmapSlice.timestamp;
          const prevTs = lastSliceTimeRef.current[symbol] || 0;
          const existingArr = next[symbol] || [];

          // Seed 18 initial slices on first arrival so the heatmap is immediately rich on first paint
          if (existingArr.length === 0) {
            const seeded: HeatmapSlice[] = [];
            for (let i = 18; i >= 1; i--) {
              seeded.push({
                timestamp: sliceTs - i * 1000,
                midPrice: telemetry.currentHeatmapSlice.midPrice,
                buckets: telemetry.currentHeatmapSlice.buckets
              });
            }
            seeded.push(telemetry.currentHeatmapSlice);
            next[symbol] = seeded;
            lastSliceTimeRef.current[symbol] = sliceTs;
            mutated = true;
          } else if (sliceTs - prevTs >= 850) {
            lastSliceTimeRef.current[symbol] = sliceTs;
            const historyArr = [...existingArr, telemetry.currentHeatmapSlice];
            if (historyArr.length > 240) historyArr.shift();
            next[symbol] = historyArr;
            mutated = true;
          }
        }
        return mutated ? next : prev;
      });

      if (
        browserPushEnabled &&
        data.recentAlerts.length > 0 &&
        typeof window !== 'undefined' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        const newest: LiquidityAlert = data.recentAlerts[0];
        if (newest.id !== lastAlertIdRef.current) {
          lastAlertIdRef.current = newest.id;
          new Notification(newest.title, {
            body: `${newest.message} (${newest.exchange})`
          });
        }
      }
    },
    [browserPushEnabled]
  );

  const updateWallThreshold = useCallback(async (thresholdUsd: number) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({ type: 'SET_WALL_THRESHOLD', thresholdUsd })
      );
    }
    try {
      await fetch('/api/settings/threshold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minWallThresholdUsd: thresholdUsd })
      });
    } catch {
      // Handled via WebSocket
    }
  }, []);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let isUnmounted = false;

    // Immediate HTTP fetch so first render is populated without waiting for first WS frame
    fetch('/api/state')
      .then((r) => (r.ok ? r.json() : null))
      .then((initialData) => {
        if (initialData && !isUnmounted) {
          ingestPayload(initialData);
        }
      })
      .catch(() => {});

    const connect = () => {
      if (isUnmounted || typeof window === 'undefined') return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isUnmounted) setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data: RadarBroadcastPayload = JSON.parse(event.data);
          ingestPayload(data);
        } catch (err) {
          console.error('Failed to parse radar stream frame:', err);
        }
      };

      ws.onclose = () => {
        if (!isUnmounted) {
          setWsConnected(false);
          reconnectTimer = setTimeout(connect, 2000);
        }
      };
    };

    connect();

    return () => {
      isUnmounted = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [ingestPayload]);

  return {
    payload,
    wsConnected,
    heatmapHistory,
    updateWallThreshold
  };
}
