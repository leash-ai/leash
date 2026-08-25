// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@coti-io/coti-contracts/contracts/utils/mpc/MpcCore.sol";

/**
 * @title DuelManager
 * @notice AI agent performance competition on COTI.
 *
 * Strategy stays private: it runs off-chain in the agent owner's daemon, and
 * positions, allocations and strategy logic never touch the chain.
 *
 * The aggregate PnL curve IS public — that is the spectator experience, and it
 * is a deliberate choice, not an oversight. What COTI protects here is the
 * settlement step: both agents submit their final score encrypted, and the
 * winner is decided by a garbled-circuit comparison that never decrypts either
 * operand on-chain.
 *
 * Because the live feed is public, an agent could otherwise read its opponent's
 * last reported score and encrypt one basis point higher — the same cheat that
 * an endTime bound closes for the plaintext feed, but invisible. So a final
 * submission is pinned in-circuit to that agent's own last public value
 * (MpcCore.eq); it cannot settle on a number it never reported.
 *
 * Timeline:
 *   join → endTime          live PnL accepted, public, last value wins
 *   endTime → +finalWindow() encrypted final PnL accepted, pinned to last live
 *   after that window      resolveDuel(), anyone, earns a resolver bonus
 *
 * Outcome depends on who submitted an encrypted final:
 *   both     → garbled-circuit comparison, higher score wins
 *   one      → that agent wins by forfeit
 *   neither  → no contest, both stakes refunded in full, no fee
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

        // Encrypted final scores. offBoardCombined stores the network ciphertext
        // (used by onBoard at resolution) plus a copy under the agent's own AES
        // key, so an agent can read back its own score and nobody else's.
        utUint64  finalPnlA;
        utUint64  finalPnlB;
        bool      finalASubmitted;
        bool      finalBSubmitted;
    }

    uint256 public duelCount;
    // Internal, not public: the struct carries two nested utUint64 values, and
    // Solidity's generated getter for a public mapping returns every member —
    // which no longer fits the stack. Use getDuel() / getFinalPnLStatus(); no
    // caller in this repo used duels() directly.
    mapping(uint256 => Duel) internal duels;

    // Last update timestamp per agent — UI shows "updated Xs ago"
    mapping(uint256 => mapping(address => uint256)) public lastPnLUpdate;

    // duelId => delegate => the participant it settles for.
    //
    // A participant that cannot sign an input text itself — AgentMarketplace is
    // agentA in every rented duel — names an address that settles on its behalf.
    // The delegate calls submitFinalPnL directly, so the ciphertext it submits is
    // validated against its own signature; the score is still pinned to the live
    // PnL recorded for the participant. A proxied input text is not an option:
    // MpcCore.validateCiphertext binds the signature to the immediate caller, so
    // a contract forwarding a user's ciphertext always reverts.
    mapping(uint256 => mapping(address => address)) public settlementDelegate;

    // Reputation
    mapping(address => uint256) public wins;
    mapping(address => uint256) public losses;
    mapping(address => uint256) public totalStakeWon;

    uint256 public constant FEE_BPS          = 500;  // 5% total protocol fee
    uint256 public constant RESOLVER_FEE_BPS = 50;   // 0.5% to whoever calls resolveDuel
    uint256 public constant STUCK_TIMEOUT    = 24 hours;


    // Garbled ints are unsigned, so PnL is offset before encryption. Matches
    // calculatePnLBps() in agent/strategies/*.ts.
    int256 public constant PNL_OFFSET  = 100_000_000;

    // Bounds live PnL so pnlBps + PNL_OFFSET is always a non-negative value that
    // fits uint64 — without this a nonsense report could make the offset
    // encoding revert or wrap at settlement time.
    int256 public constant PNL_MIN_BPS = -100_000_000;
    int256 public constant PNL_MAX_BPS =  100_000_000;

    address public immutable feeRecipient;

    event DuelCreated(uint256 indexed duelId, address indexed agentA, uint256 stake, uint256 duration);
    event DuelJoined(uint256 indexed duelId, address indexed agentB);
    event LivePnLUpdated(uint256 indexed duelId, address indexed agent, int256 pnlBps);
    event DuelResolved(uint256 indexed duelId, address indexed winner, uint256 prize);
    event DuelRefunded(uint256 indexed duelId, address indexed agentA, uint256 amount);
    event DuelForfeited(uint256 indexed duelId, address indexed winner, address indexed loser);
    event DuelNoContest(uint256 indexed duelId, uint256 refundPerAgent);
    event FinalPnLSubmitted(uint256 indexed duelId, address indexed agent);
    event SettlementDelegateSet(uint256 indexed duelId, address indexed principal, address indexed delegate);

    constructor(address _feeRecipient) {
        feeRecipient = _feeRecipient;
    }

    /**
     * @notice How long after endTime encrypted final scores are accepted.
     * @dev    A function rather than a constant so TestDuelManager can shorten it
     *         — an on-chain e2e cannot wait an hour per duel. Everything that
     *         needs the window reads it here, so there is one source of truth.
     */
    function finalWindow() public view virtual returns (uint256) {
        return 1 hours;
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
        require(pnlBps >= PNL_MIN_BPS && pnlBps <= PNL_MAX_BPS, "PnL out of range");

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
     * @notice Name an address that may settle this duel on the caller's behalf.
     *         Callable by either participant while the duel is open or running.
     *
     *         This exists because MpcCore.validateCiphertext binds an input text
     *         to the immediate caller. A contract participant cannot hold an AES
     *         key or sign an input text, and it cannot forward one signed by a
     *         user either — the precompile rejects it. So the user settles
     *         directly and this records who they are settling for.
     *
     *         The delegate cannot choose the score: submitFinalPnL still pins it
     *         to the live PnL recorded for the participant, which only the
     *         participant could write.
     */
    function setSettlementDelegate(uint256 duelId, address delegate) external {
        Duel storage duel = duels[duelId];
        require(duel.state != DuelState.Resolved, "Duel resolved");
        require(msg.sender == duel.agentA || msg.sender == duel.agentB, "Not a participant");
        require(delegate != address(0), "Zero delegate");

        settlementDelegate[duelId][delegate] = msg.sender;
        emit SettlementDelegateSet(duelId, msg.sender, delegate);
    }

    /**
     * @notice Submit the encrypted final score. Accepted only in the window after
     *         endTime, once per agent, and only from an agent that reported live
     *         PnL during the duel.
     *
     *         The value is pinned in-circuit to that agent's own last public
     *         report. Without the pin, a public live feed plus a private final
     *         submission would let an agent settle on its opponent's score plus
     *         one, and the ciphertext would hide that it had done so.
     *
     * @param encryptedPnL itUint64 holding (pnlBps + PNL_OFFSET), encrypted
     *        client-side for this contract address and this function selector.
     */
    function submitFinalPnL(uint256 duelId, itUint64 calldata encryptedPnL) external {
        Duel storage duel = duels[duelId];
        require(duel.state == DuelState.Active, "Duel not active");
        require(block.timestamp >= duel.endTime, "Duel still running");
        require(block.timestamp < duel.endTime + finalWindow(), "Final window closed");

        // Who this settlement is for. Normally the caller; for a duel whose
        // participant is a contract, the delegate it named. Either way the
        // ciphertext below is validated against msg.sender's own signature.
        address principal = msg.sender;
        if (msg.sender != duel.agentA && msg.sender != duel.agentB) {
            principal = settlementDelegate[duelId][msg.sender];
            require(principal != address(0), "Not a participant");
        }

        bool isA = principal == duel.agentA;
        require(isA ? duel.agentASubmitted : duel.agentBSubmitted, "No live PnL to settle");
        require(!(isA ? duel.finalASubmitted : duel.finalBSubmitted), "Already submitted");

        gtUint64 gtPnL = MpcCore.validateCiphertext(encryptedPnL);

        // Pin the encrypted score to this agent's last public report. Bounded by
        // PNL_MIN_BPS/PNL_MAX_BPS in updateLivePnL, so the offset encoding is a
        // non-negative value that fits uint64.
        int256 livePnl  = isA ? duel.agentAPnL : duel.agentBPnL;
        uint64 expected = uint64(uint256(livePnl + PNL_OFFSET));
        require(
            MpcCore.decrypt(MpcCore.eq(gtPnL, expected)),
            "Final PnL must match last live PnL"
        );

        // Off-board the user copy to whoever actually submitted: a contract
        // participant has no AES key, so keying it to the participant would make
        // the readback useless. The network ciphertext, which resolution uses, is
        // unaffected either way.
        if (isA) {
            duel.finalPnlA       = MpcCore.offBoardCombined(gtPnL, msg.sender);
            duel.finalASubmitted = true;
        } else {
            duel.finalPnlB       = MpcCore.offBoardCombined(gtPnL, msg.sender);
            duel.finalBSubmitted = true;
        }

        emit FinalPnLSubmitted(duelId, principal);
    }

    /**
     * @notice Resolve the duel. Callable by anyone once the final-submission
     *         window has closed. Caller earns RESOLVER_FEE_BPS (0.5%) of the
     *         total stake as a bonus.
     *
     *         Settlement runs on the encrypted final scores, so it waits for
     *         finalWindow() rather than for endTime.
     *
     *         An agent that never settled did not finish the duel, so it
     *         forfeits. If neither settled there is nothing to compare and both
     *         stakes are returned in full without a protocol fee — that refund is
     *         the reason no duel can end with its stakes stuck, whatever the
     *         agents do or fail to do.
     */
    function resolveDuel(uint256 duelId) external {
        Duel storage duel = duels[duelId];
        require(duel.state == DuelState.Active, "Duel not active");
        require(block.timestamp >= duel.endTime + finalWindow(), "Final window open");

        duel.state = DuelState.Resolved;

        // Neither agent settled — no contest. Refund both stakes, charge nothing.
        if (!duel.finalASubmitted && !duel.finalBSubmitted) {
            uint256 refund = duel.stake;
            emit DuelNoContest(duelId, refund);
            payable(duel.agentA).transfer(refund);
            payable(duel.agentB).transfer(refund);
            return;
        }

        bool aWins;
        if (!duel.finalBSubmitted) {
            aWins = true;   // agentB never settled — agentA wins by forfeit
        } else if (!duel.finalASubmitted) {
            aWins = false;  // agentA never settled — agentB wins by forfeit
        } else {
            aWins = _comparePnL(duel);
        }

        address winner = aWins ? duel.agentA : duel.agentB;
        address loser  = aWins ? duel.agentB : duel.agentA;

        duel.winner = winner;

        if (!duel.finalASubmitted || !duel.finalBSubmitted) {
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

    /**
     * @notice Compare the two encrypted final scores and return true if agentA
     *         won. The garbled circuit decides the winner; neither operand is
     *         decrypted, only the one-bit result.
     * @dev    virtual so TestDuelManager can settle with a plaintext comparison
     *         on the local Hardhat network, which has no MPC precompile. The
     *         encrypted submission path itself is deliberately not overridable.
     */
    function _comparePnL(Duel storage duel) internal virtual returns (bool aWins) {
        gtUint64 pnlA = MpcCore.onBoard(duel.finalPnlA.ciphertext);
        gtUint64 pnlB = MpcCore.onBoard(duel.finalPnlB.ciphertext);
        return MpcCore.decrypt(MpcCore.gt(pnlA, pnlB));
    }

    /**
     * @notice Settlement progress for a duel. Kept separate from getDuel() so
     *         that function's signature stays stable for existing consumers.
     */
    function getFinalPnLStatus(uint256 duelId) external view returns (
        bool    agentASettled,
        bool    agentBSettled,
        uint256 windowClosesAt
    ) {
        Duel storage d = duels[duelId];
        return (d.finalASubmitted, d.finalBSubmitted, d.endTime + finalWindow());
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

    /**
     * @dev Writes the four fields a new duel needs. Assigns to storage field by
     *      field rather than building a Duel literal: the struct now carries two
     *      nested utUint64 values, and a memory literal of it does not fit the
     *      stack. Every other field is zero for a fresh duelId, and the zero
     *      utUint64 is exactly the pair of wrapped zeroes a literal would write.
     */
    function _initDuel(uint256 duelId, uint256 duration) internal {
        Duel storage duel = duels[duelId];
        duel.agentA    = msg.sender;
        duel.stake     = msg.value;
        duel.createdAt = block.timestamp;
        duel.endTime   = duration;   // holds the raw duration until someone joins
        duel.state     = DuelState.Open;
    }
}
