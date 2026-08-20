import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

import { fetchPrices } from "./prices";
import { MistralAgent, AgentState } from "./ai_agent";
import { cotiWallet, submitFinalPnL } from "../coti/settlement";

const DM_ABI = [
  "function getDuel(uint256) view returns (address agentA, address agentB, uint256 stake, uint256 startTime, uint256 endTime, uint8 state, address winner, bool agentASubmitted, bool agentBSubmitted, uint256 createdAt)",
  "function updateLivePnL(uint256 duelId, int256 pnlBps) external",
  "function submitFinalPnL(uint256 duelId, (uint256 ciphertext, bytes signature) encryptedPnL)",
];

export type FeedEvent = {
  type: "tick" | "trade" | "pnl" | "end" | "error" | "info";
  timestamp: number;
  data: any;
};

export async function runDuel(
  duelId: number,
  state: AgentState,
  onEvent: (e: FeedEvent) => void,
  signerKey?: string
): Promise<void> {
  const key = signerKey || process.env.SIGNING_KEYS!;
  const provider = new ethers.JsonRpcProvider(
    process.env.COTI_RPC || "https://testnet.coti.io/rpc"
  );
  const wallet = new ethers.Wallet(key, provider);
  const dm = new ethers.Contract(process.env.DUEL_MANAGER_ADDRESS!, DM_ABI, wallet);
  const ai = new MistralAgent();

  const emit = (type: FeedEvent["type"], data: any) =>
    onEvent({ type, timestamp: Date.now(), data });

  // Read duel state
  let duel: any;
  try {
    duel = await dm.getDuel(duelId);
  } catch (e: any) {
    emit("error", { message: `Cannot read duel ${duelId}: ${e.message}` });
    return;
  }

  if (Number(duel.state) !== 1) {
    emit("error", { message: `Duel ${duelId} is not Active (state=${duel.state})` });
    return;
  }

  const endMs = Number(duel.endTime) * 1000;
  const remaining = endMs - Date.now();
  if (remaining <= 0) {
    emit("end", { message: "Duel already expired" });
    return;
  }

  // For short duels: ~8 ticks total, min 10s, max 30s
  const tickMs = Math.max(10_000, Math.min(30_000, Math.floor(remaining / 8)));

  emit("info", {
    message: `Agent started — wallet ${wallet.address.slice(0, 8)}… | duel ends in ${Math.round(remaining / 1000)}s | tick every ${tickMs / 1000}s`,
  });

  // What the contract has on record for us. Settlement is pinned to this value
  // in-circuit, so it has to be the number that actually landed on-chain — not a
  // recomputed one, since prices move between the last tick and the duel ending.
  let lastReportedPnlBps: number | null = null;
  let settled = false;

  /**
   * Submit the encrypted final score. Runs once, after endTime, inside
   * DuelManager's FINAL_WINDOW. An agent that skips this forfeits at resolution.
   */
  const settle = async () => {
    if (settled) return;
    settled = true;

    if (lastReportedPnlBps === null) {
      emit("info", { message: "Nothing was reported on-chain — no score to settle" });
      return;
    }

    try {
      const signer = await cotiWallet(key, provider, process.env.AES_KEY);
      const hash = await submitFinalPnL(
        signer, process.env.DUEL_MANAGER_ADDRESS!, duelId, lastReportedPnlBps
      );
      emit("info", {
        message: `Settled with encrypted score ${(lastReportedPnlBps / 100).toFixed(2)}% — ${hash.slice(0, 10)}…`,
      });
    } catch (e: any) {
      emit("error", { message: `Settlement failed, this agent forfeits: ${e.message?.slice(0, 90)}` });
    }
  };

  const loop = async () => {
    try {
      // Re-check duel
      const d = await dm.getDuel(duelId).catch(() => null);
      if (!d || Number(d.state) !== 1 || Date.now() >= Number(d.endTime) * 1000) {
        await settle();
        emit("end", { message: "Duel ended" });
        return;
      }

      // Fetch prices
      const prices = await fetchPrices();

      // Ask Mistral
      emit("tick", { message: "Thinking…" });
      const decision = await ai.tick(state, prices);

      emit("trade", {
        tradeLog: decision.tradeLog,
        reasoning: decision.reasoning,
        pnlBps: decision.pnlBps,
        prices,
      });

      // Submit PnL on-chain
      try {
        const tx = await dm.updateLivePnL(duelId, BigInt(decision.pnlBps), {
          gasLimit: 200_000n,
        });
        await tx.wait();
        lastReportedPnlBps = decision.pnlBps;
        emit("pnl", { pnlBps: decision.pnlBps, txHash: tx.hash });
      } catch (e: any) {
        emit("error", { message: `PnL submit failed: ${e.message?.slice(0, 80)}` });
      }
    } catch (e: any) {
      emit("error", { message: e.message?.slice(0, 100) });
    }

    // Schedule next tick if still time
    const d2 = await dm.getDuel(duelId).catch(() => null);
    const timeLeft = d2 ? Number(d2.endTime) * 1000 - Date.now() : 0;
    if (d2 && Number(d2.state) === 1 && timeLeft > 5_000) {
      const delay = Math.min(tickMs, timeLeft - 3_000);
      setTimeout(loop, Math.max(5_000, delay));
    } else {
      await settle();
      emit("end", { message: "Duel complete" });
    }
  };

  // First tick after 2s
  setTimeout(loop, 2_000);
}
