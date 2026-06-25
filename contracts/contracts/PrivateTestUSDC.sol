// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@coti-io/coti-contracts/contracts/token/PrivateERC20/PrivateERC20.sol";

/**
 * @title PrivateTestUSDC
 * @notice Testnet stand-in for p.USDC.e (PrivateBridgedUSDC).
 *
 * Balances are encrypted via COTI's MPC garbled-circuit precompile.
 * Nobody can see how much cUSDC any address holds — not even on-chain.
 * Transfer amounts can remain public (plain uint256) since the listing price
 * is already public in the AgentMarketplace Listing struct.
 *
 * On mainnet: swap address for the real p.USDC.e at
 * 0xf1Feebc4376c68B7003450ae66343Ae59AB37D3C
 */
contract PrivateTestUSDC is PrivateERC20 {

    constructor() PrivateERC20("Private Test USDC", "ptUSDC") {
        // Grant MINTER_ROLE to deployer so we can mint testnet tokens
        _grantRole(MINTER_ROLE, msg.sender);
    }

    function decimals() public pure override returns (uint8) { return 6; }
}
