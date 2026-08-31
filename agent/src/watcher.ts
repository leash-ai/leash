/**
 * Start the duels this agent was named on, without being asked.
 *
 * The duel form calls /agent/duel/:id/start after createDuelWithAgent, and that
 * call is fire-and-forget: if this server happened to be restarting, or the
 * request was dropped, nobody noticed. The duel ran to the end with one side
 * reporting nothing, the page said "never reported", and the user lost a stake
 * to a bot they never got to race. That happened on duel #8.
 *
 * The authorisation is on-chain, so it does not need to be told. createDuelWithAgent
 * records this address as the duel's agent, so watching for that is enough to
 * find every duel it is supposed to play — whether or not the HTTP call landed.
 *
 * A duel already running is left alone; the server's own map is the guard, so a
 * start that did arrive keeps its strategy.
 */
import { ethers } from "ethers";

const ABI = [
  "function duelCount() view returns (uint256)",
  "function getDuel(uint256) view returns (address agentA, address agentB, uint256 stake, uint256 startTime, uint256 endTime, uint8 state, address winner, bool agentASubmitted, bool agentBSubmitted, uint256 createdAt)",
  "function settlementDelegate(uint256 duelId, address delegate) view returns (address)",
];

const POLL_MS = 2_000;

/** Duels seen since this process started, so a finished one is not retried. */
const handled = new Set<number>();

export function watchForOwnDuels(
  onDuel: (duelId: number) => void,
  isRunning: (duelId: number) => boolean,
) {
  const rpc = process.env.COTI_RPC || "https://testnet.coti.io/rpc";
  const address = process.env.DUEL_MANAGER_ADDRESS;
  const key = process.env.AGENT_PRIVATE_KEY;
  if (!address || !key) return;

  const me = new ethers.Wallet(key).address;
  const provider = new ethers.JsonRpcProvider(rpc);
  const duels = new ethers.Contract(address, ABI, provider);

  // Only duels created from here on. Sweeping history would restart agents for
  // duels that already ended, and there is nothing to gain from replaying them.
  let floor = 0;

  const scan = async () => {
    try {
      const count = Number(await duels.duelCount());
      if (floor === 0) { floor = count; return; }

      for (let id = floor + 1; id <= count; id++) {
        if (handled.has(id) || isRunning(id)) continue;

        const duel = await duels.getDuel(id);
        if (Number(duel[5]) !== 1) continue;                      // not yet joined
        if (Date.now() >= Number(duel[4]) * 1000) { handled.add(id); continue; }

        const named = String(await duels.settlementDelegate(id, me)).toLowerCase();
        const isMine =
          named !== ethers.ZeroAddress.toLowerCase() ||
          String(duel[0]).toLowerCase() === me.toLowerCase();
        if (!isMine) continue;

        handled.add(id);
        console.log(`[watch] duel ${id} names this agent — starting it`);
        onDuel(id);
      }
      floor = Math.max(floor, count - 1);
    } catch { /* a missed scan is picked up by the next one */ }
  };

  void scan();
  setInterval(() => void scan(), POLL_MS);
}
