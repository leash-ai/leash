// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./TestDuelManager.sol";

/**
 * @title LocalDuelManager
 * @notice Hardhat-only build. NEVER deploy this, to any network.
 *
 * The MPC precompile at address(0x64) only exists on COTI, so DuelManager's
 * encrypted submission path and MpcCore.gt comparison both revert on a local
 * network. This contract replaces each with a plaintext stand-in so the window,
 * ordering, forfeit, no-contest, payout and accounting logic stay under fast
 * local unit tests.
 *
 * What that leaves uncovered locally, by construction:
 *   - validateCiphertext on a real input text
 *   - the in-circuit pin (MpcCore.eq against the last public report)
 *   - the garbled-circuit comparison itself
 *
 * Those three are covered by scenarios M, N and O of scripts/e2e-full.ts, which
 * run against a TestDuelManager deployed on COTI testnet.
 */
contract LocalDuelManager is TestDuelManager {

    constructor(address _feeRecipient) TestDuelManager(_feeRecipient) {}

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

        // Same principal resolution as submitFinalPnL, so the delegation rules
        // are covered locally even though the ciphertext half cannot be.
        address principal = msg.sender;
        if (msg.sender != duel.agentA && msg.sender != duel.agentB) {
            principal = settlementDelegate[duelId][msg.sender];
            require(principal != address(0), "Not a participant");
        }

        bool isA = principal == duel.agentA;
        require(isA ? duel.agentASubmitted : duel.agentBSubmitted, "No live PnL to settle");
        require(!(isA ? duel.finalASubmitted : duel.finalBSubmitted), "Already submitted");

        if (isA) duel.finalASubmitted = true;
        else     duel.finalBSubmitted = true;

        emit FinalPnLSubmitted(duelId, principal);
    }

    /**
     * @dev Plaintext settlement. Valid stand-in precisely because the pin forces
     *      each encrypted score to equal the agent's last public live value, so
     *      comparing those two values yields the same winner the garbled circuit
     *      would — a claim scenario M is what actually establishes.
     */
    function _comparePnL(Duel storage duel) internal view override returns (bool aWins) {
        return duel.agentAPnL > duel.agentBPnL;
    }
}
