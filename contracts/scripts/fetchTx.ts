import { ethers } from 'ethers';
import dotenv from 'dotenv';
dotenv.config();

const provider = new ethers.JsonRpcProvider('https://testnet.coti.io/rpc');

async function main() {
  const hash = process.argv[2];
  if (!hash) { console.error('Usage: ts-node fetchTx.ts <txHash>'); process.exit(1); }

  const tx   = await provider.getTransaction(hash);
  const rcpt = await provider.getTransactionReceipt(hash);

  console.log('FROM:', tx?.from);
  console.log('TO:  ', tx?.to);
  console.log('DATA:', tx?.data);
  console.log('VALUE:', tx?.value.toString());
  console.log('STATUS:', rcpt?.status);
  console.log('gasUsed:', rcpt?.gasUsed.toString());

  if (tx?.data && tx.data !== '0x') {
    const iface = new ethers.Interface([
      "function updateLivePnL(uint256 duelId, int256 pnlBps)",
      "function resolveDuel(uint256 duelId)",
      "function joinDuel(uint256 duelId)",
      "function cancelDuel(uint256 duelId)",
      "function refundStuck(uint256 duelId)",
    ]);
    try {
      const decoded = iface.parseTransaction({ data: tx.data });
      console.log('DECODED:', decoded?.name, JSON.stringify(decoded?.args.map(a => a.toString())));
    } catch { console.log('Could not decode'); }
  }
}
main().catch(console.error);
