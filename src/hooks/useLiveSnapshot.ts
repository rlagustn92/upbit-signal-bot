import { useEffect, useRef, useState } from 'react';
import type { SnapshotDTO } from '../../shared/types';

/**
 * 서버 실시간 상태(SSE /api/stream). 새로고침 없이 현재가·봇·계좌·시스템 상태가 갱신된다.
 * 연결이 끊기면 EventSource가 자동으로 다시 연결하고, 그동안 backendConnected=false.
 */
export function useLiveSnapshot() {
  const [snapshot, setSnapshot] = useState<SnapshotDTO | null>(null);
  const [backendConnected, setBackendConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let closed = false;
    let retryTimer: number | undefined;

    const connect = () => {
      if (closed) return;
      const es = new EventSource('/api/stream');
      esRef.current = es;
      es.addEventListener('snapshot', (ev) => {
        try {
          setSnapshot(JSON.parse((ev as MessageEvent).data));
          setBackendConnected(true);
        } catch {
          /* ignore */
        }
      });
      es.onerror = () => {
        setBackendConnected(false);
        if (es.readyState === EventSource.CLOSED) {
          es.close();
          retryTimer = window.setTimeout(connect, 3000);
        }
      };
    };
    connect();
    return () => {
      closed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      esRef.current?.close();
    };
  }, []);

  return { snapshot, backendConnected };
}
