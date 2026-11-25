import type { Metadata } from "next";
import { Reddit_Sans } from "next/font/google";
import "./globals.css";

const body = Reddit_Sans({ subsets: ["latin"], variable: "--font-body", weight: ["400", "500", "600", "700"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Eternity Alumni", template: "%s · Eternity Alumni" },
  description: "Your alumni network: directory, events, jobs and giving.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={body.variable}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
