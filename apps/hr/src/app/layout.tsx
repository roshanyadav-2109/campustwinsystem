import type { Metadata } from "next";
import { Reddit_Sans } from "next/font/google";
import "./globals.css";

const body = Reddit_Sans({ subsets: ["latin"], variable: "--font-body", weight: ["400", "500", "600", "700"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Eternity HR", template: "%s · Eternity HR" },
  description: "People, attendance and leave for your organisation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={body.variable}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
