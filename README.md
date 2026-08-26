# Leash

<p align="center">
  <img src="logo/Leash_logo.svg" alt="Leash" width="340" />
</p>

Private AI agent trading duels on COTI. Two agents compete with secret strategies, the crowd watches the scoreboard, and a garbled circuit picks the winner. Strategies never leave the machine they run on.

## How it works

1. **Challenge** — Agent A creates a duel, stakes COTI, sets duration
2. **Join** — Agent B matches the stake to start the competition
3. **Compete** — Each agent runs its strategy off-chain; positions and allocations never leave its own process
4. **Report** — Agents publish live aggregate PnL every 30s (total % return, not individual positions)
5. **Settle** — When the clock runs out, live reporting closes and each agent has a
   window (1h in production, 60s on the testnet build) to submit its final score
   encrypted, pinned to the last figure it reported
6. **Resolve** — Once that window shuts, anyone can call `resolveDuel` and earn a
   0.5% bonus; a garbled circuit compares the two ciphertexts and reveals only the winner
7. **Win** — Winner receives 95% of combined stakes; 5% protocol fee

An agent that never settles forfeits. If neither settles there is no contest and both
stakes are refunded in full — no duel can end with the money stuck.

## Privacy architecture

What is private here is the **strategy**, not the scoreboard. Being precise about
which is which is the whole point:

- **Strategy — private.** Trade positions, asset allocations and strategy logic run
  off-chain in the agent's own process and never touch the blockchain. Nothing to
  decrypt, because nothing was ever published.
- **Aggregate PnL — public, deliberately.** Agents self-report a single total return
  figure, and `getLivePnL` returns it in plaintext. That is the spectator feed: you
  can watch a duel swing in real time. It is verifiable against public prices, and
  it reveals no individual position.
- **Settlement — computed under encryption.** Each agent submits its final score as
  a ciphertext and `MpcCore.gt()` decides the winner inside a garbled circuit,
  without decrypting either operand.

Full write-up, including the alternative design and why it was not taken:
[docs/privacy-model.md](docs/privacy-model.md).

One honest caveat, because the code makes it plain: a final submission is pinned
in-circuit to that agent's own last public report (`MpcCore.eq`), so nobody can
settle on a number they never reported. That pin is what keeps the public feed from
being gamed through the encrypted door — and it also means the two scores being
compared are values the chain already published. Settlement is confidential in
mechanism; the scores themselves are not secret. The privacy that matters for a
trading competition is the strategy, and that one is real.

## Project structure

```
contracts/   Hardhat project
  DuelManager        duels, encrypted settlement, forfeit / no-contest
  AgentRegistry      agent NFTs with MPC-encrypted ownership
  AgentMarketplace   rent an agent, split the winnings
  PrivateTestUSDC    testnet stand-in for p.USDC.e
  TestDuelManager    testnet build — relaxes timing only, real MPC
  LocalDuelManager   Hardhat-only — plaintext stand-ins, never deployed
agent/       TypeScript agent — momentum, mean-reversion and market-maker
frontend/    Next.js frontend — create/join/watch duels, leaderboard
docs/        privacy model and design decisions
```

Every contract above is deployed and exercised by `contracts/scripts/e2e-full.ts`
on testnet, except `LocalDuelManager`, which exists so the unit tests can run
without the MPC precompile.

## Deploying

The frontend is a Next.js app and deploys anywhere static-plus-SSR runs, Vercel
included. It reads the chain directly, so duels, the leaderboard, live PnL and
the Resolve button all work with nothing else running.

The agent side does not go with it. `agent/src/server.ts` holds WebSocket
connections and `rentalListener` / `renterListener` loop for the length of a
duel — none of that fits a serverless function. Run them on a host that keeps a
process alive and point the frontend at the server:

```
NEXT_PUBLIC_AGENT_URL=https://your-agent-host
```

Leave it unset and the duel page says so in place of the agent panel rather than
reaching for `localhost:3001` in each visitor's browser.

## Watch a duel

```bash
./scripts/demo-duel.sh            # 15-minute duel
./scripts/demo-duel.sh 300        # 5-minute duel
```

Starts both agent daemons — one on momentum, the other on mean-reversion — rents
an agent and puts a real duel on testnet. It prints the URL to watch and the
command to stop the agents. Use different strategies on each side: two identical
ones see the same prices, report the same score and tie, and a tie goes to agentB
by rule.

The script refuses to run while `e2e-full.ts` is going, because the daemons would
join its duels and overwrite its scores — a failure that reads like a broken
contract and is not one.

Once the clock runs out both agents settle their final score encrypted, and 60
seconds later the duel page offers a Resolve button. Anyone can press it, and
whoever does earns the resolver bonus.

## Tests

```
cd contracts && npx hardhat test    55 unit tests, no network needed
cd agent     && npm test            strategy contract + constants shared with the contracts
cd agent     && npm run check:modules   every module actually loads
```

`contracts/scripts/e2e-full.ts` runs the MPC paths against COTI testnet — the
garbled-circuit comparison, the settlement pin and the rental flow cannot be
tested locally, because the precompile at `address(0x64)` only exists on a COTI
network. It needs a funded key and takes about twenty minutes.

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
