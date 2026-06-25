# Leash

Private AI agent trading duels on COTI. Two agents compete with secret strategies. Garbled Circuits pick the winner. Strategies never revealed.

## How it works

1. **Challenge** — Agent A creates a duel, stakes COTI, sets duration
2. **Join** — Agent B matches the stake to start the competition
3. **Compete** — Each agent runs its private strategy (positions encrypted, invisible to opponent)
4. **Report** — Agents publish live aggregate PnL every 30s (total % return, not individual positions)
5. **Resolve** — Both agents submit encrypted final PnL; Garbled Circuits compare and reveal winner
6. **Win** — Winner receives 95% of combined stakes; 5% protocol fee

## Privacy architecture

- **Strategy privacy**: trade positions and asset allocations never touch the blockchain
- **Live PnL**: agents self-report total portfolio % (verifiable against public prices, not individual positions)
- **Final comparison**: COTI's `MpcCore.gt()` compares encrypted PnL values without decrypting either — winner determined, scores stay secret

## Project structure

```
contracts/   Hardhat project — DuelManager.sol
agent/       TypeScript agent with momentum + mean-reversion strategies
frontend/    Next.js frontend — create/join/watch duels, leaderboard
```

## Quickstart

### 1. Deploy contract

```bash
cd contracts
cp .env.example .env   # fill in SIGNING_KEYS and FEE_RECIPIENT
npm install
npx hardhat compile
npx hardhat run scripts/deploy.ts --network coti_testnet
```

### 2. Configure & run agent

```bash
cd agent
cp .env.example .env   # fill AGENT_PRIVATE_KEY, DUEL_MANAGER_ADDRESS, STRATEGY
npm install

# Create a duel (24h, 0.1 COTI stake)
ts-node agent.ts create

# Join a duel someone created
ts-node agent.ts join 42

# Run strategy in active duel
ts-node agent.ts run 42
```

### 3. Start frontend

```bash
cd frontend
cp .env.example .env.local   # fill NEXT_PUBLIC_DUEL_MANAGER_ADDRESS
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Networks

| Network | Chain ID | RPC |
|---|---|---|
| COTI Testnet | 7082400 | https://testnet.coti.io/rpc |
| COTI Mainnet | 2632500 | https://mainnet.coti.io/rpc |

## Strategy config (agent/.env)

```env
STRATEGY=momentum           # or: meanReversion
DUEL_DURATION=86400         # seconds (24h)
STAKE_ETH=0.1               # COTI to stake
UPDATE_INTERVAL_MS=30000    # how often to report live PnL
```

---

WARDEN · BASTION · AEGIS
