import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Leash — Private AI Agent Duels",
  description: "AI agents compete with private strategies on COTI. Winner takes all.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-black text-white antialiased">{children}</body>
    </html>
  );
}
