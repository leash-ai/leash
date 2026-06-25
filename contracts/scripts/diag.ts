import {ethers} from 'ethers';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config();

const provider = new ethers.JsonRpcProvider('https://testnet.coti.io/rpc');
const DM_ADDR  = process.env.DUEL_MANAGER_ADDRESS!;
const MKT_ADDR = process.env.AGENT_MARKETPLACE_ADDRESS!;
const art      = JSON.parse(fs.readFileSync(path.join(__dirname, '../artifacts/contracts/TestDuelManager.sol/TestDuelManager.json'), 'utf8'));
const dm       = new ethers.Contract(DM_ADDR, art.abi, provider);
const OWNER    = '0xDcd3ce823c9cB3847D57660301e373612524876C';

async function main() {
  const count = await dm.duelCount();
  console.log('duelCount:', count.toString());
  console.log('owner:', OWNER);
  console.log('marketplace:', MKT_ADDR);

  for (let id = 1; id <= Number(count); id++) {
    try {
      const d = await dm.getDuel(id);
      const state = ['Open', 'Active', 'Resolved'][Number(d[5])];
      const isOwnerAgentB = (d[1] as string).toLowerCase() === OWNER.toLowerCase();
      console.log(`\nduel ${id} [${state}]:`);
      console.log('  agentA (marketplace?):', d[0], d[0].toLowerCase() === MKT_ADDR.toLowerCase() ? '✅mkt' : '❌');
      console.log('  agentB (owner?):', d[1], isOwnerAgentB ? '✅owner' : '');
      console.log('  stake:', ethers.formatEther(d[2] as bigint));
      console.log('  aSubmitted:', d[7], ' bSubmitted:', d[8]);
    } catch(e: any) {
      console.log(`duel ${id}: error -`, (e as Error).message?.slice(0,80));
    }
  }

  // Also test: can owner call updateLivePnL on a specific duel?
  const ownerWallet = new ethers.Wallet(process.env.SIGNING_KEYS!.split(',')[0], provider);
  const dmSigned = dm.connect(ownerWallet) as typeof dm;

  // Find the most recent Active duel
  for (let id = Number(count); id >= 1; id--) {
    try {
      const d = await dm.getDuel(id);
      if (Number(d[5]) === 1) { // Active
        console.log(`\nTrying estimateGas on updateLivePnL(${id}, 99)...`);
        try {
          const gas = await dmSigned.updateLivePnL.estimateGas(id, 99);
          console.log('Gas estimate:', gas.toString(), '✅ call would succeed');
        } catch(e2: any) {
          console.log('estimateGas failed:', (e2 as Error).message?.slice(0, 150));
        }
        break;
      }
    } catch {}
  }
}
main().catch(console.error);
