// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@coti-io/coti-contracts/contracts/utils/mpc/MpcCore.sol";

/**
 * @title LeagueManager
 * @notice Round-robin league season for AI agents on COTI.
 *
 * Format:
 *   - N agents register during registration window
 *   - Each agent faces every other agent once (round-robin)
 *   - All match PnL compared via Garbled Circuits
 *   - Season ends when all matches resolve; prize pool shared by top-3
 *   - Points: 3 for win, 1 for draw (equal PnL), 0 for loss
 */
contract LeagueManager {

    enum LeagueState { Registration, Active, Completed }
    enum MatchState { Scheduled, Active, PendingResolution, Resolved }

    struct LeagueMatch {
        uint256 leagueId;
        address agentA;
        address agentB;
        uint256 endTime;
        utUint64 pnlA;
        utUint64 pnlB;
        bool pnlASubmitted;
        bool pnlBSubmitted;
        address winner;        // address(0) = draw
        bool resolved;
        MatchState state;
    }

    struct League {
        address creator;
        uint256 stake;           // per agent
        uint256 matchDuration;
        uint256 seasonStart;
        LeagueState state;
        address[] participants;
        uint256[] matchIds;
        mapping(address => uint256) points;
        mapping(address => uint256) wins;
        mapping(address => uint256) losses;
        mapping(address => uint256) draws;
    }

    uint256 public leagueCount;
    uint256 public matchCount;

    mapping(uint256 => League) public leagues;
    mapping(uint256 => LeagueMatch) public matches;

    uint256 public constant FEE_BPS = 500;
    // Prize distribution: 60% first, 30% second, 10% third
    uint256 public constant FIRST_BPS = 6000;
    uint256 public constant SECOND_BPS = 3000;
    uint256 public constant THIRD_BPS = 1000;

    address public immutable feeRecipient;

    event LeagueCreated(uint256 indexed leagueId, uint256 matchDuration);
    event LeagueRegistered(uint256 indexed leagueId, address indexed agent);
    event LeagueStarted(uint256 indexed leagueId, uint256 totalMatches);
    event LeagueMatchResolved(uint256 indexed matchId, address indexed winner, bool isDraw);
    event LeagueCompleted(uint256 indexed leagueId, address first, address second, address third);

    constructor(address _feeRecipient) {
        feeRecipient = _feeRecipient;
    }

    function createLeague(uint256 matchDuration) external {
        require(matchDuration >= 1 hours && matchDuration <= 7 days, "Invalid duration");

        uint256 lId = ++leagueCount;
        leagues[lId].creator = msg.sender;
        leagues[lId].matchDuration = matchDuration;
        leagues[lId].state = LeagueState.Registration;

        emit LeagueCreated(lId, matchDuration);
    }

    function register(uint256 leagueId) external payable {
        League storage l = leagues[leagueId];
        require(l.state == LeagueState.Registration, "Not registration");
        require(!_isParticipant(l, msg.sender), "Already registered");
        require(l.participants.length < 8, "League full (max 8)");

        if (l.participants.length == 0) {
            l.stake = msg.value;
        } else {
            require(msg.value == l.stake, "Wrong stake");
        }

        l.participants.push(msg.sender);
        emit LeagueRegistered(leagueId, msg.sender);
    }

    /**
     * @notice Creator starts the league once registration is closed.
     * @dev Generates all N*(N-1)/2 round-robin matches.
     */
    function startLeague(uint256 leagueId) external {
        League storage l = leagues[leagueId];
        require(msg.sender == l.creator, "Only creator");
        require(l.state == LeagueState.Registration, "Already started");
        require(l.participants.length >= 2, "Need at least 2 agents");

        l.state = LeagueState.Active;
        l.seasonStart = block.timestamp;

        uint256 n = l.participants.length;
        uint256 totalMatches = (n * (n - 1)) / 2;

        // Generate round-robin schedule
        for (uint256 i = 0; i < n; i++) {
            for (uint256 j = i + 1; j < n; j++) {
                uint256 mId = ++matchCount;
                matches[mId] = LeagueMatch({
                    leagueId: leagueId,
                    agentA: l.participants[i],
                    agentB: l.participants[j],
                    endTime: block.timestamp + l.matchDuration,
                    pnlA: utUint64(ctUint64.wrap(0), ctUint64.wrap(0)),
                    pnlB: utUint64(ctUint64.wrap(0), ctUint64.wrap(0)),
                    pnlASubmitted: false,
                    pnlBSubmitted: false,
                    winner: address(0),
                    resolved: false,
                    state: MatchState.Active
                });
                l.matchIds.push(mId);
            }
        }

        emit LeagueStarted(leagueId, totalMatches);
    }

    function submitMatchPnL(uint256 matchId, itUint64 calldata encryptedPnL) external {
        LeagueMatch storage m = matches[matchId];
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

    function resolveMatch(uint256 matchId) external {
        LeagueMatch storage m = matches[matchId];
        require(m.state == MatchState.PendingResolution, "Not pending");
        require(m.pnlASubmitted && m.pnlBSubmitted, "Both must submit");

        League storage l = leagues[m.leagueId];

        gtUint64 pnlA = MpcCore.onBoard(m.pnlA.ciphertext);
        gtUint64 pnlB = MpcCore.onBoard(m.pnlB.ciphertext);

        gtBool aGtB = MpcCore.gt(pnlA, pnlB);
        gtBool bGtA = MpcCore.gt(pnlB, pnlA);

        bool agentAWins = MpcCore.decrypt(aGtB);
        bool agentBWins = MpcCore.decrypt(bGtA);

        bool isDraw = !agentAWins && !agentBWins;

        if (isDraw) {
            l.points[m.agentA] += 1;
            l.points[m.agentB] += 1;
            l.draws[m.agentA]++;
            l.draws[m.agentB]++;
        } else if (agentAWins) {
            m.winner = m.agentA;
            l.points[m.agentA] += 3;
            l.wins[m.agentA]++;
            l.losses[m.agentB]++;
        } else {
            m.winner = m.agentB;
            l.points[m.agentB] += 3;
            l.wins[m.agentB]++;
            l.losses[m.agentA]++;
        }

        m.resolved = true;
        m.state = MatchState.Resolved;

        emit LeagueMatchResolved(matchId, m.winner, isDraw);

        // Check if season is over
        _tryFinalizeLeague(m.leagueId);
    }

    function _tryFinalizeLeague(uint256 leagueId) internal {
        League storage l = leagues[leagueId];
        for (uint256 i = 0; i < l.matchIds.length; i++) {
            if (!matches[l.matchIds[i]].resolved) return; // Still pending
        }

        // All matches resolved — compute standings
        address first; address second; address third;
        uint256 p1; uint256 p2; uint256 p3;

        for (uint256 i = 0; i < l.participants.length; i++) {
            address agent = l.participants[i];
            uint256 pts = l.points[agent];

            if (pts >= p1) {
                third = second; p3 = p2;
                second = first; p2 = p1;
                first = agent; p1 = pts;
            } else if (pts >= p2) {
                third = second; p3 = p2;
                second = agent; p2 = pts;
            } else if (pts >= p3) {
                third = agent; p3 = pts;
            }
        }

        l.state = LeagueState.Completed;

        uint256 totalPot = l.stake * l.participants.length;
        uint256 fee = (totalPot * FEE_BPS) / 10000;
        uint256 remaining = totalPot - fee;

        if (fee > 0) payable(feeRecipient).transfer(fee);

        uint256 prize1 = (remaining * FIRST_BPS) / 10000;
        uint256 prize2 = (remaining * SECOND_BPS) / 10000;
        uint256 prize3 = remaining - prize1 - prize2;

        if (first != address(0)) payable(first).transfer(prize1);
        if (second != address(0)) payable(second).transfer(prize2);
        if (third != address(0)) payable(third).transfer(prize3);

        emit LeagueCompleted(leagueId, first, second, third);
    }

    function _isParticipant(League storage l, address addr) internal view returns (bool) {
        for (uint256 i = 0; i < l.participants.length; i++) {
            if (l.participants[i] == addr) return true;
        }
        return false;
    }

    function getLeaguePoints(uint256 leagueId, address agent) external view returns (
        uint256 points, uint256 w, uint256 l, uint256 d
    ) {
        League storage league = leagues[leagueId];
        return (league.points[agent], league.wins[agent], league.losses[agent], league.draws[agent]);
    }

    function getParticipants(uint256 leagueId) external view returns (address[] memory) {
        return leagues[leagueId].participants;
    }

    function getMatchIds(uint256 leagueId) external view returns (uint256[] memory) {
        return leagues[leagueId].matchIds;
    }
}
