import { expect } from "chai";
import { ethers } from "hardhat";
import { DuelManager } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * DuelManager tests — runs on local Hardhat network.
 * MPC-dependent functions (submitFinalPnL, resolveDuel) require COTI testnet
 * and are excluded from unit tests. Covered by integration tests on testnet.
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

    it("reverts if duration < 1h", async () => {
      await expect(
        duelManager.connect(agentA).createDuel(3599, { value: STAKE })
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

    it("PnL history accumulates", async () => {
      await duelManager.connect(agentA).updateLivePnL(1, 100);
      await duelManager.connect(agentA).updateLivePnL(1, 250);

      const history = await duelManager.getPnLHistory(1);
      expect(history[0].length).to.equal(2);
      expect(history[0][0]).to.equal(100);
      expect(history[0][1]).to.equal(250);
    });

    it("emits PnLUpdated", async () => {
      await expect(
        duelManager.connect(agentA).updateLivePnL(1, 777)
      ).to.emit(duelManager, "PnLUpdated").withArgs(1, agentA.address, 777);
    });

    it("non-participant cannot update PnL", async () => {
      await expect(
        duelManager.connect(deployer).updateLivePnL(1, 100)
      ).to.be.revertedWith("Not a participant");
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
