"use client";

import type { BotEvent } from "@autopilot/shared-types";
import { useEffect, useRef, useState } from "react";
import { BOT_URL } from "./bot-url";

export function useBotEvents() {
  const [events, setEvents] = useState<BotEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource(`${BOT_URL}/events`);
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    const handlers: Array<[BotEvent["type"], (data: BotEvent) => void]> = [
      ["policy_parsed", push],
      ["reasoning", push],
      ["proposal", push],
      ["wallet_tx_request", push],
      ["wallet_eip712_request", push],
      ["fill", push],
      ["position", push],
      ["pnl", push],
      ["halt", push],
    ];

    function push(event: BotEvent) {
      setEvents((prev) => {
        const next = [...prev, event];
        return next.length > 500 ? next.slice(-500) : next;
      });
    }

    for (const [name, fn] of handlers) {
      es.addEventListener(name, (ev) => {
        try {
          fn(JSON.parse((ev as MessageEvent).data) as BotEvent);
        } catch {}
      });
    }

    return () => {
      es.close();
    };
  }, []);

  return { events, connected };
}
