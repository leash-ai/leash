// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DuelManager.sol";

/**
 * @title TestDuelManager
 * @notice Test/demo build of DuelManager. DO NOT deploy to mainnet.
 *
 * Two relaxations, both of which exist because the real contract cannot run
 * end-to-end on a local network:
 *
 *   1. Duration floor of 1 second, so testnet demos don't wait a minute.
 *   2. Settlement without the MPC precompile. address(0x64) only exists on COTI,
 *      so _comparePnL() and the encrypted submission path revert on Hardhat.
 *      submitFinalPnLPlain() records a settlement in plaintext and _comparePnL()
 *      compares the public live values, which keeps the window, forfeit,
 *      no-contest, payout and accounting logic under local unit tests.
 *
 * The pin enforced by DuelManager.submitFinalPnL — that an encrypted score must
 * equal the agent's last public report — has no equivalent here, because there
 * is no ciphertext to validate. It is covered by scenario N of
 * scripts/e2e-full.ts against testnet.
 */
contract TestDuelManager is DuelManager {

    constructor(address _feeRecipient) DuelManager(_feeRecipient) {}

    /**
     * @dev 60s instead of an hour. Long enough for two settlement transactions to
     *      confirm on testnet, short enough that scripts/e2e-full.ts finishes.
     */
    function finalWindow() public view override returns (uint256) {
        return 60;
    }

    function createDuel(uint256 duration) external payable override returns (uint256 duelId) {
        require(msg.value > 0, "Stake required");
        require(duration >= 1 && duration <= 30 days, "Invalid duration");

        duelId = ++duelCount;
        _initDuel(duelId, duration);
        emit DuelCreated(duelId, msg.sender, msg.value, duration);
    }

    /**
     * @notice Plaintext stand-in for submitFinalPnL. Mirrors its preconditions so
     *         tests exercise the same window and ordering rules, but skips the
     *         ciphertext validation and the in-circuit pin.
     */
    function submitFinalPnLPlain(uint256 duelId) external {
        Duel storage duel = duels[duelId];
        require(duel.state == DuelState.Active, "Duel not active");
        require(block.timestamp >= duel.endTime, "Duel still running");
        require(block.timestamp < duel.endTime + finalWindow(), "Final window closed");

        bool isA = msg.sender == duel.agentA;
        require(isA || msg.sender == duel.agentB, "Not a participant");
        require(isA ? duel.agentASubmitted : duel.agentBSubmitted, "No live PnL to settle");
        require(!(isA ? duel.finalASubmitted : duel.finalBSubmitted), "Already submitted");

        if (isA) duel.finalASubmitted = true;
        else     duel.finalBSubmitted = true;

        emit FinalPnLSubmitted(duelId, msg.sender);
    }

    /**
     * @dev Plaintext settlement. Valid stand-in precisely because the pin forces
     *      each encrypted score to equal the agent's last public live value, so
     *      comparing those two values yields the same winner the garbled circuit
     *      would.
     */
    function _comparePnL(Duel storage duel) internal view override returns (bool aWins) {
        return duel.agentAPnL > duel.agentBPnL;
    }
}
