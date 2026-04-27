"use client";

import { useMemo } from "react";
import {
  useAccount as useWagmiAccount,
  useConnect,
  useDisconnect,
  useSendTransaction,
  useSignTypedData,
  useSwitchChain,
} from "wagmi";
import { injected } from "wagmi/connectors";
import type {
  WalletEip712Payload,
  WalletTxPayload,
} from "@aomi-labs/react";
import {
  AOMI_AUTH_BOOTING_IDENTITY,
  AOMI_AUTH_DISCONNECTED_IDENTITY,
  formatAddress,
  type AomiAuthIdentity,
} from "./auth-identity";

export type AomiAuthAdapter = {
  identity: AomiAuthIdentity;
  isReady: boolean;
  isSwitchingChain: boolean;
  canConnect: boolean;
  canManageAccount: boolean;
  connect: () => Promise<void>;
  manageAccount: () => Promise<void>;
  switchChain?: (chainId: number) => Promise<void>;
  sendTransaction?: (
    payload: WalletTxPayload,
  ) => Promise<{ txHash: string; amount?: string }>;
  signTypedData?: (
    payload: WalletEip712Payload,
  ) => Promise<{ signature: string }>;
};

export function useAomiAuthAdapter(): AomiAuthAdapter {
  const { address, chainId, isConnected, isConnecting, isReconnecting } =
    useWagmiAccount();
  const { connectAsync } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const { signTypedDataAsync } = useSignTypedData();

  return useMemo(() => {
    const isBooting = (isConnecting || isReconnecting) && !isConnected;

    const identity: AomiAuthIdentity = isBooting
      ? { ...AOMI_AUTH_BOOTING_IDENTITY, chainId: chainId ?? undefined }
      : isConnected && address
        ? {
          status: "connected",
          isConnected: true,
          address,
          chainId: chainId ?? undefined,
          authProvider: "wallet",
          primaryLabel: formatAddress(address) ?? "Connected wallet",
          secondaryLabel: undefined,
        }
        : {
          ...AOMI_AUTH_DISCONNECTED_IDENTITY,
          chainId: chainId ?? undefined,
        };

    return {
      identity,
      isReady: !isBooting,
      isSwitchingChain,
      canConnect: !identity.isConnected,
      canManageAccount: identity.isConnected,
      connect: async () => {
        await connectAsync({ connector: injected() });
      },
      manageAccount: async () => {
        await disconnectAsync();
      },
      switchChain: switchChainAsync
        ? async (nextChainId: number) => {
          await switchChainAsync({ chainId: nextChainId });
        }
        : undefined,
      sendTransaction: sendTransactionAsync
        ? async (payload: WalletTxPayload) => {
          const txHash = await sendTransactionAsync({
            chainId: payload.chainId,
            to: payload.to as `0x${string}`,
            value: payload.value ? BigInt(payload.value) : undefined,
            data:
              payload.data && payload.data !== "0x"
                ? (payload.data as `0x${string}`)
                : undefined,
          });
          return { txHash, amount: payload.value };
        }
        : undefined,
      signTypedData: signTypedDataAsync
        ? async (payload: WalletEip712Payload) => {
          const args = payload.typed_data;
          if (!args || !args.types || !args.primaryType) {
            throw new Error("Missing typed_data on EIP-712 payload");
          }
          const signature = await signTypedDataAsync({
            domain: args.domain as never,
            types: args.types as never,
            primaryType: args.primaryType as never,
            message: (args.message ?? {}) as never,
          });
          return { signature };
        }
        : undefined,
    };
  }, [
    address,
    chainId,
    connectAsync,
    disconnectAsync,
    isConnected,
    isConnecting,
    isReconnecting,
    isSwitchingChain,
    sendTransactionAsync,
    signTypedDataAsync,
    switchChainAsync,
  ]);
}
