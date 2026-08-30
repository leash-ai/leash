import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { DuelManager, LocalDuelManager } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * DuelManager tests — runs on local Hardhat network.
 * DuelManager holds no MPC calls, so all of it is unit-testable here. Contracts
 * that do (AgentRegistry, AgentMarketplace) need the
 * COTI precompile and are covered by the scripts/e2e-*.ts testnet suites.
 */
describe("DuelManager", function () {
  let duelManager: DuelManager;
  let deployer: HardhatEthersSigner;
  let agentA: HardhatEthersSigner;
  let agentB: HardhatEthersSigner;
  let agentC: HardhatEthersSigner;
  let feeRecipient: HardhatEthersSigner;

  const STAKE = ethers.parseEther("0.1");
  const DURATION_1H = 3600;
  const DURATION_7D = 7 * 24 * 3600;

  beforeEach(async () => {
    [deployer, agentA, agentB, agentC, feeRecipient] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("DuelManager");
    duelManager = await Factory.deploy(feeRecipient.address);
    await duelManager.waitForDeployment();
  });

  // ─── createDuel ────────────────────────────────────────────────────────────

  describe("createDuel", () => {
    it("creates duel with correct initial state", async () => {
      await duelManager.connect(agentA).createDuel(DURATION_1H, { value: STAKE });

      const d = await duelManager.getDuel(1);
      expect(d[0]).to.equal(agentA.address); // agentA
      expect(d[1]).to.equal(ethers.ZeroAddress); // agentB not yet
      expect(d[2]).to.equal(STAKE); // stake
      expect(d[5]).to.equal(0); // state = Open
    });

    it("increments duelCount", async () => {
      await duelManager.connect(agentA).createDuel(DURATION_1H, { value: STAKE });
      await duelManager.connect(agentB).createDuel(DURATION_1H, { value: STAKE });
      expect(await duelManager.duelCount()).to.equal(2);
    });

    it("emits DuelCreated event", async () => {
      await expect(
        duelManager.connect(agentA).createDuel(DURATION_1H, { value: STAKE })
      ).to.emit(duelManager, "DuelCreated")
        .withArgs(1, agentA.address, STAKE, DURATION_1H);
    });

    it("reverts with zero stake", async () => {
      await expect(
        duelManager.connect(agentA).createDuel(DURATION_1H, { value: 0 })
      ).to.be.revertedWith("Stake required");
    });

    it("reverts if duration < 1 minute", async () => {
      await expect(
        duelManager.connect(agentA).createDuel(59, { value: STAKE })
      ).to.be.revertedWith("Invalid duration");
    });

    it("reverts if duration > 7d", async () => {
      await expect(
        duelManager.connect(agentA).createDuel(DURATION_7D + 1, { value: STAKE })
      ).to.be.revertedWith("Invalid duration");
    });

    it("accepts max duration exactly (7 days)", async () => {
      await expect(
        duelManager.connect(agentA).createDuel(DURATION_7D, { value: STAKE })
      ).to.not.be.reverted;
    });
  });

  // ─── joinDuel ──────────────────────────────────────────────────────────────

  describe("joinDuel", () => {
    beforeEach(async () => {
      await duelManager.connect(agentA).createDuel(DURATION_1H, { value: STAKE });
    });

    it("agent B joins and duel becomes active", async () => {
      await duelManager.connect(agentB).joinDuel(1, { value: STAKE });

      const d = await duelManager.getDuel(1);
      expect(d[1]).to.equal(agentB.address);
      expect(d[5]).to.equal(1); // Active
    });

    it("startTime and endTime are set on join", async () => {
      const before = (await ethers.provider.getBlock("latest"))!.timestamp;
      await duelManager.connect(agentB).joinDuel(1, { value: STAKE });

      const d = await duelManager.getDuel(1);
      const startTime = Number(d[3]);
      const endTime = Number(d[4]);

      expect(startTime).to.be.gte(before);
      expect(endTime).to.equal(startTime + DURATION_1H);
    });

    it("emits DuelJoined", async () => {
      await expect(
        duelManager.connect(agentB).joinDuel(1, { value: STAKE })
      ).to.emit(duelManager, "DuelJoined").withArgs(1, agentB.address);
    });

    it("reverts with wrong stake", async () => {
      await expect(
        duelManager.connect(agentB).joinDuel(1, { value: ethers.parseEther("0.05") })
      ).to.be.revertedWith("Wrong stake amount");
    });

    it("reverts if agent A tries to join own duel", async () => {
      await expect(
        duelManager.connect(agentA).joinDuel(1, { value: STAKE })
      ).to.be.revertedWith("Cannot duel yourself");
    });

    it("reverts if duel already has opponent", async () => {
      await duelManager.connect(agentB).joinDuel(1, { value: STAKE });
      await expect(
        duelManager.connect(agentC).joinDuel(1, { value: STAKE })
      ).to.be.revertedWith("Duel not open"); // state changes to Active once B joins
    });
  });

  // ─── updateLivePnL ─────────────────────────────────────────────────────────

  describe("updateLivePnL", () => {
    beforeEach(async () => {
      await duelManager.connect(agentA).createDuel(DURATION_1H, { value: STAKE });
      await duelManager.connect(agentB).joinDuel(1, { value: STAKE });
    });

    it("agents can report positive PnL", async () => {
      await duelManager.connect(agentA).updateLivePnL(1, 523);
      const pnl = await duelManager.getLivePnL(1);
      expect(pnl[0]).to.equal(523);
    });

    it("agents can report negative PnL", async () => {
      await duelManager.connect(agentB).updateLivePnL(1, -210);
      const pnl = await duelManager.getLivePnL(1);
      expect(pnl[1]).to.equal(-210);
    });

    it("later submissions overwrite earlier ones", async () => {
      await duelManager.connect(agentA).updateLivePnL(1, 100);
      await duelManager.connect(agentA).updateLivePnL(1, 250);

      const pnl = await duelManager.getLivePnL(1);
      expect(pnl[0]).to.equal(250);
    });

    it("emits LivePnLUpdated", async () => {
      await expect(
        duelManager.connect(agentA).updateLivePnL(1, 777)
      ).to.emit(duelManager, "LivePnLUpdated").withArgs(1, agentA.address, 777);
    });

    it("non-participant cannot update PnL", async () => {
      await expect(
        duelManager.connect(deployer).updateLivePnL(1, 100)
      ).to.be.revertedWith("Not a participant");
    });

    it("accepts a submission in the final second before expiry", async () => {
      await time.increase(DURATION_1H - 2);
      await expect(duelManager.connect(agentA).updateLivePnL(1, 42)).to.not.be.reverted;
    });

    it("rejects submissions once the duel has expired", async () => {
      await time.increase(DURATION_1H + 1);
      await expect(
        duelManager.connect(agentA).updateLivePnL(1, 100)
      ).to.be.revertedWith("Submissions closed");
    });

    it("a losing agent cannot overwrite its score after expiry to win", async () => {
      // Both agents report honestly during the duel: A +10%, B -5%.
      await duelManager.connect(agentA).updateLivePnL(1, 1000);
      await duelManager.connect(agentB).updateLivePnL(1, -500);
      await time.increase(DURATION_1H + 1);

      // Scores are public, so B can read A's and try to beat it after the fact.
      const [pnlA] = await duelManager.getLivePnL(1);
      await expect(
        duelManager.connect(agentB).updateLivePnL(1, pnlA + 1n)
      ).to.be.revertedWith("Submissions closed");

      // The scores that will be settled are still the honest ones.
      const [finalA, finalB] = await duelManager.getLivePnL(1);
      expect(finalA).to.equal(1000);
      expect(finalB).to.equal(-500);
    });

    it("rejects a PnL outside the encodable range", async () => {
      const min = await duelManager.PNL_MIN_BPS();
      await expect(
        duelManager.connect(agentA).updateLivePnL(1, min - 1n)
      ).to.be.revertedWith("PnL out of range");
    });
  });

  // ─── resolveDuel ───────────────────────────────────────────────────────────

  // Settlement runs on encrypted scores, which need COTI's MPC precompile, so
  // these use LocalDuelManager: submitFinalPnLPlain() records a settlement and
  // _comparePnL() compares the public live values. That substitution is sound
  // because the on-chain pin forces each encrypted score to equal the agent's
  // last public report, so both paths pick the same winner. The ciphertext
  // validation and the pin itself are covered by scripts/e2e-full.ts on testnet.
  describe("resolveDuel", () => {
    let dm: LocalDuelManager;

    const TOTAL = STAKE * 2n;
    const PRIZE = (TOTAL * 9500n) / 10000n; // 100% - FEE_BPS
    const FINAL_WINDOW = 60;   // LocalDuelManager.finalWindow()

    beforeEach(async () => {
      const Factory = await ethers.getContractFactory("LocalDuelManager");
      dm = await Factory.deploy(feeRecipient.address);
      await dm.waitForDeployment();
      await dm.connect(agentA).createDuel(DURATION_1H, { value: STAKE });
      await dm.connect(agentB).joinDuel(1, { value: STAKE });
    });

    /** Report live PnL, expire the duel, then settle for the named agents. */
    async function play(pnlA: number | null, pnlB: number | null, settle: "both" | "a" | "b" | "none") {
      if (pnlA !== null) await dm.connect(agentA).updateLivePnL(1, pnlA);
      if (pnlB !== null) await dm.connect(agentB).updateLivePnL(1, pnlB);
      await time.increase(DURATION_1H);
      if (settle === "both" || settle === "a") await dm.connect(agentA).submitFinalPnLPlain(1);
      if (settle === "both" || settle === "b") await dm.connect(agentB).submitFinalPnLPlain(1);
      await time.increase(FINAL_WINDOW);
    }

    // A contract participant cannot settle for itself: MpcCore.validateCiphertext
    // binds an input text to the immediate caller, so neither holding a key in the
    // contract nor forwarding a user's ciphertext works — both revert on testnet.
    // AgentMarketplace therefore names the renter as its settlement delegate.
    // Only the authorisation half is testable here; the ciphertext half is
    // scenario M of scripts/e2e-full.ts.
    /**
     * A browser wallet cannot run a strategy for the length of a duel, so the
     * agent that plays reports from its own key. Before this, updateLivePnL took
     * only a participant: every tick from an agent server reverted with "Not a
     * participant" and the duel was lost by forfeit with nothing on screen to
     * explain it. Any duel created from a wallet that was not the agent's own
     * was unplayable.
     */
    /**
     * One transaction per score capped the curve at a point every few seconds,
     * because that is how often a block arrives. The scores in between were
     * never unknown — an agent holds a portfolio and the market has a price —
     * they were just too expensive to write down one at a time.
     */
    describe("batched scores", () => {
      it("records the last value as the score", async () => {
        await dm.connect(agentA).updateLivePnLBatch(1, [100, 200, 350], [750, 500, 250]);
        const live = await dm.getLivePnL(1);
        expect(live[0]).to.equal(350);
      });

      it("counts as having competed", async () => {
        await dm.connect(agentA).updateLivePnLBatch(1, [42], [0]);
        expect((await dm.getDuel(1))[7]).to.equal(true);
      });

      it("puts the whole run in the log, in order", async () => {
        const tx = await dm.connect(agentA).updateLivePnLBatch(1, [10, 20, 30], [500, 250, 0]);
        const rc = await tx.wait();
        const log = rc!.logs.find(
          (l: any) => l.fragment?.name === "LivePnLBatch"
        ) as any;
        expect(log.args.pnlBps.map(Number)).to.deep.equal([10, 20, 30]);
        expect(log.args.ageMs.map(Number)).to.deep.equal([500, 250, 0]);
      });

      it("still emits the single update, so existing readers keep working", async () => {
        await expect(dm.connect(agentA).updateLivePnLBatch(1, [10, 20], [250, 0]))
          .to.emit(dm, "LivePnLUpdated").withArgs(1, agentA.address, 20);
      });

      it("a named agent can batch for its principal", async () => {
        await dm.connect(agentA).setSettlementDelegate(1, agentC.address);
        await dm.connect(agentC).updateLivePnLBatch(1, [7, 9], [250, 0]);
        expect((await dm.getLivePnL(1))[0]).to.equal(9);
        expect((await dm.getDuel(1))[8]).to.equal(false);
      });

      it("an address nobody named cannot batch", async () => {
        await expect(
          dm.connect(agentC).updateLivePnLBatch(1, [5], [0])
        ).to.be.revertedWith("Not a participant");
      });

      it("rejects a batch that says nothing", async () => {
        await expect(
          dm.connect(agentA).updateLivePnLBatch(1, [], [])
        ).to.be.revertedWith("Empty batch");
      });

      it("rejects mismatched lengths, so a point cannot land at an unknown time", async () => {
        await expect(
          dm.connect(agentA).updateLivePnLBatch(1, [1, 2], [0])
        ).to.be.revertedWith("Length mismatch");
      });

      it("bounds the batch so one transaction cannot be made to run out of gas", async () => {
        const max = Number(await dm.MAX_BATCH());
        const scores = Array.from({ length: max + 1 }, (_, i) => i);
        await expect(
          dm.connect(agentA).updateLivePnLBatch(1, scores, scores)
        ).to.be.revertedWith("Batch too large");
      });

      it("checks every value, not only the last", async () => {
        const tooBig = (await dm.PNL_MAX_BPS()) + 1n;
        await expect(
          dm.connect(agentA).updateLivePnLBatch(1, [tooBig, 10], [250, 0])
        ).to.be.revertedWith("PnL out of range");
      });

      it("is closed after endTime like a single update", async () => {
        await time.increase(DURATION_1H);
        await expect(
          dm.connect(agentA).updateLivePnLBatch(1, [10], [0])
        ).to.be.revertedWith("Submissions closed");
      });

      it("settlement pins to the batch's last value", async () => {
        await dm.connect(agentA).updateLivePnLBatch(1, [100, 250], [250, 0]);
        await dm.connect(agentB).updateLivePnL(1, 200);
        await time.increase(DURATION_1H);

        await dm.connect(agentA).submitFinalPnLPlain(1);
        expect((await dm.getFinalPnLStatus(1))[0]).to.equal(true);
      });
    });

    describe("an agent reporting for its principal", () => {
      it("a named agent reports live PnL for the participant who named it", async () => {
        await dm.connect(agentA).setSettlementDelegate(1, agentC.address);
        await dm.connect(agentC).updateLivePnL(1, 742);

        const live = await dm.getLivePnL(1);
        expect(live[0]).to.equal(742);   // recorded against agentA
        const duel = await dm.getDuel(1);
        expect(duel[7]).to.equal(true);  // agentA counts as having competed
        expect(duel[8]).to.equal(false); // agentC did not compete for itself
      });

      it("the event names the principal, so the feed reads as the participant's", async () => {
        await dm.connect(agentA).setSettlementDelegate(1, agentC.address);
        await expect(dm.connect(agentC).updateLivePnL(1, 111))
          .to.emit(dm, "LivePnLUpdated").withArgs(1, agentA.address, 111);
      });

      it("an address nobody named cannot report", async () => {
        await expect(
          dm.connect(agentC).updateLivePnL(1, 999)
        ).to.be.revertedWith("Not a participant");
      });

      it("naming an agent does not let it report for the other side", async () => {
        await dm.connect(agentA).setSettlementDelegate(1, agentC.address);
        await dm.connect(agentC).updateLivePnL(1, 300);

        const live = await dm.getLivePnL(1);
        expect(live[1]).to.equal(0);   // agentB untouched
      });

      it("createDuelWithAgent authorises in the transaction that stakes", async () => {
        // A second transaction is worth nothing here: the duel is already
        // running by then and the ticks it missed cannot be replayed.
        await dm.connect(agentA).createDuelWithAgent(DURATION_1H, agentC.address, { value: STAKE });
        const duelId = await dm.duelCount();
        await dm.connect(agentB).joinDuel(duelId, { value: STAKE });

        await dm.connect(agentC).updateLivePnL(duelId, 505);
        const live = await dm.getLivePnL(duelId);
        expect(live[0]).to.equal(505);
      });

      it("createDuelWithAgent rejects the zero address", async () => {
        await expect(
          dm.connect(agentA).createDuelWithAgent(DURATION_1H, ethers.ZeroAddress, { value: STAKE })
        ).to.be.revertedWith("Zero agent");
      });

      it("an agent still cannot settle on a score it never published", async () => {
        // The delegate chooses the live score — it is the one playing. What it
        // cannot do is settle on something else: the pin is what keeps the
        // encrypted result equal to the number everyone watched.
        await dm.connect(agentA).setSettlementDelegate(1, agentC.address);
        await time.increase(DURATION_1H);
        await expect(
          dm.connect(agentC).submitFinalPnLPlain(1)
        ).to.be.revertedWith("No live PnL to settle");
      });
    });

    describe("settlement delegation", () => {
      it("only a participant can name a delegate", async () => {
        await expect(
          dm.connect(deployer).setSettlementDelegate(1, agentC.address)
        ).to.be.revertedWith("Not a participant");
      });

      it("rejects the zero address", async () => {
        await expect(
          dm.connect(agentA).setSettlementDelegate(1, ethers.ZeroAddress)
        ).to.be.revertedWith("Zero delegate");
      });

      it("emits the principal and the delegate", async () => {
        await expect(dm.connect(agentA).setSettlementDelegate(1, agentC.address))
          .to.emit(dm, "SettlementDelegateSet").withArgs(1, agentA.address, agentC.address);
      });

      it("a named delegate settles for its principal", async () => {
        await dm.connect(agentA).updateLivePnL(1, 500);
        await dm.connect(agentB).updateLivePnL(1, 200);
        await dm.connect(agentA).setSettlementDelegate(1, agentC.address);
        await time.increase(DURATION_1H);

        await dm.connect(agentC).submitFinalPnLPlain(1);

        const status = await dm.getFinalPnLStatus(1);
        expect(status[0]).to.equal(true);   // agentA settled, via its delegate
        expect(status[1]).to.equal(false);  // agentC did not settle for itself
      });

      it("reports the principal, not the delegate, in the event", async () => {
        await dm.connect(agentA).updateLivePnL(1, 500);
        await dm.connect(agentA).setSettlementDelegate(1, agentC.address);
        await time.increase(DURATION_1H);

        await expect(dm.connect(agentC).submitFinalPnLPlain(1))
          .to.emit(dm, "FinalPnLSubmitted").withArgs(1, agentA.address);
      });

      it("an address that was never named cannot settle", async () => {
        await dm.connect(agentA).updateLivePnL(1, 500);
        await time.increase(DURATION_1H);
        await expect(
          dm.connect(agentC).submitFinalPnLPlain(1)
        ).to.be.revertedWith("Not a participant");
      });

      it("a delegate cannot settle a side that never reported live PnL", async () => {
        await dm.connect(agentB).updateLivePnL(1, 200);
        await dm.connect(agentA).setSettlementDelegate(1, agentC.address);
        await time.increase(DURATION_1H);
        await expect(
          dm.connect(agentC).submitFinalPnLPlain(1)
        ).to.be.revertedWith("No live PnL to settle");
      });

      it("the winner is unchanged whether a side settles itself or by delegate", async () => {
        await dm.connect(agentA).updateLivePnL(1, 900);
        await dm.connect(agentB).updateLivePnL(1, 150);
        await dm.connect(agentA).setSettlementDelegate(1, agentC.address);
        await time.increase(DURATION_1H);

        await dm.connect(agentC).submitFinalPnLPlain(1);   // agentA, by delegate
        await dm.connect(agentB).submitFinalPnLPlain(1);   // agentB, itself
        await time.increase(FINAL_WINDOW);

        await dm.connect(deployer).resolveDuel(1);
        expect((await dm.getDuel(1))[6]).to.equal(agentA.address);
      });

      it("cannot name a delegate once the duel is resolved", async () => {
        await play(500, 200, "none");
        await dm.connect(deployer).resolveDuel(1);
        await expect(
          dm.connect(agentA).setSettlementDelegate(1, agentC.address)
        ).to.be.revertedWith("Duel resolved");
      });
    });

    describe("submitFinalPnL window", () => {
      it("cannot settle while the duel is still running", async () => {
        await dm.connect(agentA).updateLivePnL(1, 100);
        await expect(
          dm.connect(agentA).submitFinalPnLPlain(1)
        ).to.be.revertedWith("Duel still running");
      });

      it("cannot settle without having reported live PnL", async () => {
        await time.increase(DURATION_1H);
        await expect(
          dm.connect(agentA).submitFinalPnLPlain(1)
        ).to.be.revertedWith("No live PnL to settle");
      });

      it("cannot settle twice", async () => {
        await dm.connect(agentA).updateLivePnL(1, 100);
        await time.increase(DURATION_1H);
        await dm.connect(agentA).submitFinalPnLPlain(1);
        await expect(
          dm.connect(agentA).submitFinalPnLPlain(1)
        ).to.be.revertedWith("Already submitted");
      });

      it("cannot settle after the window closes", async () => {
        await dm.connect(agentA).updateLivePnL(1, 100);
        await time.increase(DURATION_1H + FINAL_WINDOW);
        await expect(
          dm.connect(agentA).submitFinalPnLPlain(1)
        ).to.be.revertedWith("Final window closed");
      });

      it("emits FinalPnLSubmitted and reports settlement status", async () => {
        await dm.connect(agentA).updateLivePnL(1, 100);
        await time.increase(DURATION_1H);
        await expect(dm.connect(agentA).submitFinalPnLPlain(1))
          .to.emit(dm, "FinalPnLSubmitted").withArgs(1, agentA.address);

        const [aSettled, bSettled, closesAt] = await dm.getFinalPnLStatus(1);
        expect(aSettled).to.equal(true);
        expect(bSettled).to.equal(false);
        const endTime = (await dm.getDuel(1))[4];
        expect(closesAt).to.equal(endTime + BigInt(FINAL_WINDOW));
      });

      it("non-participant cannot settle", async () => {
        await time.increase(DURATION_1H);
        await expect(
          dm.connect(deployer).submitFinalPnLPlain(1)
        ).to.be.revertedWith("Not a participant");
      });
    });

    it("cannot resolve before the final window closes", async () => {
      await dm.connect(agentA).updateLivePnL(1, 100);
      await time.increase(DURATION_1H);
      await dm.connect(agentA).submitFinalPnLPlain(1);
      await expect(
        dm.connect(deployer).resolveDuel(1)
      ).to.be.revertedWith("Final window open");
    });

    it("higher score wins when both agents settled", async () => {
      await play(900, 150, "both");
      await expect(dm.connect(deployer).resolveDuel(1))
        .to.emit(dm, "DuelResolved").withArgs(1, agentA.address, PRIZE);

      const d = await dm.getDuel(1);
      expect(d[5]).to.equal(2); // Resolved
      expect(d[6]).to.equal(agentA.address);
    });

    // A duel is decided by who competed — who reported live PnL before endTime.
    // Settling is how the winner is computed, not whether there is one.

    it("agentA wins by forfeit when agentB never competed", async () => {
      await play(-300, null, "a");   // B never reported anything at all
      await expect(dm.connect(deployer).resolveDuel(1))
        .to.emit(dm, "DuelForfeited").withArgs(1, agentA.address, agentB.address);

      expect((await dm.getDuel(1))[6]).to.equal(agentA.address);
      expect((await dm.getAgentStats(agentA.address))[0]).to.equal(1); // win
      expect((await dm.getAgentStats(agentB.address))[1]).to.equal(1); // loss
    });

    it("agentB wins by forfeit when agentA never competed", async () => {
      await play(null, -300, "b");
      await expect(dm.connect(deployer).resolveDuel(1))
        .to.emit(dm, "DuelForfeited").withArgs(1, agentB.address, agentA.address);
      expect((await dm.getDuel(1))[6]).to.equal(agentB.address);
    });

    it("a forfeit pays the winner the same prize as a contested win", async () => {
      await play(0, null, "a");
      const before = await ethers.provider.getBalance(agentA.address);
      await dm.connect(deployer).resolveDuel(1);
      expect(await ethers.provider.getBalance(agentA.address) - before).to.equal(PRIZE);
    });

    it("an agent that competed but did not settle is not forfeited", async () => {
      // It traded the whole duel and missed a 60s window. The pin would have
      // forced its ciphertext to equal the public score anyway, so skipping the
      // step cannot change the outcome and must not decide it either.
      await play(800, -300, "b");   // A scored higher, only B settled

      await expect(dm.connect(deployer).resolveDuel(1))
        .to.emit(dm, "DuelDecidedOnPublicScores").withArgs(1);
      expect((await dm.getDuel(1))[6]).to.equal(agentA.address);
    });

    it("neither settling still yields a winner when both competed", async () => {
      await play(500, 200, "none");
      await expect(dm.connect(deployer).resolveDuel(1))
        .to.emit(dm, "DuelDecidedOnPublicScores").withArgs(1);
      expect((await dm.getDuel(1))[6]).to.equal(agentA.address);
    });

    it("a duel settled by both sides does not touch the public scores", async () => {
      await play(900, 150, "both");
      await expect(dm.connect(deployer).resolveDuel(1))
        .to.not.emit(dm, "DuelDecidedOnPublicScores");
      expect((await dm.getDuel(1))[6]).to.equal(agentA.address);
    });

    it("a tie on public scores goes to agentB, as it does on encrypted ones", async () => {
      await play(400, 400, "none");
      await dm.connect(deployer).resolveDuel(1);
      expect((await dm.getDuel(1))[6]).to.equal(agentB.address);
    });

    it("refunds both stakes in full when neither agent competed", async () => {
      await play(null, null, "none");

      const beforeA = await ethers.provider.getBalance(agentA.address);
      const beforeB = await ethers.provider.getBalance(agentB.address);
      const beforeFee = await ethers.provider.getBalance(feeRecipient.address);

      await expect(dm.connect(deployer).resolveDuel(1))
        .to.emit(dm, "DuelNoContest").withArgs(1, STAKE);

      expect(await ethers.provider.getBalance(agentA.address) - beforeA).to.equal(STAKE);
      expect(await ethers.provider.getBalance(agentB.address) - beforeB).to.equal(STAKE);
      // No contest means no protocol fee and no resolver bonus.
      expect(await ethers.provider.getBalance(feeRecipient.address)).to.equal(beforeFee);
      expect(await ethers.provider.getBalance(await dm.getAddress())).to.equal(0);
    });

    it("a no-contest records no winner and no win/loss for either agent", async () => {
      await play(null, null, "none");
      await dm.connect(deployer).resolveDuel(1);

      const d = await dm.getDuel(1);
      expect(d[5]).to.equal(2); // Resolved
      expect(d[6]).to.equal(ethers.ZeroAddress);
      expect((await dm.getAgentStats(agentA.address))[1]).to.equal(0);
      expect((await dm.getAgentStats(agentB.address))[1]).to.equal(0);
    });

    it("leaves no stake behind in any outcome", async () => {
      await play(900, 150, "both");
      await dm.connect(deployer).resolveDuel(1);
      expect(await ethers.provider.getBalance(await dm.getAddress())).to.equal(0);
    });

    it("cannot resolve the same duel twice", async () => {
      await play(null, null, "none");
      await dm.connect(deployer).resolveDuel(1);
      await expect(
        dm.connect(deployer).resolveDuel(1)
      ).to.be.revertedWith("Duel not active");
    });

    it("pays the resolver bonus to whoever resolves", async () => {
      await play(100, null, "a");

      const bonus = (TOTAL * 50n) / 10000n; // RESOLVER_FEE_BPS
      const before = await ethers.provider.getBalance(agentC.address);
      const tx = await dm.connect(agentC).resolveDuel(1);
      const receipt = await tx.wait();
      const gas = receipt!.gasUsed * receipt!.gasPrice;

      expect(await ethers.provider.getBalance(agentC.address) - before + gas).to.equal(bonus);
    });
  });


  // ─── cancelDuel ────────────────────────────────────────────────────────────

  describe("cancelDuel", () => {
    beforeEach(async () => {
      await duelManager.connect(agentA).createDuel(DURATION_1H, { value: STAKE });
    });

    it("creator can cancel open duel and reclaim stake", async () => {
      const before = await ethers.provider.getBalance(agentA.address);
      const tx = await duelManager.connect(agentA).cancelDuel(1);
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;
      const after = await ethers.provider.getBalance(agentA.address);
      expect(after + gasCost - before).to.be.closeTo(STAKE, ethers.parseEther("0.001"));
    });

    it("non-creator cannot cancel", async () => {
      await expect(
        duelManager.connect(agentB).cancelDuel(1)
      ).to.be.revertedWith("Only creator can cancel");
    });

    it("cannot cancel an active duel", async () => {
      await duelManager.connect(agentB).joinDuel(1, { value: STAKE });
      await expect(
        duelManager.connect(agentA).cancelDuel(1)
      ).to.be.revertedWith("Can only cancel open duels");
    });
  });

  // ─── getAgentStats ─────────────────────────────────────────────────────────

  describe("getAgentStats", () => {
    it("returns zero stats for new agent", async () => {
      const s = await duelManager.getAgentStats(agentA.address);
      expect(s[0]).to.equal(0); // wins
      expect(s[1]).to.equal(0); // losses
      expect(s[2]).to.equal(0); // stakeWon
    });
  });
});
