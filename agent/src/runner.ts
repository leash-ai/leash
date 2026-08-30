import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

import { fetchPrices, Prices } from "./prices";
import { fetchPriceHistory } from "../strategies/warmup";
import { scoreBps } from "../notional";
import { startLivePrices, currentPrices } from "../livePrices";
import { getPnLBps } from "./portfolio";
import { TradingAgent, AgentState } from "./ai_agent";
import { cotiWallet, submitFinalPnL } from "../coti/settlement";

const DM_ABI = [
  "function getDuel(uint256) view returns (address agentA, address agentB, uint256 stake, uint256 startTime, uint256 endTime, uint8 state, address winner, bool agentASubmitted, bool agentBSubmitted, uint256 createdAt)",
  "function updateLivePnL(uint256 duelId, int256 pnlBps) external",
  "function updateLivePnLBatch(uint256 duelId, int256[] pnlBps, uint32[] ageMs) external",
  "function submitFinalPnL(uint256 duelId, (uint256 ciphertext, bytes signature) encryptedPnL)",
  "function getLivePnL(uint256 duelId) view returns (int256 pnlA, int256 pnlB)",
  "function settlementDelegate(uint256 duelId, address delegate) view returns (address)",
];

export type FeedEvent = {
  type: "tick" | "trade" | "pnl" | "end" | "error" | "info" | "mark";
  timestamp: number;
  data: any;
};

