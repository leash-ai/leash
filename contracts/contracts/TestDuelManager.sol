// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DuelManager.sol";

/**
 * @title TestDuelManager
 * @notice Relaxed constraints for E2E testing (no min duration, lower stake).
 * @dev DO NOT deploy to mainnet.
 */
contract TestDuelManager is DuelManager {

    constructor(address _feeRecipient) DuelManager(_feeRecipient) {}

    /// @dev Override to allow durations as short as 1 second for testing
    function createDuel(uint256 duration) external payable override returns (uint256 duelId) {
        require(msg.value > 0, "Stake required");
        require(duration >= 1 && duration <= 30 days, "Invalid duration");

        duelId = ++duelCount;

        duels[duelId] = Duel({
            agentA: msg.sender,
            agentB: address(0),
            stake: msg.value,
            startTime: 0,
            endTime: 0,
            state: DuelState.Open,
            agentAPnL: utUint64(ctUint64.wrap(0), ctUint64.wrap(0)),
            agentBPnL: utUint64(ctUint64.wrap(0), ctUint64.wrap(0)),
            agentASubmitted: false,
            agentBSubmitted: false,
            winner: address(0)
        });

        duels[duelId].endTime = duration;

        emit DuelCreated(duelId, msg.sender, msg.value, duration);
    }
}
