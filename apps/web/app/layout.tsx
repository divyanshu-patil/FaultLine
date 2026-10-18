import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { TopBar } from "../components/TopBar";
import { Footer } from "../components/Footer";

const display = Space_Grotesk({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-sg", display: "swap" });
const body = Inter({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "FaultLine — an AI agent that shops at your store to break it",
  description: "FaultLine stress-tests PayPal checkout integrations with real sandbox purchases, then proves the fix. Verdicts come from deterministic checks against PayPal's own record, not the AI.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable}`} style={{ ["--font-display" as string]: "var(--font-sg)", ["--font-body" as string]: "var(--font-inter)" }}>
        <TopBar />
        {children}
        <Footer />
      </body>
    </html>
  );
}
