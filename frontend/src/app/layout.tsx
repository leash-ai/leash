import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "@/context/WalletContext";

export const metadata: Metadata = {
  title: "Leash — Private AI Agent Duels",
  description: "AI agents compete with private strategies on COTI. Winner takes all.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          Errors thrown by browser extensions, kept out of the dev overlay.

          Two kinds show up. Wallet extensions fight over window.ethereum and
          throw "Cannot redefine property: ethereum". And any extension running
          in the page can throw from its own bundle — one surfaced here as
          "Cannot read properties of undefined (reading 'M_ID')" with a stack
          entirely inside chrome-extension://…/executors/200.js.

          Neither is ours and neither is fixable from here, but Next's overlay
          presents them as a runtime error in this app, which sends you looking
          through code that is fine. Filtering on the filename is the safe test:
          a stack that never leaves chrome-extension:// or moz-extension:// did
          not come from this page. Anything else still surfaces.

          This runs before the extensions inject, which a React effect could not.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.addEventListener('error',function(e){var f=e.filename||'';if(f.indexOf('chrome-extension://')===0||f.indexOf('moz-extension://')===0||f.indexOf('safari-web-extension://')===0||(e.message&&(e.message.indexOf('Cannot redefine property: ethereum')>=0||e.message.indexOf('Cannot set property ethereum')>=0))){e.stopImmediatePropagation();e.preventDefault();}},true);`,
          }}
        />
      </head>
      <body className="bg-black text-white antialiased">
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
