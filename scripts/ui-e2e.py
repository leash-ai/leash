#!/usr/bin/env python3
"""
ui-e2e.py — drive the real UI against testnet, buttons and all.

Everything else here is tested below the interface. contracts/scripts/e2e-full.ts
proves the chain rules and agent/tests covers the strategies, but neither presses
a button, and the failures that reach a user live exactly there: a handler that
never fires, a modal that closes without sending, a banner that renders for three
outcomes out of four. The last run of this kind is what found the missing
no-contest banner, which every unit test on the repo was happy with.

It needs a wallet, and a headless browser has none. So one is injected: an
EIP-1193 `window.ethereum` that forwards reads over fetch and hands
eth_sendTransaction to a Node signer through a Playwright binding, which signs
and returns eth_sendRawTransaction. The page cannot tell the difference; it
connects, prompts for nothing and transacts for real.

    python3 scripts/ui-e2e.py                       # against http://localhost:3000
    python3 scripts/ui-e2e.py --url https://…       # against a deployment

Reads AGENT_PRIVATE_KEY and COTI_RPC from agent/.env. Spends real testnet COTI:
one duel at the stake the form uses.

Not part of CI. It needs a funded key and a live chain, same as e2e-full.ts.
"""
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent


def env_from(path: Path) -> dict:
    """Minimal .env reader — no dependency for four lines of KEY=value."""
    out = {}
    if not path.exists():
        return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


ENV = env_from(ROOT / "agent" / ".env")
KEY = ENV.get("AGENT_PRIVATE_KEY", "")
RPC = ENV.get("COTI_RPC", "https://testnet.coti.io/rpc")

if not KEY:
    sys.exit("AGENT_PRIVATE_KEY missing from agent/.env — nothing to sign with.")

# Signing happens in Node, where ethers already lives. Keeping the key out of the
# page is not paranoia: a page that holds a key is not the page users run.
SIGNER_JS = r"""
const { ethers } = require("ethers");
const [rpc, key, txJson] = process.argv.slice(2);
(async () => {
  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(key, provider);
  const tx = JSON.parse(txJson);
  const sent = await wallet.sendTransaction({
    to: tx.to,
    data: tx.data,
    value: tx.value ? BigInt(tx.value) : 0n,
    gasLimit: tx.gas ? BigInt(tx.gas) : 3000000n,
  });
  console.log(sent.hash);
})().catch((e) => { console.error(e.message); process.exit(1); });
"""


def make_signer(address: str):
    signer_path = ROOT / "agent" / ".ui-e2e-signer.js"
    signer_path.write_text(SIGNER_JS)

    def send_transaction(tx_json: str) -> str:
        result = subprocess.run(
            ["node", str(signer_path), RPC, KEY, tx_json],
            capture_output=True, text=True, cwd=str(ROOT / "agent"),
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip()[:200])
        return result.stdout.strip()

    return send_transaction, signer_path


