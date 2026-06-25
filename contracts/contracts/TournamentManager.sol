// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@coti-io/coti-contracts/contracts/utils/mpc/MpcCore.sol";

/**
 * @title TournamentManager
 * @notice Single-elimination tournament for AI agent trading duels on COTI.
 *         All PnL comparisons use Garbled Circuits — strategies stay private.
 *
 * Format:
 *   - 4 or 8 agents register with a stake
 *   - Bracket auto-generates: round 1 → semi-finals → final
 *   - Each match runs for the configured duration
 *   - Winner advances; loser is eliminated
 *   - Last agent standing takes the prize pool
 */
contract TournamentManager {

    enum TournamentState { Registration, Active, Completed }
    enum MatchState { Scheduled, Active, PendingResolution, Resolved }

    struct Match {
        uint256 tournamentId;
        uint32 round;
        address agentA;
        address agentB;
        uint256 startTime;
        uint256 endTime;
        utUint64 pnlA;
        utUint64 pnlB;
        bool pnlASubmitted;
        bool pnlBSubmitted;
        address winner;
        MatchState state;
    }

    struct Tournament {
        address creator;
        uint8 maxAgents;      // 4 or 8
        uint256 stake;        // per agent
        uint256 matchDuration;
        TournamentState state;
        address[] participants;
        uint256[] matchIds;
        address winner;
    }

    uint256 public tournamentCount;
    uint256 public matchCount;

    mapping(uint256 => Tournament) public tournaments;
    mapping(uint256 => Match) public matches;

    uint256 public constant FEE_BPS = 500;
    address public immutable feeRecipient;

    event TournamentCreated(uint256 indexed tournamentId, uint8 maxAgents, uint256 stake, uint256 matchDuration);
    event AgentRegistered(uint256 indexed tournamentId, address indexed agent);
    event TournamentStarted(uint256 indexed tournamentId);
    event MatchStarted(uint256 indexed matchId, uint256 indexed tournamentId, uint32 round, address agentA, address agentB);
    event MatchResolved(uint256 indexed matchId, address indexed winner);
    event TournamentCompleted(uint256 indexed tournamentId, address indexed winner, uint256 prize);

    constructor(address _feeRecipient) {
        feeRecipient = _feeRecipient;
    }

    /**
     * @notice Create a new tournament.
     * @param maxAgents 4 or 8 participants
     * @param matchDuration Duration of each match in seconds
     */
    function createTournament(uint8 maxAgents, uint256 matchDuration) external {
        require(maxAgents == 4 || maxAgents == 8, "Must be 4 or 8 agents");
        require(matchDuration >= 1 hours && matchDuration <= 7 days, "Invalid duration");

        uint256 tId = ++tournamentCount;
        tournaments[tId].creator = msg.sender;
        tournaments[tId].maxAgents = maxAgents;
        tournaments[tId].matchDuration = matchDuration;
        tournaments[tId].state = TournamentState.Registration;

        emit TournamentCreated(tId, maxAgents, 0, matchDuration);
    }

    /**
     * @notice Register for a tournament by paying the stake.
     */
    function register(uint256 tournamentId) external payable {
        Tournament storage t = tournaments[tournamentId];
        require(t.state == TournamentState.Registration, "Not in registration");
        require(t.participants.length < t.maxAgents, "Tournament full");
        require(!_isParticipant(t, msg.sender), "Already registered");

        // First registrant sets the stake
        if (t.participants.length == 0) {
            t.stake = msg.value;
        } else {
            require(msg.value == t.stake, "Wrong stake");
        }

        t.participants.push(msg.sender);
        emit AgentRegistered(tournamentId, msg.sender);

        // Auto-start when full
        if (t.participants.length == t.maxAgents) {
            _startTournament(tournamentId);
        }
    }

    function _startTournament(uint256 tournamentId) internal {
        Tournament storage t = tournaments[tournamentId];
        t.state = TournamentState.Active;
        emit TournamentStarted(tournamentId);

        // Create round 1 matches (pair up participants)
        uint256 numMatches = t.participants.length / 2;
        for (uint256 i = 0; i < numMatches; i++) {
            _createMatch(tournamentId, 1, t.participants[i * 2], t.participants[i * 2 + 1]);
        }
    }

    function _createMatch(uint256 tournamentId, uint32 round, address agentA, address agentB) internal {
        uint256 mId = ++matchCount;
        Tournament storage t = tournaments[tournamentId];

        matches[mId] = Match({
            tournamentId: tournamentId,
            round: round,
            agentA: agentA,
            agentB: agentB,
            startTime: block.timestamp,
            endTime: block.timestamp + t.matchDuration,
            pnlA: utUint64(ctUint64.wrap(0), ctUint64.wrap(0)),
            pnlB: utUint64(ctUint64.wrap(0), ctUint64.wrap(0)),
            pnlASubmitted: false,
            pnlBSubmitted: false,
            winner: address(0),
            state: MatchState.Active
        });

        t.matchIds.push(mId);
        emit MatchStarted(mId, tournamentId, round, agentA, agentB);
    }

    /**
     * @notice Submit encrypted final PnL for a match.
     */
    function submitMatchPnL(uint256 matchId, itUint64 calldata encryptedPnL) external {
        Match storage m = matches[matchId];
        require(block.timestamp >= m.endTime, "Match still active");
        require(m.state == MatchState.Active || m.state == MatchState.PendingResolution, "Invalid state");
        require(msg.sender == m.agentA || msg.sender == m.agentB, "Not a participant");

        gtUint64 gtPnL = MpcCore.validateCiphertext(encryptedPnL);

        if (msg.sender == m.agentA) {
            require(!m.pnlASubmitted, "Already submitted");
            m.pnlA = MpcCore.offBoardCombined(gtPnL, m.agentA);
            m.pnlASubmitted = true;
        } else {
            require(!m.pnlBSubmitted, "Already submitted");
            m.pnlB = MpcCore.offBoardCombined(gtPnL, m.agentB);
            m.pnlBSubmitted = true;
        }

        m.state = MatchState.PendingResolution;
    }

    /**
     * @notice Resolve a match via Garbled Circuit comparison. Advance winner to next round.
     */
    function resolveMatch(uint256 matchId) external {
        Match storage m = matches[matchId];
        require(m.state == MatchState.PendingResolution, "Not pending resolution");
        require(m.pnlASubmitted && m.pnlBSubmitted, "Both must submit");

        gtUint64 pnlA = MpcCore.onBoard(m.pnlA.ciphertext);
        gtUint64 pnlB = MpcCore.onBoard(m.pnlB.ciphertext);
        gtBool aWins = MpcCore.gt(pnlA, pnlB);
        bool agentAWins = MpcCore.decrypt(aWins);

        m.winner = agentAWins ? m.agentA : m.agentB;
        m.state = MatchState.Resolved;

        emit MatchResolved(matchId, m.winner);

        // Advance tournament bracket
        _advanceBracket(m.tournamentId, matchId);
    }

    function _advanceBracket(uint256 tournamentId, uint256 resolvedMatchId) internal {
        Tournament storage t = tournaments[tournamentId];

        // Collect winners from current round
        Match storage resolved = matches[resolvedMatchId];
        uint32 currentRound = resolved.round;

        // Check if all matches in this round are done
        uint256 matchesInRound = t.participants.length / (2 ** currentRound);
        uint256 resolvedCount = 0;
        address[] memory roundWinners = new address[](matchesInRound);

        uint256 winnerIdx = 0;
        for (uint256 i = 0; i < t.matchIds.length; i++) {
            Match storage m = matches[t.matchIds[i]];
            if (m.round == currentRound) {
                if (m.state == MatchState.Resolved) {
                    resolvedCount++;
                    if (winnerIdx < matchesInRound) {
                        roundWinners[winnerIdx++] = m.winner;
                    }
                }
            }
        }

        if (resolvedCount < matchesInRound) return; // Still waiting for other matches

        // If only 1 winner → tournament over
        if (roundWinners.length == 1) {
            t.winner = roundWinners[0];
            t.state = TournamentState.Completed;

            uint256 totalPot = t.stake * t.participants.length;
            uint256 fee = (totalPot * FEE_BPS) / 10000;
            uint256 prize = totalPot - fee;

            if (fee > 0) payable(feeRecipient).transfer(fee);
            payable(t.winner).transfer(prize);

            emit TournamentCompleted(tournamentId, t.winner, prize);
        } else {
            // Create next round matches
            for (uint256 i = 0; i + 1 < roundWinners.length; i += 2) {
                _createMatch(tournamentId, currentRound + 1, roundWinners[i], roundWinners[i + 1]);
            }
        }
    }

    function _isParticipant(Tournament storage t, address addr) internal view returns (bool) {
        for (uint256 i = 0; i < t.participants.length; i++) {
            if (t.participants[i] == addr) return true;
        }
        return false;
    }

    function getParticipants(uint256 tournamentId) external view returns (address[] memory) {
        return tournaments[tournamentId].participants;
    }

    function getMatchIds(uint256 tournamentId) external view returns (uint256[] memory) {
        return tournaments[tournamentId].matchIds;
    }
}
