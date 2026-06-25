// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@coti-io/coti-contracts/contracts/utils/mpc/MpcCore.sol";

/**
 * @title DuelManager
 * @notice Private AI agent performance competition on COTI.
 *
 * Privacy model:
 *   - Live PnL updates are submitted as itUint64 (coti-ethers encrypted).
 *     Neither the value nor the strategy curve is ever public on-chain.
 *   - Final resolution uses MpcCore.gt() on the encrypted values.
 *     Only the winner boolean is decrypted — actual PnL stays private.
 *   - No submitFinalPnL step: the last updateLivePnL before expiry
 *     IS the final value used in the Garbled Circuit comparison.
 */
contract DuelManager {

    enum DuelState { Open, Active, Resolved }

    struct Duel {
        address agentA;
        address agentB;
        uint256 stake;
        uint256 startTime;
        uint256 endTime;
        DuelState state;

        // Encrypted PnL — updated via updateLivePnL(), used directly by resolveDuel().
        // PnL encoded: (pnl_bps + 1e8) unsigned.
        // e.g. +5.23% → 52300 + 100000000 = 100052300
        //      -2.10% → -21000 + 100000000 = 99979000
        utUint64 agentAPnL;
        utUint64 agentBPnL;
        bool agentASubmitted;   // has called updateLivePnL at least once
        bool agentBSubmitted;

        address winner;
    }

    uint256 public duelCount;
    mapping(uint256 => Duel) public duels;

    // Timestamps only — tells the UI when each agent last updated (not what they submitted)
    mapping(uint256 => mapping(address => uint256)) public lastPnLUpdate;

    // Reputation
    mapping(address => uint256) public wins;
    mapping(address => uint256) public losses;
    mapping(address => uint256) public totalStakeWon;

    uint256 public constant FEE_BPS = 500; // 5%
    address public immutable feeRecipient;

    event DuelCreated(uint256 indexed duelId, address indexed agentA, uint256 stake, uint256 duration);
    event DuelJoined(uint256 indexed duelId, address indexed agentB);
    // No amount in this event — PnL stays private
    event LivePnLUpdated(uint256 indexed duelId, address indexed agent);
    event DuelResolved(uint256 indexed duelId, address indexed winner, uint256 prize);

    constructor(address _feeRecipient) {
        feeRecipient = _feeRecipient;
    }

    function createDuel(uint256 duration) external payable virtual returns (uint256 duelId) {
        require(msg.value > 0, "Stake required");
        require(duration >= 1 hours && duration <= 7 days, "Invalid duration");

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

        uint256 duration = duel.endTime;
        duel.agentB    = msg.sender;
        duel.startTime = block.timestamp;
        duel.endTime   = block.timestamp + duration;
        duel.state     = DuelState.Active;

        emit DuelJoined(duelId, msg.sender);
    }

    /**
     * @notice Submit (or update) encrypted live PnL.
     *         Must be called via coti-ethers: wallet.encryptValue(pnlUnsigned).
     *         Can be called multiple times during the duel — the LAST submission
     *         before expiry is used in the Garbled Circuit comparison.
     *         No plaintext value is ever stored or emitted.
     *
     * @param encPnl  itUint64 produced by coti-ethers wallet.encryptValue()
     *                encoding: pnl_bps + 100_000_000 (to ensure unsigned)
     */
    function updateLivePnL(uint256 duelId, itUint64 calldata encPnl) external {
        Duel storage duel = duels[duelId];
        require(duel.state == DuelState.Active, "Duel not active");
        require(msg.sender == duel.agentA || msg.sender == duel.agentB, "Not a participant");

        // Validate ciphertext — requires valid coti-ethers signature (not a replay)
        gtUint64 gt = MpcCore.validateCiphertext(encPnl);

        if (msg.sender == duel.agentA) {
            duel.agentAPnL      = MpcCore.offBoardCombined(gt, duel.agentA);
            duel.agentASubmitted = true;
        } else {
            duel.agentBPnL      = MpcCore.offBoardCombined(gt, duel.agentB);
            duel.agentBSubmitted = true;
        }

        lastPnLUpdate[duelId][msg.sender] = block.timestamp;
        emit LivePnLUpdated(duelId, msg.sender);
    }

    /**
     * @notice Resolve the duel via Garbled Circuit comparison.
     *         Callable by anyone once the duel has expired and both agents
     *         have submitted at least one encrypted PnL update.
     *         Only the winner boolean is decrypted — actual values stay private.
     */
    function resolveDuel(uint256 duelId) external {
        Duel storage duel = duels[duelId];
        require(duel.state == DuelState.Active, "Duel not active");
        require(block.timestamp >= duel.endTime, "Duel still running");
        require(duel.agentASubmitted && duel.agentBSubmitted, "Both agents must submit PnL");

        gtUint64 pnlA      = MpcCore.onBoard(duel.agentAPnL.ciphertext);
        gtUint64 pnlB      = MpcCore.onBoard(duel.agentBPnL.ciphertext);
        gtBool   aWinsBool = MpcCore.gt(pnlA, pnlB);
        bool     aWins     = MpcCore.decrypt(aWinsBool);

        address winner = aWins ? duel.agentA : duel.agentB;
        address loser  = aWins ? duel.agentB : duel.agentA;

        duel.winner = winner;
        duel.state  = DuelState.Resolved;

        wins[winner]++;
        losses[loser]++;

        uint256 totalStake = duel.stake * 2;
        uint256 fee        = (totalStake * FEE_BPS) / 10000;
        uint256 prize      = totalStake - fee;

        totalStakeWon[winner] += prize;

        if (fee > 0) payable(feeRecipient).transfer(fee);
        payable(winner).transfer(prize);

        emit DuelResolved(duelId, winner, prize);
    }

    /**
     * @notice Returns only update timestamps — not the PnL values (private).
     *         The UI can show "last updated X seconds ago" without revealing the value.
     */
    function getLivePnL(uint256 duelId) external view returns (
        int256  pnlA,      // always 0 — value is private
        int256  pnlB,      // always 0 — value is private
        uint256 updatedA,
        uint256 updatedB
    ) {
        Duel storage duel = duels[duelId];
        return (0, 0, lastPnLUpdate[duelId][duel.agentA], lastPnLUpdate[duelId][duel.agentB]);
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
        bool    agentBSubmitted
    ) {
        Duel storage d = duels[duelId];
        return (
            d.agentA, d.agentB, d.stake, d.startTime, d.endTime,
            uint8(d.state), d.winner, d.agentASubmitted, d.agentBSubmitted
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
            agentA: msg.sender,
            agentB: address(0),
            stake:  msg.value,
            startTime: 0,
            endTime:   duration,
            state:     DuelState.Open,
            agentAPnL: utUint64(ctUint64.wrap(0), ctUint64.wrap(0)),
            agentBPnL: utUint64(ctUint64.wrap(0), ctUint64.wrap(0)),
            agentASubmitted: false,
            agentBSubmitted: false,
            winner: address(0)
        });
    }
}
