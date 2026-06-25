// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DuelManager.sol";

/**
 * @title TestDuelManager
 * @notice Relaxed constraints for E2E testing. DO NOT deploy to mainnet.
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

    /**
     * @notice Test-only: set encrypted PnL without ciphertext validation.
     *         Bypasses the itUint64 signature check so E2E tests can exercise
     *         the full GC resolution path without needing coti-ethers SDK.
     *         NOT available in production DuelManager.
     *
     * @param agent  Must be agentA or agentB of the duel
     * @param rawPnl Plain uint64 PnL value (encode as pnlBps + 100_000_000)
     */
    function unsafeSetPnL(uint256 duelId, address agent, uint64 rawPnl) external {
        Duel storage duel = duels[duelId];
        require(duel.state == DuelState.Active, "Duel not active");
        require(agent == duel.agentA || agent == duel.agentB, "Not a participant");

        gtUint64 gt = MpcCore.setPublic64(rawPnl);

        if (agent == duel.agentA) {
            duel.agentAPnL       = MpcCore.offBoardCombined(gt, agent);
            duel.agentASubmitted = true;
        } else {
            duel.agentBPnL       = MpcCore.offBoardCombined(gt, agent);
            duel.agentBSubmitted = true;
        }

        lastPnLUpdate[duelId][agent] = block.timestamp;
        emit LivePnLUpdated(duelId, agent);
    }
}
