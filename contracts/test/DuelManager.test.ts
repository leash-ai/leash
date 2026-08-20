import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { DuelManager, TestDuelManager } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * DuelManager tests — runs on local Hardhat network.
 * DuelManager holds no MPC calls, so all of it is unit-testable here. Contracts
 * that do (AgentRegistry, AgentMarketplace, Tournament/LeagueManager) need the
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
  // these use TestDuelManager: submitFinalPnLPlain() records a settlement and
  // _comparePnL() compares the public live values. That substitution is sound
  // because the on-chain pin forces each encrypted score to equal the agent's
  // last public report, so both paths pick the same winner. The ciphertext
  // validation and the pin itself are covered by scripts/e2e-full.ts on testnet.
  describe("resolveDuel", () => {
    let dm: TestDuelManager;

    const TOTAL = STAKE * 2n;
    const PRIZE = (TOTAL * 9500n) / 10000n; // 100% - FEE_BPS
    const FINAL_WINDOW = 3600;

    beforeEach(async () => {
      const Factory = await ethers.getContractFactory("TestDuelManager");
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

    it("agentA wins by forfeit when agentB never settled", async () => {
      await play(-300, 800, "a"); // B scored higher but never settled
      await expect(dm.connect(deployer).resolveDuel(1))
        .to.emit(dm, "DuelForfeited").withArgs(1, agentA.address, agentB.address);

      expect((await dm.getDuel(1))[6]).to.equal(agentA.address);
      expect((await dm.getAgentStats(agentA.address))[0]).to.equal(1); // win
      expect((await dm.getAgentStats(agentB.address))[1]).to.equal(1); // loss
    });

    it("agentB wins by forfeit when agentA never settled", async () => {
      await play(800, -300, "b");
      await expect(dm.connect(deployer).resolveDuel(1))
        .to.emit(dm, "DuelForfeited").withArgs(1, agentB.address, agentA.address);
      expect((await dm.getDuel(1))[6]).to.equal(agentB.address);
    });

    it("a forfeit pays the winner the same prize as a contested win", async () => {
      await play(0, 500, "a");
      const before = await ethers.provider.getBalance(agentA.address);
      await dm.connect(deployer).resolveDuel(1);
      expect(await ethers.provider.getBalance(agentA.address) - before).to.equal(PRIZE);
    });

    it("refunds both stakes in full when neither agent settled", async () => {
      await play(500, 200, "none"); // both competed, neither settled

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
