import type { Metadata } from "next";
import { Reddit_Sans } from "next/font/google";
import "./globals.css";

const body = Reddit_Sans({ subsets: ["latin"], variable: "--font-body", weight: ["400", "500", "600", "700"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Eternity Desk", template: "%s · Eternity Desk" },
  description: "Requests, complaints and grievances, answered on time.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={body.variable}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
