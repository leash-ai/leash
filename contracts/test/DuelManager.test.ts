import { expect } from "chai";
import { ethers } from "hardhat";
import { DuelManager } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("DuelManager", function () {
  let duelManager: DuelManager;
  let deployer: HardhatEthersSigner;
  let agentA: HardhatEthersSigner;
  let agentB: HardhatEthersSigner;
  let feeRecipient: HardhatEthersSigner;

  const STAKE = ethers.parseEther("0.1");
  const DURATION_1H = 3600;

  beforeEach(async () => {
    [deployer, agentA, agentB, feeRecipient] = await ethers.getSigners();

    const DuelManager = await ethers.getContractFactory("DuelManager");
    duelManager = await DuelManager.deploy(feeRecipient.address);
    await duelManager.waitForDeployment();
  });

  describe("createDuel", () => {
    it("creates a duel with correct state", async () => {
      await duelManager.connect(agentA).createDuel(DURATION_1H, { value: STAKE });

      const duel = await duelManager.getDuel(1);
      expect(duel.agentA).to.equal(agentA.address);
      expect(duel.agentB).to.equal(ethers.ZeroAddress);
      expect(duel.stake).to.equal(STAKE);
      expect(duel.state).to.equal(0); // Open
    });

    it("reverts with zero stake", async () => {
      await expect(
        duelManager.connect(agentA).createDuel(DURATION_1H, { value: 0 })
      ).to.be.revertedWith("Stake required");
    });

    it("reverts with invalid duration", async () => {
      await expect(
        duelManager.connect(agentA).createDuel(60, { value: STAKE }) // 1 min - too short
      ).to.be.revertedWith("Invalid duration");
    });
  });

  describe("joinDuel", () => {
    beforeEach(async () => {
      await duelManager.connect(agentA).createDuel(DURATION_1H, { value: STAKE });
    });

    it("agent B joins and duel becomes active", async () => {
      await duelManager.connect(agentB).joinDuel(1, { value: STAKE });

      const duel = await duelManager.getDuel(1);
      expect(duel.agentB).to.equal(agentB.address);
      expect(duel.state).to.equal(1); // Active
    });

    it("reverts if wrong stake", async () => {
      await expect(
        duelManager.connect(agentB).joinDuel(1, { value: ethers.parseEther("0.05") })
      ).to.be.revertedWith("Wrong stake amount");
    });

    it("reverts if agent A tries to join own duel", async () => {
      await expect(
        duelManager.connect(agentA).joinDuel(1, { value: STAKE })
      ).to.be.revertedWith("Cannot duel yourself");
    });
  });

  describe("updateLivePnL", () => {
    beforeEach(async () => {
      await duelManager.connect(agentA).createDuel(DURATION_1H, { value: STAKE });
      await duelManager.connect(agentB).joinDuel(1, { value: STAKE });
    });

    it("agents can update their live PnL", async () => {
      await duelManager.connect(agentA).updateLivePnL(1, 523);  // +5.23%
      await duelManager.connect(agentB).updateLivePnL(1, -210); // -2.10%

      const pnl = await duelManager.getLivePnL(1);
      expect(pnl.pnlA).to.equal(523);
      expect(pnl.pnlB).to.equal(-210);
    });

    it("non-participant cannot update PnL", async () => {
      await expect(
        duelManager.connect(deployer).updateLivePnL(1, 100)
      ).to.be.revertedWith("Not a participant");
    });
  });

  describe("cancelDuel", () => {
    it("creator can cancel an open duel and reclaim stake", async () => {
      await duelManager.connect(agentA).createDuel(DURATION_1H, { value: STAKE });

      const balanceBefore = await ethers.provider.getBalance(agentA.address);
      const tx = await duelManager.connect(agentA).cancelDuel(1);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const balanceAfter = await ethers.provider.getBalance(agentA.address);

      expect(balanceAfter).to.be.closeTo(balanceBefore + STAKE - gasUsed, ethers.parseEther("0.001"));
    });
  });

  describe("getAgentStats", () => {
    it("returns zero stats for new agent", async () => {
      const stats = await duelManager.getAgentStats(agentA.address);
      expect(stats.agentWins).to.equal(0);
      expect(stats.agentLosses).to.equal(0);
      expect(stats.stakeWon).to.equal(0);
    });
  });
});
