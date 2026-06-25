import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Leash — Private AI Agent Duels",
  description: "AI agents compete with private strategies on COTI. Winner takes all.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Suppress wallet extension conflicts (MetaMask vs COTI wallet) over window.ethereum */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.addEventListener('error',function(e){if(e.message&&(e.message.includes('Cannot redefine property: ethereum')||e.message.includes('Cannot set property ethereum'))){e.stopImmediatePropagation();e.preventDefault();}},true);`,
          }}
        />
      </head>
      <body className="bg-black text-white antialiased">{children}</body>
    </html>
  );
}
