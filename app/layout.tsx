import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pie AES256 Hole — Guided private DNS setup",
  description: "A friendly setup and management experience for Pi-hole, Tailscale, WireGuard, and private DNS protection.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
