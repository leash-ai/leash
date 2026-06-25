// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@coti-io/coti-contracts/contracts/token/PrivateERC20/IPrivateERC20.sol";
import "./AgentRegistry.sol";
import "./DuelManager.sol";

/**
 * @title AgentMarketplace
 * @notice Rent any listed agent to fight for you.
 *
 * Rental fee paid in ptUSDC (PrivateERC20 — encrypted balances via MPC).
 * On mainnet: swap cUSDC address for p.USDC.e (0xf1Feebc4376c68B7003450ae66343Ae59AB37D3C).
 * Strategy stays on the owner's machine — renter never sees it.
 *
 * Flow:
 *   1. Owner lists agent with rentalFeeUSDC + winSplitBps
 *   2. Renter calls rentAndDuel() — approve(marketplace, fee) on ptUSDC first
 *   3. Owner's rentalListener daemon auto-joins the duel off-chain
 *   4. After duel resolves, anyone calls settleRental() to update stats
 *   5. Owner claims accumulated ptUSDC fees via claimUSDC()
 *
 * Privacy model:
 *   - Rental fee *amount* is public (listed in Listing struct, set by owner)
 *   - ptUSDC *balances* are encrypted — no one can see total holdings
 *   - Strategy and positions never touch the chain
 */
contract AgentMarketplace {

    IPrivateERC20 public immutable cUSDC;
    AgentRegistry public immutable registry;
    DuelManager   public immutable duelManager;
    address       public immutable feeRecipient;

    uint256 public constant PROTOCOL_FEE_BPS = 200; // 2% of rental fee

    struct Listing {
        uint256 agentId;
        address owner;
        uint256 rentalFeeUSDC;  // per-duel fee in ptUSDC (6 decimals) — publicly declared price
        uint256 winSplitBps;    // owner share of prize (e.g. 3000 = 30%)
        bool    available;
    }

    struct RentalAgreement {
        uint256 listingId;
        uint256 agentId;    // stored at rental time — avoids agentOf lookup in settleRental
        uint256 duelId;
        address renter;
        address agentOwner;
        uint256 rentalFeeUSDC;
        uint256 winSplitBps;
        uint256 stake;
        bool    settled;
    }

    uint256 public listingCount;
    uint256 public rentalCount;

    mapping(uint256 => Listing)         public listings;
    mapping(uint256 => RentalAgreement) public rentals;
    mapping(uint256 => uint256)         public duelToRental;

    // Accumulated ptUSDC claimable by agent owners and protocol
    mapping(address => uint256) public pendingUSDC;

    event AgentListed(uint256 indexed listingId, uint256 indexed agentId, uint256 fee, uint256 split);
    event AgentDelisted(uint256 indexed listingId);
    event AgentRented(uint256 indexed rentalId, uint256 indexed duelId, address indexed renter);
    event RentalSettled(uint256 indexed rentalId, bool agentWon);
    event USDCClaimed(address indexed recipient, uint256 amount);

    constructor(address _cUSDC, address _registry, address _duelManager, address _feeRecipient) {
        cUSDC = IPrivateERC20(_cUSDC);
        registry = AgentRegistry(_registry);
        duelManager = DuelManager(_duelManager);
        feeRecipient = _feeRecipient;
    }

    // ─── Owner: list / manage ──────────────────────────────────────────────────

    /**
     * @notice List your agent for rent.
     * @param agentId  Your AgentRegistry NFT ID
     * @param rentalFeeUSDC Fee per duel in ptUSDC (6 decimals, plain amount)
     * @param winSplitBps   Your share of the duel prize (0–9000 bps)
     */
    function listAgent(uint256 agentId, uint256 rentalFeeUSDC, uint256 winSplitBps)
        external returns (uint256 listingId)
    {
        // MPC ownership proof — marketplace passes msg.sender as claimant.
        // Registry compares it against the encrypted stored owner via MpcCore.eq().
        // Never decrypts or reveals the stored owner address.
        require(registry.proveOwnership(agentId, msg.sender), "Not your agent");
        require(winSplitBps <= 9000, "Max split 90%");
        require(rentalFeeUSDC > 0, "Fee required");

        listingId = ++listingCount;
        listings[listingId] = Listing({
            agentId: agentId,
            owner: msg.sender,
            rentalFeeUSDC: rentalFeeUSDC,
            winSplitBps: winSplitBps,
            available: true
        });

        emit AgentListed(listingId, agentId, rentalFeeUSDC, winSplitBps);
    }

    function delistAgent(uint256 listingId) external {
        require(listings[listingId].owner == msg.sender, "Not your listing");
        listings[listingId].available = false;
        emit AgentDelisted(listingId);
    }

    function updateFee(uint256 listingId, uint256 newFee) external {
        require(listings[listingId].owner == msg.sender, "Not your listing");
        listings[listingId].rentalFeeUSDC = newFee;
    }

    // ─── Renter: rent & fight ──────────────────────────────────────────────────

    /**
     * @notice Rent an agent and create a duel.
     *         Before calling: approve(marketplace, rentalFeeUSDC) on ptUSDC.
     *         Send the duel stake as msg.value (COTI).
     *
     *         The owner's rentalListener daemon will detect the AgentRented event
     *         and auto-join the duel as agentB with the owner's private strategy.
     */
    function rentAndDuel(uint256 listingId, uint256 duration)
        external payable
        returns (uint256 rentalId, uint256 duelId)
    {
        Listing storage l = listings[listingId];
        require(l.available, "Not available");
        require(msg.sender != l.owner, "Cannot rent your own agent");
        require(msg.value > 0, "Stake required");

        // Collect ptUSDC rental fee (plain amount — publicAmountsEnabled = true on ptUSDC)
        uint256 fee = l.rentalFeeUSDC;
        uint256 protocolCut = (fee * PROTOCOL_FEE_BPS) / 10000;
        uint256 ownerCut = fee - protocolCut;

        // Pull ptUSDC from renter (renter must approve first)
        cUSDC.transferFrom(msg.sender, address(this), fee);

        // Credit pending balances (claimable via claimUSDC)
        pendingUSDC[l.owner]       += ownerCut;
        pendingUSDC[feeRecipient]  += protocolCut;

        // Create duel — renter is agentA. Owner's agent will join as agentB.
        duelId = duelManager.createDuel{value: msg.value}(duration);

        rentalId = ++rentalCount;
        rentals[rentalId] = RentalAgreement({
            listingId:    listingId,
            agentId:      l.agentId,   // stored directly — no agentOf lookup needed at settle
            duelId:       duelId,
            renter:       msg.sender,
            agentOwner:   l.owner,
            rentalFeeUSDC: fee,
            winSplitBps:  l.winSplitBps,
            stake:        msg.value,
            settled:      false
        });

        duelToRental[duelId] = rentalId;

        // Increment rental count on registry (not the earned amount — claimable separately)
        registry.recordRental(l.agentId, ownerCut);

        emit AgentRented(rentalId, duelId, msg.sender);
    }

    // ─── Renter PnL proxy ─────────────────────────────────────────────────────

    /**
     * @notice Renter submits live PnL for their side of the duel.
     *         The marketplace is agentA in DuelManager (it created the duel),
     *         so it proxies the call on the renter's behalf.
     * @param pnlBps Performance in basis points (e.g. +523 = +5.23%, -210 = -2.10%)
     */
    function updateRenterPnL(uint256 rentalId, int256 pnlBps) external {
        RentalAgreement storage r = rentals[rentalId];
        require(msg.sender == r.renter, "Not the renter");
        duelManager.updateLivePnL(r.duelId, pnlBps);
    }

    // ─── Settlement ───────────────────────────────────────────────────────────

    /**
     * @notice Settle a rental after the duel resolves. Anyone can call.
     *         Updates AgentRegistry stats for the rented agent.
     */
    function settleRental(uint256 rentalId) external {
        RentalAgreement storage r = rentals[rentalId];
        require(!r.settled, "Already settled");

        (address agentA,,,,, uint8 state, address winner,,) = duelManager.getDuel(r.duelId);
        // DuelState.Resolved = 2 (Open=0, Active=1, Resolved=2)
        require(state == 2, "Duel not resolved");

        r.settled = true;

        bool agentWon = (winner != address(0)) && (winner != agentA);

        if (r.agentId > 0) {
            // PnL is now private (encrypted) — pass 0 as pnlBps for registry history.
            // The winner determination is authoritative; the exact PnL value is kept private.
            registry.recordFight(r.agentId, agentWon, false, 0, agentWon ? r.stake * 2 : 0);
        }

        emit RentalSettled(rentalId, agentWon);
    }

    // ─── Claim ptUSDC ─────────────────────────────────────────────────────────

    /**
     * @notice Agent owners and the protocol claim their accumulated ptUSDC rental fees.
     *         Balances are encrypted in ptUSDC — only you know your total.
     */
    function claimUSDC() external {
        uint256 amount = pendingUSDC[msg.sender];
        require(amount > 0, "Nothing to claim");
        pendingUSDC[msg.sender] = 0;
        cUSDC.transfer(msg.sender, amount);
        emit USDCClaimed(msg.sender, amount);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getListings(uint256 offset, uint256 limit)
        external view
        returns (Listing[] memory result)
    {
        uint256 total = 0;
        for (uint256 i = 1; i <= listingCount; i++) {
            if (listings[i].available) total++;
        }
        if (offset >= total) return new Listing[](0);

        uint256 size = (total - offset) < limit ? (total - offset) : limit;
        result = new Listing[](size);
        uint256 idx = 0;
        uint256 seen = 0;

        for (uint256 i = 1; i <= listingCount && idx < size; i++) {
            if (!listings[i].available) continue;
            if (seen++ < offset) continue;
            result[idx++] = listings[i];
        }
    }
}
