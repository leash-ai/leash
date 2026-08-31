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
