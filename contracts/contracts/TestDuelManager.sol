// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DuelManager.sol";

/**
 * @title TestDuelManager
 * @notice Testnet build of DuelManager. DO NOT deploy to mainnet.
 *
 * Two timing relaxations, and nothing else:
 *
 *   1. Duration floor of 1 second, so a demo duel doesn't wait a minute.
 *   2. finalWindow() of 60s instead of an hour — long enough for two settlement
 *      transactions to confirm on testnet, short enough that e2e-full.ts finishes.
 *
 * Settlement is the real thing: submitFinalPnL validates a ciphertext and pins it
 * in-circuit, and _comparePnL runs MpcCore.gt. Both need the precompile at
 * address(0x64), which exists on COTI and not on Hardhat — so this contract
 * cannot be used for local unit tests. LocalDuelManager exists for those, and it
 * is the only place the plaintext stand-ins live.
 *
 * Keeping the stand-ins out of this contract is deliberate: a plaintext
 * submitFinalPnLPlain deployed to a live network would let an agent mark itself
 * settled with no ciphertext at all, which is exactly the bypass the pin exists
 * to prevent.
 */
contract TestDuelManager is DuelManager {

    constructor(address _feeRecipient) DuelManager(_feeRecipient) {}

    function finalWindow() public view virtual override returns (uint256) {
        return 60;
    }

    function createDuel(uint256 duration) external payable virtual override returns (uint256 duelId) {
        require(msg.value > 0, "Stake required");
        require(duration >= 1 && duration <= 30 days, "Invalid duration");

        duelId = ++duelCount;
        _initDuel(duelId, duration);
        emit DuelCreated(duelId, msg.sender, msg.value, duration);
    }
}
