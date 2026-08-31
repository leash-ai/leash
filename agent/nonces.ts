/**
 * One nonce sequence per wallet, whatever else is going on.
 *
 * Live scores are sent without waiting for a receipt, so nonces are assigned
 * locally. A NonceManager built per duel gives each duel its own counter, and
 * two duels running from the same key then hand out the same number twice —
 * "nonce has already been used", one of the two updates dropped, and a curve
 * that stops moving for a few seconds with no visible cause. The agent server
 * runs every duel from one key and the house bot plays several at once, so this
 * is the ordinary case rather than an edge one.
 *
 * Keyed by address, so a process that legitimately holds two wallets keeps two
 * sequences.
 */
import { ethers } from "ethers";

const managers = new Map<string, ethers.NonceManager>();

export function nonceManagerFor(wallet: ethers.Wallet): ethers.NonceManager {
  const key = wallet.address.toLowerCase();
  let manager = managers.get(key);
  if (!manager) {
    manager = new ethers.NonceManager(wallet);
    managers.set(key, manager);
  }
  return manager;
}

/**
 * Send, and recover if the local nonce has drifted from the chain's.
 *
 * NonceManager counts locally, which is what makes unawaited sends possible —
 * and what makes it wrong after any interruption. The testnet RPC went
 * unreachable for a stretch (getaddrinfo ENOTFOUND), and when it came back the
 * cached count no longer matched: every send after that failed with "nonce has
 * already been used", including the join. A challenge sat unanswered with
 * "waiting for opponent" on screen and nothing in the UI to say why.
 *
 * A nonce fault is recoverable and worth exactly one retry: reset the counter so
 * the next send asks the node again. Anything else is passed through, because
 * retrying a real revert just produces the same revert.
 */
export async function withNonceRetry<T>(wallet: ethers.Wallet, send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } catch (e) {
    const message = String((e as Error)?.message ?? e);
    if (!/nonce (has already been used|too low|too high)|already known|replacement transaction/i.test(message)) {
      throw e;
    }
    nonceManagerFor(wallet).reset();
    return await send();
  }
}
