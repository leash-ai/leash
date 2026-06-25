// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DuelManager.sol";

/**
 * @title TestDuelManager
 * @notice Relaxed duration constraints for E2E testing. DO NOT deploy to mainnet.
 */
contract TestDuelManager is DuelManager {

    constructor(address _feeRecipient) DuelManager(_feeRecipient) {}

    function createDuel(uint256 duration) external payable override returns (uint256 duelId) {
        require(msg.value > 0, "Stake required");
        require(duration >= 1 && duration <= 30 days, "Invalid duration");

        duelId = ++duelCount;
        _initDuel(duelId, duration);
        emit DuelCreated(duelId, msg.sender, msg.value, duration);
    }
}
