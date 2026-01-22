// src/hooks/useRealtimeUpdates.js
import { useEffect } from 'react';
import { startSse } from '../realtime.js';

export function useRealtimeUpdates({ onInbound, onOutbound }) {
  useEffect(() => {
    const ts = () => new Date().toISOString();

    console.log('[SSE-HOOK]', ts(), '• mount/useRealtimeUpdates');
    console.log('[SSE-HOOK]', ts(), '• handler presence →', {
      hasInbound: typeof onInbound === 'function',
      hasOutbound: typeof onOutbound === 'function'
    });

    // Wrap handlers ONLY to log; then forward to originals
    const inboundWrapper = (data, evtName) => {
      try {
        onInbound?.(data, evtName);
      } catch (err) {
      }
    };

    const outboundWrapper = (data, evtName) => {
      try {
        onOutbound?.(data, evtName);
      } catch (err) {
      }
    };

    const stop = startSse({
      onInbound: inboundWrapper,
      onOutbound: outboundWrapper
    });

    // Verify we got a disposer
    if (typeof stop !== 'function') {
    } else {
    }

    // Teardown
    return () => {
      try {
        stop?.();
      } catch (err) {
      }
    };
  }, [onInbound, onOutbound]);
}
