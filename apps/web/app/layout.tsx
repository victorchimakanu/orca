import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "Orca",
  description: "Autonomous arbitrage on Polymarket, driven by plain English. Non-custodial by design — your key signs, the agent only proposes.",
  icons: { icon: "/orca-logo.jpg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("dark font-sans", geist.variable)}>
      <body>{children}</body>
    </html>
  );
}
