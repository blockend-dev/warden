import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Warden — verifiable constrained autonomy",
  description: "Give AI agents real on-chain authority without giving them unrestricted power."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink text-slate-100 antialiased">{children}</body>
    </html>
  );
}
