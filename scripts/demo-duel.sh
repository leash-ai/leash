#!/usr/bin/env bash
#
# demo-duel.sh — start both agent daemons and put a real duel on testnet.
#
# Collapses six commands and one easy mistake into one. The mistake: the daemons
# must not be running while contracts/scripts/e2e-full.ts does, because they will
# join its duels and overwrite its scores — and the failure reads like a broken
# contract rather than a dirty environment. This refuses to start if the e2e is
# running, and tells you how to stop what it started.
#
#   ./scripts/demo-duel.sh            # 15-minute duel
#   ./scripts/demo-duel.sh 300        # 5-minute duel
#
set -euo pipefail

DURATION="${1:-900}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT="$ROOT/agent"
# TMPDIR usually ends in a slash on macOS; strip it so the paths we print are clean.
LOGS="${TMPDIR:-/tmp}"
LOGS="${LOGS%/}/leash-demo"
mkdir -p "$LOGS"

if pgrep -f 'ts-node scripts/e2e-full' >/dev/null 2>&1; then
  echo "refusing to start: e2e-full.ts is running." >&2
  echo "The daemons would join its duels and overwrite its scores." >&2
  exit 1
fi

if [ ! -f "$AGENT/.env" ]; then
  echo "missing $AGENT/.env — copy .env.example and fill it in" >&2
  exit 1
fi

echo "stopping any daemons already running…"
pkill -f 'ts-node rentalListener' 2>/dev/null || true
pkill -f 'ts-node renterListener' 2>/dev/null || true
sleep 2

cd "$AGENT"
echo "starting the owner's agent   (momentum)…"
nohup npx ts-node rentalListener.ts > "$LOGS/owner.log" 2>&1 &
OWNER_PID=$!

# Different strategies on purpose: two identical ones see the same prices, report
# the same score and tie — and a tie goes to agentB by rule. That looks like a bug
# and is not one.
echo "starting the renter's agent  (meanReversion)…"
STRATEGY=meanReversion nohup npx ts-node renterListener.ts > "$LOGS/renter.log" 2>&1 &
RENTER_PID=$!

sleep 15

DUEL=$(node -e '
require("dotenv").config();
const { ethers } = require("ethers");
const MKT = [
  "function listingCount() view returns (uint256)",
  "function listings(uint256) view returns (uint256,address,uint256,uint256,bool)",
  "function rentAndDuel(uint256,uint256) payable returns (uint256,uint256)",
];
(async () => {
  const p = new ethers.JsonRpcProvider(process.env.COTI_RPC);
  const renter = new ethers.Wallet(process.env.RENTER_PRIVATE_KEY, p);
  const owner  = new ethers.Wallet(process.env.OWNER_PRIVATE_KEY, p);
  const mkt = new ethers.Contract(process.env.AGENT_MARKETPLACE_ADDRESS, MKT, renter);
  const n = await mkt.listingCount();
  let pick = null;
  for (let i = n; i >= 1n; i--) {
    const l = await mkt.listings(i);
    if (l[4] && l[1].toLowerCase() === owner.address.toLowerCase()) { pick = i; break; }
  }
  if (!pick) { console.error("no listing available from the owner"); process.exit(1); }
  const rc = await (await mkt.rentAndDuel(pick, Number(process.argv[1]),
    { value: ethers.parseEther("0.002"), gasLimit: 5_000_000n })).wait();
  const lg = rc.logs.find(l => l.topics[0] === ethers.id("AgentRented(uint256,uint256,address)"));
  process.stdout.write(String(BigInt(lg.topics[2])));
})().catch(e => { console.error(e.shortMessage || e.message); process.exit(1); });
' "$DURATION")

cat <<EOF

  duel #$DUEL is live for $((DURATION / 60)) minutes.

  watch it      http://localhost:3000/duel/$DUEL
  agent logs    tail -f $LOGS/owner.log
                tail -f $LOGS/renter.log

  When the clock runs out both agents settle their score encrypted, and 60s
  later the page offers a Resolve button — anyone can press it and earns the
  resolver bonus.

  stop the agents   kill $OWNER_PID $RENTER_PID

EOF
