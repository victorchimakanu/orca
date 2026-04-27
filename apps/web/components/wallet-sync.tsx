"use client";

import { useEffect } from "react";
import { useAccount } from "wagmi";

const BOT_URL = process.env.NEXT_PUBLIC_BOT_URL ?? "http://127.0.0.1:8787";

export function WalletSync() {
  const { address, isConnected } = useAccount();

  useEffect(() => {
    if (!isConnected || !address) {
      void fetch(`${BOT_URL}/wallet`, { method: "DELETE" }).catch(() => {});
      return;
    }
    void fetch(`${BOT_URL}/wallet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    }).catch(() => {});
  }, [address, isConnected]);

  return null;
}
