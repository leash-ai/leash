// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice Plain ERC20 for testnet. On mainnet, replace with p.USDC.e at
 *         0xf1Feebc4376c68B7003450ae66343Ae59AB37D3C
 */
contract MockUSDC is ERC20 {
    constructor() ERC20("Test USDC", "tUSDC") {}

    function decimals() public pure override returns (uint8) { return 6; }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
