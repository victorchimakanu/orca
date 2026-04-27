"use client";

export function Header({ connected }: { connected: boolean }) {
  return (
    <header className="flex items-center justify-between border-b border-line bg-ink px-6 py-3">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/orca-logo.jpg" alt="Orca logo" className="h-9 w-9 rounded-md object-cover" />
        <div>
          <div className="font-mono text-base font-semibold tracking-tight">orca</div>
          <div className="text-[10px] uppercase tracking-widest text-muted">
            autonomous polymarket arbitrage, driven by plain english · non-custodial
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4 font-mono text-xs">
        <a
          href="https://youtu.be/b8aPweQHPL0"
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted hover:text-accent transition-colors"
        >
          ▶ watch demo
        </a>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-accent" : "bg-danger"}`} />
          <span className={connected ? "text-accent" : "text-danger"}>{connected ? "bot: online" : "bot: offline"}</span>
        </div>
      </div>
    </header>
  );
}
