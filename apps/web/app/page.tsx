"use client";

import { useBotEvents } from "@/lib/use-bot-events";
import { Dashboard } from "@/components/Dashboard";
import { Header } from "@/components/Header";
import { ReasoningLog } from "@/components/ReasoningLog";
import { Providers } from "@/components/Providers";
import { AomiFrame } from "@/components/aomi-frame";
import { WalletSync } from "@/components/wallet-sync";

export default function HomePage() {
  const { events, connected } = useBotEvents();

  return (
    <Providers>
      <WalletSync />
      <div className="flex h-screen flex-col">
        <Header connected={connected} />
        <div className="grid min-h-0 flex-1 grid-cols-[420px_1fr_420px] grid-rows-[minmax(0,1fr)] gap-3 overflow-hidden p-3">
          <div className="h-full overflow-hidden">
            <AomiFrame.Root height="100%" showSidebar={false} walletPosition="header">
              <AomiFrame.Header
                withControl
                showSidebarTrigger={false}
                controlBarProps={{
                  hideWallet: false,
                  hideNetwork: false,
                  hideModel: true,
                  hideApp: true,
                  hideApiKey: true,
                  hideSecrets: true,
                }}
              />
              <AomiFrame.Composer />
            </AomiFrame.Root>
          </div>
          <Dashboard events={events} />
          <ReasoningLog events={events} />
        </div>
      </div>
    </Providers>
  );
}
