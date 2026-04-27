import type { BotEvent } from "@autopilot/shared-types";

type Subscriber = (event: BotEvent) => void;

class EventBus {
  private subs = new Set<Subscriber>();

  subscribe(fn: Subscriber): () => void {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  publish(event: BotEvent) {
    for (const fn of this.subs) {
      try {
        fn(event);
      } catch (err) {
        console.error("[bus] subscriber threw", err);
      }
    }
  }
}

export const bus = new EventBus();
