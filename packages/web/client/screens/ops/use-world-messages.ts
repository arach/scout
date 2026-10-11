import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';
import type { WorldBrokerMessage } from '../../../shared/world-broker-messages.ts';
export function useWorldMessages(enabled = true) {
  const [messages, setMessages] = useState<WorldBrokerMessage[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { const next = await api<WorldBrokerMessage[]>('/api/world/messages'); if (!stopped) setMessages(next); }
      catch { /* Keep last confirmed messages; their timestamps still expire. */ }
      if (!stopped) timer = setTimeout(refresh, 3000);
    };
    void refresh();
    return () => { stopped = true; clearTimeout(timer); };
  }, [enabled]);
  return messages;
}