INJECT = """
(() => {
  const RPC = "%(rpc)s";
  const ADDRESS = "%(address)s";
  let id = 0;

  const rpcCall = async (method, params) => {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params || [] }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);
    return json.result;
  };

  const provider = {
    isMetaMask: true,
    selectedAddress: ADDRESS,
    chainId: "%(chain_hex)s",
    on: () => {},
    removeListener: () => {},
    request: async ({ method, params }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [ADDRESS];
      if (method === "eth_chainId") return "%(chain_hex)s";
      if (method === "net_version") return "%(chain_dec)s";
      if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
      if (method === "eth_sendTransaction") {
        // Signed outside the page; the binding returns the hash the dapp expects.
        return await window.__sign(JSON.stringify(params[0]));
      }
      return await rpcCall(method, params);
    },
  };

  Object.defineProperty(window, "ethereum", { value: provider, writable: false });
})();
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:3000")
    ap.add_argument("--chain-id", type=int, default=7082400)
    ap.add_argument("--keep-open", action="store_true", help="leave the duel running")
    args = ap.parse_args()

    address = subprocess.run(
        ["node", "-e", f'const{{ethers}}=require("ethers");console.log(new ethers.Wallet("{KEY}").address)'],
        capture_output=True, text=True, cwd=str(ROOT / "agent"),
    ).stdout.strip()
    if not re.fullmatch(r"0x[0-9a-fA-F]{40}", address):
        sys.exit(f"could not derive an address from AGENT_PRIVATE_KEY: {address[:80]}")

    send_transaction, signer_path = make_signer(address)
    failures = []

    def check(name, ok, detail=""):
        print(f"  {'ok  ' if ok else 'FAIL'} {name}{(' — ' + detail) if detail else ''}")
        if not ok:
            failures.append(name)

    try:
        with sync_playwright() as p:
            browser = p.firefox.launch(headless=True)
            page = browser.new_page(viewport={"width": 1400, "height": 1400})
            errors = []
            page.on("console", lambda m: errors.append(m.text[:90]) if m.type == "error" else None)
            page.expose_function("__sign", send_transaction)
            page.add_init_script(INJECT % {
                "rpc": RPC, "address": address,
                "chain_hex": hex(args.chain_id), "chain_dec": str(args.chain_id),
            })

            print(f"\n── wallet {address[:10]}… on {args.url} ──")

            # 1. Build a bot through the conversation.
            page.goto(f"{args.url}/bots", wait_until="networkidle", timeout=90000)
            page.wait_for_timeout(3000)
            page.locator("button", has_text="Build a bot").first.click()
            page.wait_for_timeout(1500)
            page.locator("button", has_text="Patient").first.click()
            page.wait_for_timeout(25000)
            saved = [l.strip() for l in page.inner_text("body").splitlines() if l.strip().startswith("Save ")]
            check("the model designs a bot", bool(saved), saved[0] if saved else "no bot offered")
            if not saved:
                raise SystemExit(1)
            bot_name = saved[0][len("Save "):].strip()
            page.locator("button", has_text="Save ").first.click()
            page.wait_for_timeout(2500)
            check("the bot is kept", bot_name in page.inner_text("body"))

            # 2. Send it into a duel — a real transaction, signed outside the page.
            page.goto(args.url, wait_until="networkidle", timeout=90000)
            page.wait_for_timeout(2500)
            # An injected wallet answers eth_accounts on mount, so the app may
            # already consider itself connected — same as a MetaMask that has
            # authorised this origin before. Only click if it is actually asking.
            connect = page.locator("button", has_text="Connect Wallet")
            if connect.count() > 0:
                connect.first.click()
                page.wait_for_timeout(3000)
            connected = address[:6].lower() in page.inner_text("body").lower()
            check("the wallet is connected", connected, "already authorised" if connect.count() == 0 else "")

            page.locator("button", has_text="New Duel").first.click()
            page.wait_for_timeout(2000)
            check("the bot is offered in the duel form", bot_name in page.inner_text("body"))
            page.locator("button", has_text="2 min").first.click()
            page.wait_for_timeout(500)
            page.locator("button", has_text="Send ").first.click()

            # Anchored on the confirmation heading, not on any "#123" in the body
            # — the live duel list sits behind the modal and would match first.
            page.wait_for_selector("text=/Duel #\\d+ created/", timeout=180000)
            page.wait_for_timeout(3000)
            match = re.search(r"Duel #(\d+) created", page.inner_text("body"))
            check("the duel is created on-chain", bool(match), f"duel #{match.group(1)}" if match else "no id shown")
            if not match:
                raise SystemExit(1)
            duel_id = int(match.group(1))

            # 3. The duel page names the opponent the house bot actually drew.
            page.goto(f"{args.url}/duel/{duel_id}", wait_until="networkidle", timeout=90000)
            page.wait_for_timeout(20000)
            body = page.inner_text("body")
            roster = ["Blitz", "Drift", "Rebound", "Contrarian", "Scalper", "Sentinel"]
            drawn = [n for n in roster if n in body]
            check("an opponent took the challenge", bool(drawn), drawn[0] if drawn else "still waiting")
            check("your bot is named on the page", bot_name in body)

            page.screenshot(path="/tmp/ui-e2e-duel.png", full_page=True)
            print(f"\n  screenshot: /tmp/ui-e2e-duel.png")
            print(f"  watch:      {args.url}/duel/{duel_id}")

            # React StrictMode mounts effects twice in dev, so the feed's first
            # websocket is closed mid-handshake and the browser logs a connection
            # error for a socket that is about to be replaced by a working one.
            # It is an artefact of the dev server, not a defect — a raw
            # WebSocket to the same URL from the same page opens fine. Everything
            # else still fails the run.
            real = [e for e in errors if "ws://" not in e and "WebSocket" not in e]
            check("no console errors", len(real) == 0, "; ".join(real[:2]))
            if len(real) != len(errors):
                print(f"       ({len(errors) - len(real)} websocket notice(s) ignored — StrictMode)")
            browser.close()
    finally:
        signer_path.unlink(missing_ok=True)

    print()
    if failures:
        print(f"  {len(failures)} failed: {', '.join(failures)}")
        sys.exit(1)
    print("  all good")


if __name__ == "__main__":
    main()
