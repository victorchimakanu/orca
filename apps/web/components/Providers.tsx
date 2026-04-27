"use client";

/**
 * Stack of providers required by <AomiFrame/> from @aomi/aomi-frame.
 *
 *   QueryClientProvider
 *     WagmiProvider (polygon, injected MetaMask connector)
 *       <children/>
 *
 * The aomi auth adapter (lib/aomi-auth-adapter.ts) reads wagmi state and
 * routes connect / sign / send through MetaMask via wagmi.
 */
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { polygon } from "wagmi/chains";
import { injected } from "wagmi/connectors";

const wagmiConfig = createConfig({
  chains: [polygon],
  connectors: [injected({ shimDisconnect: true })],
  transports: { [polygon.id]: http() },
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>
    </QueryClientProvider>
  );
}
