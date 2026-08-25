/**
 * Encrypted settlement — the client half of DuelManager's garbled-circuit
 * comparison.
 *
 * Replaces the placeholder that used to live in agent.ts, which returned a
 * keccak hash of the value and a personal_sign over it. That is not a COTI
 * ciphertext and MpcCore.validateCiphertext would have rejected it; the code
 * path had simply never run against a deployed contract.
 *
 * The real thing needs an AES key derived from the agent's own private key via
 * COTI's AccountOnboard contract, exactly as messaging/setup.ts already does for
 * private messaging. Wallet.encryptValue then binds the ciphertext to (signer,
 * contract, function selector), so a submission cannot be replayed against a
 * different contract or function.
 */
import { Wallet as CotiWallet } from "@coti-io/coti-ethers";
import { Interface, JsonRpcProvider, Contract } from "ethers";

/** COTI testnet AccountOnboard — same address messaging/setup.ts onboards against. */
export const ONBOARD_CONTRACT = "0x536A67f0cc46513E7d27a370ed1aF9FDcC7A5095";

/** Must match DuelManager.PNL_OFFSET. Garbled ints are unsigned. */
export const PNL_OFFSET = 100_000_000;

const DUEL_MANAGER_IFACE = new Interface([
  "function submitFinalPnL(uint256 duelId, (uint256 ciphertext, bytes signature) encryptedPnL)",
]);

/**
 * Selector derived from the fragment rather than hardcoded, so it cannot drift
 * from the contract. Currently 0xc470c0ec for
 * submitFinalPnL(uint256,(uint256,bytes)).
 */
const SUBMIT_FINAL_SELECTOR = DUEL_MANAGER_IFACE.getFunction("submitFinalPnL")!.selector;

/**
 * A COTI wallet with an AES key ready for encryptValue().
 *
 * Pass aesKey when it is already in the environment (AES_KEY, written by
 * messaging/setup.ts) to skip the onboarding round-trip. Otherwise the key is
 * derived from the private key, which is deterministic — running it twice gives
 * the same key back.
 */
export async function cotiWallet(
  privateKey: string,
  provider: JsonRpcProvider,
  aesKey?: string
): Promise<CotiWallet> {
  const wallet = new CotiWallet(privateKey, provider);

  if (aesKey) {
    wallet.setAesKey(aesKey);
    return wallet;
  }

  await wallet.generateOrRecoverAes(ONBOARD_CONTRACT);
  if (!wallet.getUserOnboardInfo()?.aesKey) {
    throw new Error(
      "Could not derive an AES key. Run `ts-node messaging/setup.ts agent` and set AES_KEY."
    );
  }
  return wallet;
}

/**
 * Encrypt a final score for DuelManager.
 *
 * @param publicPnlBps the last value this agent reported with updateLivePnL.
 *        DuelManager pins the encrypted score to that value in-circuit, so
 *        anything else is rejected — this must be the number actually reported,
 *        not a freshly recomputed one.
 */
export async function encryptFinalPnL(
  wallet: CotiWallet,
  duelManagerAddress: string,
  publicPnlBps: number
): Promise<{ ciphertext: bigint; signature: Uint8Array | string }> {
  const encoded = BigInt(publicPnlBps + PNL_OFFSET);
  if (encoded < 0n) throw new Error(`PnL ${publicPnlBps}bps underflows PNL_OFFSET`);

  const it = await wallet.encryptValue(encoded, duelManagerAddress, SUBMIT_FINAL_SELECTOR);
  // encryptValue is typed itUint | itString; a numeric input always yields itUint.
  return it as { ciphertext: bigint; signature: Uint8Array | string };
}

/**
 * Encrypt and submit in one step. Returns the transaction hash.
 *
 * `submitVia` lets a renter settle through AgentMarketplace, which is agentA in
 * a rented duel and proxies the call.
 */
export async function submitFinalPnL(
  wallet: CotiWallet,
  duelManagerAddress: string,
  duelId: number | bigint,
  publicPnlBps: number,
  submitVia?: { address: string; abi: string[]; method: string; id: number | bigint }
): Promise<string> {
  const encrypted = await encryptFinalPnL(wallet, duelManagerAddress, publicPnlBps);

  const target = submitVia
    ? new Contract(submitVia.address, submitVia.abi, wallet)
    : new Contract(duelManagerAddress, DUEL_MANAGER_IFACE.fragments as any, wallet);

  const method = submitVia ? submitVia.method : "submitFinalPnL";
  const id = submitVia ? submitVia.id : duelId;

  const tx = await target[method](id, encrypted, { gasLimit: 3_000_000n });
  await tx.wait();
  return tx.hash;
}
