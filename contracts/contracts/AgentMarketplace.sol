// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./AgentRegistry.sol";
import "./DuelManager.sol";

/**
 * @title AgentMarketplace
 * @notice Rent any listed agent to fight for you.
 *
 * Rental fee paid in cUSDC (p.USDC.e on mainnet, MockUSDC on testnet).
 * Strategy stays on the owner's machine — renter never sees it.
 *
 * Flow:
 *   1. Owner lists agent with rentalFeeUSDC + winSplitBps
 *   2. Renter calls rentAndDuel() — approves cUSDC first, sends COTI stake as msg.value
 *   3. Owner's agent runs autonomously off-chain with its private strategy
 *   4. After duel resolves, renter calls settleRental() to update on-chain stats
 *   5. Owner claims accumulated cUSDC fees via claimUSDC()
 */
contract AgentMarketplace {
    using SafeERC20 for IERC20;

    IERC20        public immutable cUSDC;
    AgentRegistry public immutable registry;
    DuelManager   public immutable duelManager;
    address       public immutable feeRecipient;

    uint256 public constant PROTOCOL_FEE_BPS = 200; // 2% of rental fee

    struct Listing {
        uint256 agentId;
        address owner;
        uint256 rentalFeeUSDC;  // per-duel fee in cUSDC (6 decimals)
        uint256 winSplitBps;    // owner share of prize (e.g. 3000 = 30%)
        bool    available;
    }

    struct RentalAgreement {
        uint256 listingId;
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
    mapping(address => uint256)         public pendingUSDC;

    event AgentListed(uint256 indexed listingId, uint256 indexed agentId, uint256 fee, uint256 split);
    event AgentDelisted(uint256 indexed listingId);
    event AgentRented(uint256 indexed rentalId, uint256 indexed duelId, address indexed renter);
    event RentalSettled(uint256 indexed rentalId, bool agentWon);

    constructor(address _cUSDC, address _registry, address _duelManager, address _feeRecipient) {
        cUSDC = IERC20(_cUSDC);
        registry = AgentRegistry(_registry);
        duelManager = DuelManager(_duelManager);
        feeRecipient = _feeRecipient;
    }

    // ─── Owner: list / manage ──────────────────────────────────────────────────

    function listAgent(uint256 agentId, uint256 rentalFeeUSDC, uint256 winSplitBps)
        external returns (uint256 listingId)
    {
        require(registry.ownerOf(agentId) == msg.sender, "Not your agent");
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
     *         Before calling: approve(marketplace, rentalFeeUSDC) on cUSDC.
     *         Send the duel stake as msg.value (COTI).
     */
    function rentAndDuel(uint256 listingId, uint256 duration)
        external payable
        returns (uint256 rentalId, uint256 duelId)
    {
        Listing storage l = listings[listingId];
        require(l.available, "Not available");
        require(msg.sender != l.owner, "Cannot rent your own agent");
        require(msg.value > 0, "Stake required");

        // Collect cUSDC rental fee
        uint256 fee = l.rentalFeeUSDC;
        uint256 protocolCut = (fee * PROTOCOL_FEE_BPS) / 10000;
        uint256 ownerCut = fee - protocolCut;

        cUSDC.safeTransferFrom(msg.sender, address(this), fee);
        pendingUSDC[l.owner]       += ownerCut;
        pendingUSDC[feeRecipient]  += protocolCut;

        // Create duel — renter's wallet is agentA on-chain
        // Owner's agent will join as agentB (off-chain listening to rentals)
        duelId = duelManager.createDuel{value: msg.value}(duration);

        rentalId = ++rentalCount;
        rentals[rentalId] = RentalAgreement({
            listingId: listingId,
            duelId: duelId,
            renter: msg.sender,
            agentOwner: l.owner,
            rentalFeeUSDC: fee,
            winSplitBps: l.winSplitBps,
            stake: msg.value,
            settled: false
        });

        duelToRental[duelId] = rentalId;

        registry.recordRental(l.agentId, ownerCut);

        emit AgentRented(rentalId, duelId, msg.sender);
    }

    // ─── Settlement ───────────────────────────────────────────────────────────

    function settleRental(uint256 rentalId) external {
        RentalAgreement storage r = rentals[rentalId];
        require(!r.settled, "Already settled");

        (address agentA,,,,, uint8 state, address winner,,) = duelManager.getDuel(r.duelId);
        require(state == 3, "Duel not resolved");

        r.settled = true;

        // The renter created the duel (agentA). Owner's agent joined as agentB.
        // If winner == agentA → renter won. If winner == agentB → owner's agent won.
        bool agentWon = (winner != agentA); // owner's agent is agentB

        uint256 agentId = registry.agentOf(r.agentOwner);
        if (agentId > 0) {
            (int256 pnlA, int256 pnlB,,) = duelManager.getLivePnL(r.duelId);
            // Owner's agent is agentB — take pnlB
            int256 agentPnL = (agentA == r.renter) ? pnlB : pnlA;
            registry.recordFight(agentId, agentWon, false, agentPnL, agentWon ? r.stake * 2 : 0);
        }

        emit RentalSettled(rentalId, agentWon);
    }

    // ─── Claim cUSDC ──────────────────────────────────────────────────────────

    function claimUSDC() external {
        uint256 amount = pendingUSDC[msg.sender];
        require(amount > 0, "Nothing to claim");
        pendingUSDC[msg.sender] = 0;
        cUSDC.safeTransfer(msg.sender, amount);
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
