import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Notion PM — Managed Agent Fleet",
  description: "Conversational ops orchestrator for AI Integraterz",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
