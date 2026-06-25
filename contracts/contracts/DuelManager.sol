// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@coti-io/coti-contracts/contracts/utils/mpc/MpcCore.sol";

/**
 * @title DuelManager
 * @notice Private AI agent performance competition on COTI
 * @dev Two agents compete with private strategies. Final PnL compared via Garbled Circuits.
 *      Winner takes the combined stake. Strategies never revealed.
 */
contract DuelManager {

    enum DuelState { Open, Active, PendingResolution, Resolved }

    struct Duel {
        address agentA;
        address agentB;
        uint256 stake;          // ETH staked per agent
        uint256 startTime;
        uint256 endTime;
        DuelState state;

        // Encrypted final PnL submitted by each agent (GC comparison)
        // PnL encoded as: (pnl_percent * 10000) + 1e8 to ensure unsigned
        // e.g. +5.23% -> 52300 + 100000000 = 100052300
        //      -2.10% -> -21000 + 100000000 = 99979000
        utUint64 agentAPnL;
        utUint64 agentBPnL;
        bool agentASubmitted;
        bool agentBSubmitted;

        address winner;
    }

    uint256 public duelCount;
    mapping(uint256 => Duel) public duels;

    // Public PnL self-reported by agents for live display (not verified, for UX only)
    // Stored as basis points: 10000 = 100%, -500 = -5%
    mapping(uint256 => mapping(address => int256)) public livePnL;
    mapping(uint256 => mapping(address => uint256)) public lastPnLUpdate;
    mapping(uint256 => int256[]) public pnlHistoryA;
    mapping(uint256 => int256[]) public pnlHistoryB;

    // Reputation: wins per agent address
    mapping(address => uint256) public wins;
    mapping(address => uint256) public losses;
    mapping(address => uint256) public totalStakeWon;

    // Protocol fee: 5%
    uint256 public constant FEE_BPS = 500;
    address public immutable feeRecipient;

    event DuelCreated(uint256 indexed duelId, address indexed agentA, uint256 stake, uint256 duration);
    event DuelJoined(uint256 indexed duelId, address indexed agentB);
    event PnLUpdated(uint256 indexed duelId, address indexed agent, int256 pnlBps);
    event PnLSubmitted(uint256 indexed duelId, address indexed agent);
    event DuelResolved(uint256 indexed duelId, address indexed winner, uint256 prize);

    constructor(address _feeRecipient) {
        feeRecipient = _feeRecipient;
    }

    /**
     * @notice Create a new duel. Caller is agent A. Send stake as msg.value.
     * @param duration Duration in seconds (min 1 hour, max 7 days)
     */
    function createDuel(uint256 duration) external payable returns (uint256 duelId) {
        require(msg.value > 0, "Stake required");
        require(duration >= 1 hours && duration <= 7 days, "Invalid duration");

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

        // Store duration temporarily in endTime field until duel starts
        duels[duelId].endTime = duration;

        emit DuelCreated(duelId, msg.sender, msg.value, duration);
    }

    /**
     * @notice Join an open duel as agent B. Must send equal stake.
     */
    function joinDuel(uint256 duelId) external payable {
        Duel storage duel = duels[duelId];
        require(duel.state == DuelState.Open, "Duel not open");
        require(duel.agentB == address(0), "Already joined");
        require(msg.sender != duel.agentA, "Cannot duel yourself");
        require(msg.value == duel.stake, "Wrong stake amount");

        uint256 duration = duel.endTime;
        duel.agentB = msg.sender;
        duel.startTime = block.timestamp;
        duel.endTime = block.timestamp + duration;
        duel.state = DuelState.Active;

        emit DuelJoined(duelId, msg.sender);
    }

    /**
     * @notice Agents self-report their current public PnL for live display.
     * @dev NOT verified on-chain. Used only for real-time UX. In basis points (10000 = 100%).
     */
    function updateLivePnL(uint256 duelId, int256 pnlBps) external {
        Duel storage duel = duels[duelId];
        require(duel.state == DuelState.Active, "Duel not active");
        require(msg.sender == duel.agentA || msg.sender == duel.agentB, "Not a participant");

        livePnL[duelId][msg.sender] = pnlBps;
        lastPnLUpdate[duelId][msg.sender] = block.timestamp;

        if (msg.sender == duel.agentA) {
            pnlHistoryA[duelId].push(pnlBps);
        } else {
            pnlHistoryB[duelId].push(pnlBps);
        }

        emit PnLUpdated(duelId, msg.sender, pnlBps);
    }

    /**
     * @notice Submit encrypted final PnL for Garbled Circuit comparison.
     * @dev Called after duel ends. PnL encoded as (pnl_bps + 1e8) to ensure unsigned.
     *      e.g. +523 bps -> 100000523, -210 bps -> 99999790
     */
    function submitFinalPnL(uint256 duelId, itUint64 calldata encryptedPnL) external {
        Duel storage duel = duels[duelId];
        require(block.timestamp >= duel.endTime, "Duel still active");
        require(duel.state == DuelState.Active || duel.state == DuelState.PendingResolution, "Invalid state");
        require(msg.sender == duel.agentA || msg.sender == duel.agentB, "Not a participant");

        gtUint64 gtPnL = MpcCore.validateCiphertext(encryptedPnL);

        if (msg.sender == duel.agentA) {
            require(!duel.agentASubmitted, "Already submitted");
            duel.agentAPnL = MpcCore.offBoardCombined(gtPnL, duel.agentA);
            duel.agentASubmitted = true;
        } else {
            require(!duel.agentBSubmitted, "Already submitted");
            duel.agentBPnL = MpcCore.offBoardCombined(gtPnL, duel.agentB);
            duel.agentBSubmitted = true;
        }

        duel.state = DuelState.PendingResolution;

        emit PnLSubmitted(duelId, msg.sender);
    }

    /**
     * @notice Resolve the duel using Garbled Circuit comparison.
     * @dev Compares encrypted PnL values via MpcCore.gt without revealing them.
     *      Anyone can call this once both agents have submitted.
     */
    function resolveDuel(uint256 duelId) external {
        Duel storage duel = duels[duelId];
        require(duel.state == DuelState.PendingResolution, "Not ready to resolve");
        require(duel.agentASubmitted && duel.agentBSubmitted, "Both must submit PnL");

        // Load encrypted PnL values into GC context
        gtUint64 pnlA = MpcCore.onBoard(duel.agentAPnL.ciphertext);
        gtUint64 pnlB = MpcCore.onBoard(duel.agentBPnL.ciphertext);

        // Garbled Circuit comparison: does A have higher PnL than B?
        gtBool agentAWins = MpcCore.gt(pnlA, pnlB);

        // Decrypt the winner determination (boolean result is fine to reveal)
        bool aWins = MpcCore.decrypt(agentAWins);

        address winner = aWins ? duel.agentA : duel.agentB;
        address loser = aWins ? duel.agentB : duel.agentA;

        duel.winner = winner;
        duel.state = DuelState.Resolved;

        // Update reputation
        wins[winner]++;
        losses[loser]++;

        // Calculate prize (total stake minus 5% fee)
        uint256 totalStake = duel.stake * 2;
        uint256 fee = (totalStake * FEE_BPS) / 10000;
        uint256 prize = totalStake - fee;

        totalStakeWon[winner] += prize;

        // Pay fee
        if (fee > 0) {
            payable(feeRecipient).transfer(fee);
        }

        // Pay winner
        payable(winner).transfer(prize);

        emit DuelResolved(duelId, winner, prize);
    }

    /**
     * @notice Get live PnL for both agents in a duel.
     */
    function getLivePnL(uint256 duelId) external view returns (
        int256 pnlA,
        int256 pnlB,
        uint256 updatedA,
        uint256 updatedB
    ) {
        Duel storage duel = duels[duelId];
        pnlA = livePnL[duelId][duel.agentA];
        pnlB = livePnL[duelId][duel.agentB];
        updatedA = lastPnLUpdate[duelId][duel.agentA];
        updatedB = lastPnLUpdate[duelId][duel.agentB];
    }

    /**
     * @notice Get PnL history for charting.
     */
    function getPnLHistory(uint256 duelId) external view returns (
        int256[] memory historyA,
        int256[] memory historyB
    ) {
        historyA = pnlHistoryA[duelId];
        historyB = pnlHistoryB[duelId];
    }

    /**
     * @notice Get full duel info.
     */
    function getDuel(uint256 duelId) external view returns (
        address agentA,
        address agentB,
        uint256 stake,
        uint256 startTime,
        uint256 endTime,
        uint8 state,
        address winner,
        bool agentASubmitted,
        bool agentBSubmitted
    ) {
        Duel storage d = duels[duelId];
        return (
            d.agentA,
            d.agentB,
            d.stake,
            d.startTime,
            d.endTime,
            uint8(d.state),
            d.winner,
            d.agentASubmitted,
            d.agentBSubmitted
        );
    }

    /**
     * @notice Get agent stats for leaderboard.
     */
    function getAgentStats(address agent) external view returns (
        uint256 agentWins,
        uint256 agentLosses,
        uint256 stakeWon
    ) {
        return (wins[agent], losses[agent], totalStakeWon[agent]);
    }

    /**
     * @notice Allow agentA to cancel an unjoined duel and reclaim stake.
     */
    function cancelDuel(uint256 duelId) external {
        Duel storage duel = duels[duelId];
        require(duel.state == DuelState.Open, "Can only cancel open duels");
        require(msg.sender == duel.agentA, "Only creator can cancel");

        duel.state = DuelState.Resolved;
        payable(duel.agentA).transfer(duel.stake);
    }
}
