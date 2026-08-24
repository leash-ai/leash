// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title DuelManager
 * @notice AI agent performance competition on COTI.
 *
 * Live PnL is public — spectators can watch duels in real-time.
 * Strategy stays private: it runs off-chain in the agent owner's rentalListener,
 * and positions never touch the chain.
 *
 * Resolution: the last updateLivePnL submitted before endTime is the final score.
 * Anyone can call resolveDuel() and earns a resolver bonus. Outcome depends on
 * who reported before endTime:
 *   both reported    → higher pnlBps wins
 *   one reported     → that agent wins by forfeit
 *   neither reported → no contest, both stakes refunded in full, no fee
 */
contract DuelManager {

    enum DuelState { Open, Active, Resolved }

    struct Duel {
        address   agentA;
        address   agentB;
        uint256   stake;
        uint256   createdAt;   // block.timestamp at creation — used by refundStuck
        uint256   startTime;
        uint256   endTime;
        DuelState state;
        int256    agentAPnL;
        int256    agentBPnL;
        bool      agentASubmitted;
        bool      agentBSubmitted;
        address   winner;
    }

    uint256 public duelCount;
    mapping(uint256 => Duel) public duels;

    // Last update timestamp per agent — UI shows "updated Xs ago"
    mapping(uint256 => mapping(address => uint256)) public lastPnLUpdate;

    // Reputation
    mapping(address => uint256) public wins;
    mapping(address => uint256) public losses;
    mapping(address => uint256) public totalStakeWon;

    uint256 public constant FEE_BPS          = 500;  // 5% total protocol fee
    uint256 public constant RESOLVER_FEE_BPS = 50;   // 0.5% to whoever calls resolveDuel
    uint256 public constant STUCK_TIMEOUT    = 24 hours;

    address public immutable feeRecipient;

    event DuelCreated(uint256 indexed duelId, address indexed agentA, uint256 stake, uint256 duration);
    event DuelJoined(uint256 indexed duelId, address indexed agentB);
    event LivePnLUpdated(uint256 indexed duelId, address indexed agent, int256 pnlBps);
    event DuelResolved(uint256 indexed duelId, address indexed winner, uint256 prize);
    event DuelRefunded(uint256 indexed duelId, address indexed agentA, uint256 amount);
    event DuelForfeited(uint256 indexed duelId, address indexed winner, address indexed loser);
    event DuelNoContest(uint256 indexed duelId, uint256 refundPerAgent);

    constructor(address _feeRecipient) {
        feeRecipient = _feeRecipient;
    }

    function createDuel(uint256 duration) external payable virtual returns (uint256 duelId) {
        require(msg.value > 0, "Stake required");
        require(duration >= 1 minutes && duration <= 7 days, "Invalid duration");

        duelId = ++duelCount;
        _initDuel(duelId, duration);
        emit DuelCreated(duelId, msg.sender, msg.value, duration);
    }

    function joinDuel(uint256 duelId) external payable {
        Duel storage duel = duels[duelId];
        require(duel.state == DuelState.Open, "Duel not open");
        require(duel.agentB == address(0), "Already joined");
        require(msg.sender != duel.agentA, "Cannot duel yourself");
        require(msg.value == duel.stake, "Wrong stake amount");

        uint256 duration = duel.endTime; // endTime holds raw duration before join
        duel.agentB    = msg.sender;
        duel.startTime = block.timestamp;
        duel.endTime   = block.timestamp + duration;
        duel.state     = DuelState.Active;

        emit DuelJoined(duelId, msg.sender);
    }

    /**
     * @notice Submit live PnL. Can be called multiple times — last value before
     *         expiry is the final score. Callable by agentA or agentB.
     *
     *         Submissions close at endTime. Scores are public, so accepting them
     *         after expiry would let an agent read its opponent's final score and
     *         overwrite its own to win.
     * @param pnlBps Performance in basis points (e.g. +523 = +5.23%, -210 = -2.10%)
     */
    function updateLivePnL(uint256 duelId, int256 pnlBps) external {
        Duel storage duel = duels[duelId];
        require(duel.state == DuelState.Active, "Duel not active");
        require(block.timestamp < duel.endTime, "Submissions closed");
        require(msg.sender == duel.agentA || msg.sender == duel.agentB, "Not a participant");

        if (msg.sender == duel.agentA) {
            duel.agentAPnL       = pnlBps;
            duel.agentASubmitted = true;
        } else {
            duel.agentBPnL       = pnlBps;
            duel.agentBSubmitted = true;
        }

        lastPnLUpdate[duelId][msg.sender] = block.timestamp;
        emit LivePnLUpdated(duelId, msg.sender, pnlBps);
    }

    /**
     * @notice Resolve the duel. Callable by anyone once expired.
     *         Caller earns RESOLVER_FEE_BPS (0.5%) of the total stake as a bonus.
     *
     *         Previously this required both agents to have submitted, which left
     *         no way to settle a duel where one agent went offline — resolveDuel
     *         reverted forever and refundStuck/cancelDuel only cover Open duels,
     *         so both stakes were locked permanently.
     *
     *         An agent that never reports did not compete, so it forfeits. If
     *         neither reported there is nothing to compare and both stakes are
     *         returned in full without a protocol fee.
     *
     *         No waiting period is needed: submissions close at endTime (see
     *         updateLivePnL), so the set of reporting agents is already final.
     */
    function resolveDuel(uint256 duelId) external {
        Duel storage duel = duels[duelId];
        require(duel.state == DuelState.Active, "Duel not active");
        require(block.timestamp >= duel.endTime, "Duel still running");

        duel.state = DuelState.Resolved;

        // Neither agent reported — no contest. Refund both stakes, charge nothing.
        if (!duel.agentASubmitted && !duel.agentBSubmitted) {
            uint256 refund = duel.stake;
            emit DuelNoContest(duelId, refund);
            payable(duel.agentA).transfer(refund);
            payable(duel.agentB).transfer(refund);
            return;
        }

        bool aWins;
        if (!duel.agentBSubmitted) {
            aWins = true;   // agentB never reported — agentA wins by forfeit
        } else if (!duel.agentASubmitted) {
            aWins = false;  // agentA never reported — agentB wins by forfeit
        } else {
            aWins = duel.agentAPnL > duel.agentBPnL;
        }

        address winner = aWins ? duel.agentA : duel.agentB;
        address loser  = aWins ? duel.agentB : duel.agentA;

        duel.winner = winner;

        if (!duel.agentASubmitted || !duel.agentBSubmitted) {
            emit DuelForfeited(duelId, winner, loser);
        }

        wins[winner]++;
        losses[loser]++;

        uint256 totalStake    = duel.stake * 2;
        uint256 resolverBonus = (totalStake * RESOLVER_FEE_BPS) / 10000;
        uint256 protocolFee   = (totalStake * FEE_BPS) / 10000 - resolverBonus;
        uint256 prize         = totalStake - protocolFee - resolverBonus;

        totalStakeWon[winner] += prize;

        if (protocolFee > 0) payable(feeRecipient).transfer(protocolFee);
        if (resolverBonus > 0) payable(msg.sender).transfer(resolverBonus);
        payable(winner).transfer(prize);

        emit DuelResolved(duelId, winner, prize);
    }

    /**
     * @notice Refund agentA if no one joined the duel within STUCK_TIMEOUT (24h).
     *         Protects renters from having their stake locked forever if the owner's
     *         daemon is offline.
     */
    function refundStuck(uint256 duelId) external {
        Duel storage duel = duels[duelId];
        require(duel.state == DuelState.Open, "Duel not open");
        require(block.timestamp > duel.createdAt + STUCK_TIMEOUT, "Wait 24h after creation");

        duel.state = DuelState.Resolved;

        uint256 amount = duel.stake;
        emit DuelRefunded(duelId, duel.agentA, amount);
        payable(duel.agentA).transfer(amount);
    }

    function getLivePnL(uint256 duelId) external view returns (
        int256  pnlA,
        int256  pnlB,
        uint256 updatedA,
        uint256 updatedB
    ) {
        Duel storage duel = duels[duelId];
        return (
            duel.agentAPnL,
            duel.agentBPnL,
            lastPnLUpdate[duelId][duel.agentA],
            lastPnLUpdate[duelId][duel.agentB]
        );
    }

    function getDuel(uint256 duelId) external view returns (
        address agentA,
        address agentB,
        uint256 stake,
        uint256 startTime,
        uint256 endTime,
        uint8   state,
        address winner,
        bool    agentASubmitted,
        bool    agentBSubmitted,
        uint256 createdAt
    ) {
        Duel storage d = duels[duelId];
        return (
            d.agentA, d.agentB, d.stake, d.startTime, d.endTime,
            uint8(d.state), d.winner, d.agentASubmitted, d.agentBSubmitted, d.createdAt
        );
    }

    function getAgentStats(address agent) external view returns (
        uint256 agentWins,
        uint256 agentLosses,
        uint256 stakeWon
    ) {
        return (wins[agent], losses[agent], totalStakeWon[agent]);
    }

    function cancelDuel(uint256 duelId) external {
        Duel storage duel = duels[duelId];
        require(duel.state == DuelState.Open, "Can only cancel open duels");
        require(msg.sender == duel.agentA, "Only creator can cancel");
        duel.state = DuelState.Resolved;
        payable(duel.agentA).transfer(duel.stake);
    }

    function _initDuel(uint256 duelId, uint256 duration) internal {
        duels[duelId] = Duel({
            agentA:          msg.sender,
            agentB:          address(0),
            stake:           msg.value,
            createdAt:       block.timestamp,
            startTime:       0,
            endTime:         duration,
            state:           DuelState.Open,
            agentAPnL:       0,
            agentBPnL:       0,
            agentASubmitted: false,
            agentBSubmitted: false,
            winner:          address(0)
        });
    }
}
