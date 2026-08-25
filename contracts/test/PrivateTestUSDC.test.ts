import { expect } from "chai";
import { ethers } from "hardhat";

/**
 * PrivateTestUSDC — what can be checked without the MPC precompile.
 *
 * The contract deploys on Hardhat, but every state-changing call goes through
 * PrivateERC20 and therefore through the precompile at address(0x64), which only
 * exists on a COTI network. Locally those revert with "function returned an
 * unexpected amount of data". Minting, transfers, allowances and balances are
 * covered by scripts/e2e-full.ts against testnet instead.
 *
 * What is left here is exactly what this contract adds on top of PrivateERC20:
 * its metadata and the role granted in the constructor. Small, but decimals in
 * particular is load-bearing — AgentMarketplace prices rentals in 6-decimal
 * ptUSDC units, and the e2e asserts amounts like 1_000_000n for 1 ptUSDC.
 */
describe("PrivateTestUSDC", () => {
  async function deploy() {
    const [deployer, other] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("PrivateTestUSDC")).deploy();
    await token.waitForDeployment();
    return { token, deployer, other };
  }

  it("uses 6 decimals, like the p.USDC.e it stands in for", async () => {
    const { token } = await deploy();
    expect(await token.decimals()).to.equal(6);
  });

  it("reports its name and symbol", async () => {
    const { token } = await deploy();
    expect(await token.name()).to.equal("Private Test USDC");
    expect(await token.symbol()).to.equal("ptUSDC");
  });

  it("grants MINTER_ROLE to the deployer", async () => {
    const { token, deployer, other } = await deploy();
    const role = await token.MINTER_ROLE();
    expect(await token.hasRole(role, deployer.address)).to.equal(true);
    expect(await token.hasRole(role, other.address)).to.equal(false);
  });

  it("starts with no supply", async () => {
    const { token } = await deploy();
    expect(await token.totalSupply()).to.equal(0);
  });
});
