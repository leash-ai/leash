"use client";

import { useEffect } from "react";

// Chrome wallet extensions (MetaMask, COTI wallet, etc.) conflict over
// window.ethereum and throw "Cannot redefine property: ethereum" — this
// is a browser extension issue, not our code. Suppress it so Next.js
// doesn't show the error overlay.
export function BrowserErrorSuppressor() {
  useEffect(() => {
    const handler = (event: ErrorEvent) => {
      if (
        event.message?.includes("Cannot redefine property: ethereum") ||
        event.message?.includes("Cannot set property ethereum")
      ) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    };
    window.addEventListener("error", handler, true);
    return () => window.removeEventListener("error", handler, true);
  }, []);

  return null;
}