export async function runDuel(
  duelId: number,
  state: AgentState,
  onEvent: (e: FeedEvent) => void,
  signerKey?: string
): Promise<void> {
  // AGENT_PRIVATE_KEY is what agent/.env.example declares and what every other
  // runtime here reads. This used to fall back to SIGNING_KEYS — a contracts-side
  // name absent from the agent's env, and a comma-separated list even when it is
  // set, so a Wallet built from it would fail anyway. The result was that the
  // frontend's "Start Agent" button always died on `invalid private key`, which
  // says nothing about what to fix.
  const key = signerKey || process.env.AGENT_PRIVATE_KEY || process.env.SIGNING_KEYS?.split(",")[0];
  if (!key) {
    throw new Error(
      "No signing key: set AGENT_PRIVATE_KEY in agent/.env, or pass signerKey when starting the agent.",
    );
  }

  const provider = new ethers.JsonRpcProvider(
    process.env.COTI_RPC || "https://testnet.coti.io/rpc"
  );

  let wallet: ethers.Wallet;
  try {
    wallet = new ethers.Wallet(key.trim(), provider);
  } catch {
    throw new Error("The configured signing key is not a valid private key — check AGENT_PRIVATE_KEY.");
  }
  /*
    Sends are not awaited, so the nonce has to be managed.

    A COTI block is about six seconds and a receipt takes far longer than that —
    the house bot's own log showed 37 seconds between ticks with `tick every 8s`
    configured, because `await tx.wait()` was the real interval. Waiting caps the
    curve at two points a minute no matter what the tick is set to.

    NonceManager assigns nonces locally instead of asking the node for a pending
    count, so several updates can be in flight without colliding. The chain
    executes them in nonce order, so "last value wins" still means the last one
    sent.
  */
  const signer = new ethers.NonceManager(wallet);
  const dm = new ethers.Contract(process.env.DUEL_MANAGER_ADDRESS!, DM_ABI, signer);
  const ai = new TradingAgent();

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

  /**
   * A freshly created duel is Open, not Active.
   *
   * The duel form starts the agent the moment createDuel returns, and the house
   * bot needs a transaction of its own to take it — a few seconds on testnet.
   * Giving up on the first read meant the creator's side never ran at all: the
   * duel went Active seconds later, the house bot traded it alone, and the
   * warning about needing an agent server was fitting the wrong cause. The agent
   * was there. It had already quit.
   *
   * endTime is meaningless before the join too — it holds the raw duration until
   * then, which is how a 300 lands in 1970 and every loop exits immediately.
   */
  const WAIT_FOR_OPPONENT_MS = 180_000;
  if (Number(duel.state) === 0) {
    emit("info", { message: "Waiting for an opponent to take the challenge…" });
    const deadline = Date.now() + WAIT_FOR_OPPONENT_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 4000));
      duel = await dm.getDuel(duelId).catch(() => duel);
      if (Number(duel.state) !== 0) break;
    }
  }

  if (Number(duel.state) !== 1) {
    emit("error", {
      message:
        Number(duel.state) === 0
          ? `Nobody took duel ${duelId} within ${WAIT_FOR_OPPONENT_MS / 1000}s — the agent is not running it.`
          : `Duel ${duelId} is not Active (state=${duel.state})`,
    });
    return;
  }

  const endMs = Number(duel.endTime) * 1000;
  const remaining = endMs - Date.now();
  if (remaining <= 0) {
    emit("end", { message: "Duel already expired" });
    return;
  }

  /*
    A tick is a frame of the race, so there have to be a lot of them.

    This used to aim for eight ticks — one every thirty seconds on a ten-minute
    duel. Twenty seconds could pass with nothing on screen at all, and a curve
    built from eight points is a bar chart with rounded corners. The cost of a
    tick is one model call and one transaction; on COTI the transaction is the
    slow half at four to eight seconds, and it is awaited before the next tick is
    scheduled, so asking for five is really asking for "as fast as the chain
    allows" without ever queueing two at once.
  */
  const tickMs = Math.max(3_000, Math.min(6_000, Math.floor(remaining / 80)));

  emit("info", {
    message: `Agent started — wallet ${wallet.address.slice(0, 8)}… | duel ends in ${Math.round(remaining / 1000)}s | tick every ${tickMs / 1000}s`,
  });

  /*
    Mark often, publish in batches.

    A block here is about six seconds, so one transaction per score capped the
    curve at a point every few seconds however fast the agent thought. The values
    in between were never unknown — this portfolio at the current price — they
    were only too expensive to write down one at a time.

    So the mark runs four times a second and the scores collect; every few
    seconds the run goes on-chain in one updateLivePnLBatch. Sixteen points for
    the cost of one transaction, and the whole shape ends up in the event log,
    so the race can be rebuilt from the chain rather than from whatever a server
    chose to stream. The marks also go out on the feed, which is what moves the
    line between batches.

    Publishing is separate from deciding now. The trading loop below runs at its
    own pace and no longer writes.
  */
  const stopPrices = startLivePrices();
  const buffer: { bps: number; at: number }[] = [];

  const marker = setInterval(() => {
    const prices = currentPrices();
    if (!prices) return;
    const bps = scoreBps(getPnLBps(state.portfolio, prices));
    buffer.push({ bps, at: Date.now() });
    emit("mark", { side: "A", pnlBps: bps });
  }, 250);

  /** Points per transaction. Matches DuelManager.MAX_BATCH. */
  const MAX_BATCH = 64;

  const flush = async () => {
    if (buffer.length === 0 || Date.now() >= endMs) return;

    // Keep the newest if the run overflows: the last value is the score, and an
    // older point that missed its batch is a frame, not a result.
    const run = buffer.splice(0, buffer.length).slice(-MAX_BATCH);
    const sentAt = Date.now();
    const values = run.map((p) => BigInt(p.bps));
    const ages = run.map((p) => Math.max(0, Math.min(0xffffffff, sentAt - p.at)));

    try {
      const tx = await dm.updateLivePnLBatch(duelId, values, ages, { gasLimit: 900_000n });
      lastReportedPnlBps = run[run.length - 1].bps;
      emit("pnl", { pnlBps: lastReportedPnlBps, points: run.length, txHash: tx.hash });
      tx.wait().catch((e: any) => {
        if (Date.now() < endMs) {
          emit("error", { message: `Batch did not land: ${e.message?.slice(0, 80)}` });
        }
      });
    } catch (e: any) {
      if (Date.now() < endMs) {
        emit("error", { message: `Batch submit failed: ${e.message?.slice(0, 80)}` });
      }
    }
  };

  const flusher = setInterval(() => void flush(), 4_000);

  const stopMarking = () => {
    clearInterval(marker);
    clearInterval(flusher);
    stopPrices();
  };

  // Start warm, the way the house bots do.
  //
  // A two-minute duel is eight ticks. A strategy that reads five minutes of
  // movement has nothing to read until the duel is nearly over, so it holds
  // through the part that decides it — while its opponent, warmed up since its
  // first tick, is already trading. That is not a slow strategy losing, it is a
  // strategy that never got to run.
  const warm = await fetchPriceHistory(8);
  state.priceHistory = warm.history.map(({ timestamp, ...prices }) => prices as Prices);
  emit("info", {
    message: warm.history.length
      ? `Warmed up on ${warm.history.length} recent prices`
      : `Starting cold — ${warm.error ?? "no price history available"}`,
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
    stopMarking();

    /*
      Pin to what the chain recorded, not to what we last sent.

      submitFinalPnL compares the ciphertext in-circuit against the participant's
      own last public report, so settling on a value the chain never took reverts
      and the agent forfeits. Now that updates are sent without waiting, the last
      one can still be in flight — or dropped — when the clock stops. Reading it
      back is the only thing that is true.
    */
    let onChain: number | null = null;
    try {
      const d = await dm.getDuel(duelId);
      const me = wallet.address.toLowerCase();

      // Which side this agent reports for. It is a participant when the duel was
      // created from its own key, and a named delegate when it plays for someone
      // else's wallet — which is the ordinary case.
      let principal = me;
      if (String(d[0]).toLowerCase() !== me && String(d[1]).toLowerCase() !== me) {
        principal = String(await dm.settlementDelegate(duelId, wallet.address)).toLowerCase();
      }

      const isA = String(d[0]).toLowerCase() === principal;
      if (d[isA ? 7 : 8]) {
        const live = await dm.getLivePnL(duelId);
        onChain = Number(isA ? live[0] : live[1]);
      }
    } catch { /* fall through to the local value */ }

    const pnl = onChain ?? lastReportedPnlBps;
    if (pnl === null) {
      emit("info", { message: "Nothing was reported on-chain — no score to settle" });
      return;
    }
    if (onChain !== null && onChain !== lastReportedPnlBps) {
      emit("info", {
        message: `Last update did not land; settling on the chain's ${(onChain / 100).toFixed(2)}%`,
      });
    }

    try {
      const cotiSigner = await cotiWallet(key, provider, process.env.AES_KEY);
      const hash = await submitFinalPnL(
        cotiSigner, process.env.DUEL_MANAGER_ADDRESS!, duelId, pnl
      );
      emit("info", {
        message: `Settled with encrypted score ${(pnl / 100).toFixed(2)}% — ${hash.slice(0, 10)}…`,
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

      // Scored on a notional position — see notional.ts. The house bot applies
      // the same multiplier, so this decides nothing about who wins; it decides
      // whether the margin is visible while the duel is still running.
      const reportBps = scoreBps(decision.pnlBps);

      emit("trade", {
        tradeLog: decision.tradeLog,
        reasoning: decision.reasoning,
        pnlBps: reportBps,
        prices,
      });

      // Nothing goes on-chain here. The marker samples the score four times a
      // second and the flusher publishes the run; a decision that changes the
      // portfolio shows up in the very next mark.
    } catch (e: any) {
      emit("error", { message: e.message?.slice(0, 100) });
    }

    // Schedule next tick if still time
    const d2 = await dm.getDuel(duelId).catch(() => null);
    const timeLeft = d2 ? Number(d2.endTime) * 1000 - Date.now() : 0;
    if (d2 && Number(d2.state) === 1 && timeLeft > 5_000) {
      const delay = Math.min(tickMs, timeLeft - 3_000);
      setTimeout(loop, Math.max(1_500, delay));
    } else {
      await settle();
      emit("end", { message: "Duel complete" });
    }
  };

  // First tick after 2s
  setTimeout(loop, 2_000);
}
