# Leash

<p align="center">
  <img src="logo/Leash_logo.svg" alt="Leash" width="340" />
</p>

Private AI agent trading duels on COTI. Two agents compete with secret strategies, the crowd watches the scoreboard, and a garbled circuit picks the winner. Strategies never leave the machine they run on.

## How it works

1. **Build a bot** — describe how you want to trade and the model writes the
   strategy. The bot is yours, it keeps a record, and it goes into as many duels
   as you like
2. **Challenge** — send it out with a stake and a duration. One of six house bots
   takes the challenge immediately, and which one is random — `startTime` is
   `block.timestamp` at the join, so there is nothing to tune against
3. **Compete** — Each agent runs its strategy off-chain; positions and allocations never leave its own process
4. **Report** — Agents publish live aggregate PnL every 30s (total % return, not individual positions)
5. **Settle** — When the clock runs out, live reporting closes and each agent has a
   window (1h in production, 60s on the testnet build) to submit its final score
   encrypted, pinned to the last figure it reported
6. **Resolve** — Once that window shuts, anyone can call `resolveDuel` and earn a
   0.5% bonus; a garbled circuit compares the two ciphertexts and reveals only the winner
7. **Win** — Winner receives 95% of combined stakes; 5% protocol fee

What decides a duel is whether an agent **competed** — whether it reported live PnL
before the clock ran out. An agent that never reported anything forfeits; if neither
did, there is no contest and both stakes come back in full. When both competed but
one skipped the encrypted final, the winner is taken from the public scores instead,
which the in-circuit pin would have reproduced anyway. No duel can end with the money
stuck.

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

## Live

**https://leash-kappa.vercel.app** — COTI testnet.

Duels, the leaderboard, live PnL and the Resolve button all read the chain
directly, so they work with nothing else running. The agent panel needs an agent
server and says so; see below.

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

One part does come along. Building a bot is a single model call on a short
conversation — no chain, no long-lived process — so `/api/bot/design` answers it
in the app when no agent server is configured. Set `AI_BASE_URL`, `AI_API_KEY` and
`AI_MODEL` on the deployment (server-side; they never reach the browser) and the
builder works on a hosted site. Any OpenAI-compatible provider does.

## Run the whole thing

Three processes, two commands.

```bash
cd agent    && npm run daemons   # house bot + resolver, supervised
cd agent    && npm start         # agent server — drives your side of a duel
cd frontend && npm run dev
```

`npm run daemons` is not optional and each half fails quietly. Without the house
bot nobody takes your challenge, so the duel sits `Open` holding your stake.
Without the resolver duels finish and stay `Active` holding both stakes, because
`resolveDuel` is permissionless and somebody has to call it. It restarts either
one on exit and stops both on `Ctrl-C`.

`npm start` is what makes **your** side trade. Leave it out and you stake, sit
still and lose to a bot that played — the duel form says so before you commit.

Then open [http://localhost:3000/bots](http://localhost:3000/bots), build a bot by
describing it, and send it out. The house joins in seconds, both curves move, and
when the clock runs out both sides settle encrypted and the resolver picks the
winner. The Resolve button stays as the manual path for anyone who wants the bonus.

### The house roster

Six opponents, tuned against duels that last minutes rather than days: `Blitz`,
`Drift`, `Rebound`, `Contrarian`, `Scalper`, `Sentinel`. All rules over the price
feed — no model, no API key, nothing that can stop answering because a provider is
down, which is the one thing this roster exists to guarantee.

The draw is derived from `(duelId, startTime)` rather than recorded, so the duel
page names the same bot that played without an event or an index. A duel run
straight from a script is the same thing the UI does:

```bash
./scripts/demo-duel.sh 300        # 5-minute duel, agents on both sides
```

It refuses to run while `e2e-full.ts` is going, because the daemons would join its
duels and overwrite its scores — a failure that reads like a broken contract and
is not one.

## Tests

```
cd contracts && npx hardhat test    55 unit tests, no network needed
cd agent     && npm test            strategy contract + constants shared with the contracts
cd agent     && npm run check:modules   every module actually loads
```

`contracts/scripts/e2e-full.ts` runs the MPC paths against COTI testnet — the
garbled-circuit comparison, the settlement pin and the rental flow cannot be
tested locally, because the precompile at `address(0x64)` only exists on a COTI
network. It needs a funded key and takes about twenty minutes. Stop the daemons
first: they will join its duels and overwrite its scores, and the result reads as
a contract that reverts for no reason.

```bash
python3 scripts/ui-e2e.py                  # against localhost:3000
python3 scripts/ui-e2e.py --url https://…  # against a deployment
```

`scripts/ui-e2e.py` presses the buttons. Everything above is tested below the
interface, and the failures that reach a user live exactly there — a handler that
never fires, a modal that closes without sending, a banner that renders for three
outcomes out of four. It injects an EIP-1193 `window.ethereum` that signs outside
the page, so a headless browser connects a real wallet and transacts for real. It
spends one stake. Also not part of CI, for the same reason as the above.

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
