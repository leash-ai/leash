# Privacy model — what Leash actually hides

Recorded 2026-08-25. This exists because the code and the pitch had drifted apart,
and because the trade-off underneath is a real design decision rather than an
oversight. If you are reviewing the contracts, read this first.

## The short version

| | Visible to | Why |
|---|---|---|
| Strategy logic, positions, allocations | nobody but the agent's operator | runs off-chain, never published |
| Aggregate PnL during a duel | everyone | it is the spectator feed |
| Final scores at settlement | everyone (see below) | pinned to the public feed |
| The comparison that picks a winner | computed under encryption | `MpcCore.gt` on two ciphertexts |

**The strategy is private. The scoreboard is public. Settlement is confidential in
mechanism but not in content.** That last line is the one worth being precise
about.

## Why the scores are not secret

`submitFinalPnL` pins each encrypted score to that agent's own last public report:

```solidity
uint64 expected = uint64(uint256(livePnl + PNL_OFFSET));
require(MpcCore.decrypt(MpcCore.eq(gtPnL, expected)), "Final PnL must match last live PnL");
```

`livePnl` is `duel.agentAPnL` — plaintext in this contract's storage, readable by
anyone through `getLivePnL`. So by the time `_comparePnL` runs, both operands are
values the chain already published. The garbled circuit is comparing two numbers
everybody can read.

`MpcCore.gt` genuinely never decrypts its operands. That is a true statement about
the mechanism and a misleading one about the outcome, which is why the README no
longer makes it without qualification.

## Why the pin is there anyway

Remove it and the situation is worse, not better. The live feed is public, so an
agent can read its opponent's last score. Without the pin it could then encrypt
that value plus one basis point and settle on a number it never reported — the
same cheat an `endTime` bound closes for the plaintext feed, except now hidden
inside a ciphertext. The pin is what keeps a public feed and a private settlement
from combining into something weaker than either.

Scenario N of `contracts/scripts/e2e-full.ts` is the guard: an agent tries to
settle on 900bps having only reported 100bps, and the submission must revert. If
N1 ever reports `ACCEPTED`, this whole model is broken.

## The decision

**Keep the public live feed.** Watching a duel swing in real time is the product;
score secrecy is a property nobody can observe. Trading the visible thing for the
invisible one is the wrong way round for this application.

The honest framing — *your strategy never leaves your machine, and the settlement
runs through a garbled circuit* — is a real claim about a real mechanism. It is
narrower than "scores stay secret", and it has the advantage of being true.

## The alternative, if the priority ever changes

Commit–reveal removes the need for the pin and gives genuine score privacy:

1. During the duel each agent posts `keccak256(finalScore, salt)` — a commitment,
   not a score.
2. At settlement it submits the score encrypted, and the contract checks it
   against the commitment.
3. Nothing about the score is ever public, and an agent still cannot copy its
   opponent, because it committed before seeing anything.

The live feed then either disappears or degrades to something coarse — a rank, a
delayed value, a direction — and the spectator experience goes with it.

This was not taken now for reasons of sequencing rather than design: it is a
substantial change to the settlement path, it invalidates the current e2e
coverage, and it would land immediately before a submission deadline on a
codebase where every path currently passes. It is the right next step if score
confidentiality ever outranks the live feed.

## What is verified

`MpcCore.gt` settlement, the pin, and the forfeit and no-contest paths all run
against COTI testnet in `contracts/scripts/e2e-full.ts`, scenarios M, N and O.
None of them can run locally — the precompile at `address(0x64)` only exists on a
COTI network.
