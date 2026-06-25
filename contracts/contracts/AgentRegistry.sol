// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@coti-io/coti-contracts/contracts/token/PrivateERC721/PrivateERC721.sol";
import "@coti-io/coti-contracts/contracts/utils/mpc/MpcCore.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AgentRegistry
 * @notice On-chain identity for every Leash agent.
 *         Each agent is an NFT. Performance stats are public.
 *
 * Privacy model:
 *   - Agent ownership is stored as ctUint256 (encrypted via COTI MPC).
 *     No one can read `_encOwner[agentId]` as a plaintext address.
 *   - agentOf[] is internal — duplicate check only, not publicly enumerable.
 *   - AgentMinted event emits agentId + name, NOT the owner address.
 *   - proveOwnership() does an MPC comparison (gt + mux) — reveals only
 *     "yes/no", never the stored address.
 */
contract AgentRegistry is PrivateERC721, Ownable {

    struct AgentProfile {
        string  name;
        string  avatarUri;
        // owner field removed — identity stored as encrypted ctUint256 in _encOwner
        uint256 mintedAt;

        uint256 wins;
        uint256 losses;
        uint256 draws;
        uint256 totalFights;
        uint256 rentalCount;

        uint256 totalEarned;
        uint256 rentalEarned;
    }

    mapping(uint256 => int256[]) public pnlHistory;

    uint256 public agentCount;

    mapping(address => bool) public authorised;

    mapping(uint256 => AgentProfile) public profiles;

    // Encrypted ownership — agentId → ctUint256 of the owner address.
    // Stored via MpcCore.offBoardCombined; only accessible in GC context.
    mapping(uint256 => ctUint256) private _encOwner;

    // Internal duplicate-check mapping. NOT public — external parties cannot
    // enumerate which agent belongs to which wallet.
    mapping(address => uint256) internal agentOf;

    // Owner address intentionally omitted from this event.
    event AgentMinted(uint256 indexed agentId, string name);
    event StatsUpdated(uint256 indexed agentId, bool won, int256 pnlBps);
    event AuthorisedUpdated(address indexed caller, bool status);

    modifier onlyAuthorised() {
        require(authorised[msg.sender] || msg.sender == owner(), "Not authorised");
        _;
    }

    constructor() PrivateERC721("Leash Agent", "AGENT") {}

    // ─── Registration ──────────────────────────────────────────────────────────

    /**
     * @notice Register a new agent. One per address.
     *         Owner address is encrypted on-chain via MPC — not publicly readable.
     */
    function registerAgent(string calldata name, string calldata avatarUri) external returns (uint256 agentId) {
        require(agentOf[msg.sender] == 0, "Already registered");
        require(bytes(name).length > 0 && bytes(name).length <= 32, "Invalid name");

        agentId = ++agentCount;

        profiles[agentId] = AgentProfile({
            name:        name,
            avatarUri:   avatarUri,
            mintedAt:    block.timestamp,
            wins:        0,
            losses:      0,
            draws:       0,
            totalFights: 0,
            rentalCount: 0,
            totalEarned: 0,
            rentalEarned: 0
        });

        agentOf[msg.sender] = agentId;

        // Encrypt msg.sender as owner.
        // setPublic256: msg.sender is already public in the tx, but storing it as
        // ctUint256 via offBoardCombined means on-chain storage is encrypted —
        // future observers cannot read the storage slot as a plaintext address.
        gtUint256 gtSender = MpcCore.setPublic256(uint256(uint160(msg.sender)));
        // offBoardCombined returns utUint256 {ciphertext, userCiphertext}.
        // Store only the network ciphertext — used later by onBoard() in proveOwnership().
        // The userCiphertext (encrypted for msg.sender's AES key) is discarded here;
        // the owner doesn't need to read back their own address.
        _encOwner[agentId] = MpcCore.offBoardCombined(gtSender, msg.sender).ciphertext;

        _mint(msg.sender, agentId);

        emit AgentMinted(agentId, name);
    }

    // ─── Ownership proof (MPC) ────────────────────────────────────────────────

    /**
     * @notice Prove that msg.sender owns agentId.
     *         Performs an MPC equality check (two GC gt comparisons + mux).
     *         Returns true/false — the stored address is never decrypted or revealed.
     *
     * Called by AgentMarketplace.listAgent() / delistAgent() / updateFee()
     * instead of the usual ownerOf(agentId) == msg.sender pattern.
     */
    /**
     * @notice Prove that `claimant` owns agentId via MPC comparison.
     *         Only authorised callers (DuelManager, AgentMarketplace) may call this,
     *         passing msg.sender from their own context as the claimant.
     *
     *         Security: the stored address is never decrypted or revealed.
     *         The MPC comparison produces only a boolean result.
     *         An attacker enumerating addresses still needs 2^160 calls to find
     *         a match — computationally infeasible.
     */
    function proveOwnership(uint256 agentId, address claimant) external onlyAuthorised returns (bool) {
        gtUint256 stored  = MpcCore.onBoard(_encOwner[agentId]);
        gtBool    isOwner = MpcCore.eq(uint256(uint160(claimant)), stored);
        return MpcCore.decrypt(isOwner);
    }

    /**
     * @notice Internal agentId lookup — available only to authorised callers
     *         (DuelManager, AgentMarketplace) via the authorised modifier.
     *         Not externally enumerable.
     */
    function agentIdOf(address agentOwner) external view onlyAuthorised returns (uint256) {
        return agentOf[agentOwner];
    }

    // ─── Stats (called by DuelManager / AgentMarketplace) ──────────────────────

    function recordFight(
        uint256 agentId,
        bool won,
        bool draw,
        int256 pnlBps,
        uint256 prize
    ) external onlyAuthorised {
        AgentProfile storage p = profiles[agentId];
        p.totalFights++;
        if (draw) {
            p.draws++;
        } else if (won) {
            p.wins++;
            p.totalEarned += prize;
        } else {
            p.losses++;
        }

        pnlHistory[agentId].push(pnlBps);
        emit StatsUpdated(agentId, won, pnlBps);
    }

    function recordRental(uint256 agentId, uint256 feeEarned) external onlyAuthorised {
        profiles[agentId].rentalCount++;
        profiles[agentId].rentalEarned += feeEarned;
    }

    // ─── Admin ─────────────────────────────────────────────────────────────────

    function setAuthorised(address caller, bool status) external onlyOwner {
        authorised[caller] = status;
        emit AuthorisedUpdated(caller, status);
    }

    // ─── Views ─────────────────────────────────────────────────────────────────

    function getProfile(uint256 agentId) external view returns (AgentProfile memory) {
        return profiles[agentId];
    }

    function getPnLHistory(uint256 agentId) external view returns (int256[] memory) {
        return pnlHistory[agentId];
    }

    function winRate(uint256 agentId) external view returns (uint256 bps) {
        AgentProfile storage p = profiles[agentId];
        if (p.totalFights == 0) return 0;
        return (p.wins * 10000) / p.totalFights;
    }

    /**
     * @notice Return top `limit` agents by win rate (desc), then by totalFights (desc) on tie.
     *         O(n * limit) — fine for small agent counts in a competition setting.
     */
    function getTopAgents(uint256 limit)
        external view
        returns (uint256[] memory agentIds, AgentProfile[] memory profileList)
    {
        uint256 total = agentCount;
        if (limit > total) limit = total;
        if (limit == 0) return (new uint256[](0), new AgentProfile[](0));

        // Build an id array [1..total] and selection-sort the top `limit` entries
        uint256[] memory ids = new uint256[](total);
        for (uint256 i = 0; i < total; i++) ids[i] = i + 1;

        for (uint256 i = 0; i < limit; i++) {
            uint256 best = i;
            uint256 bestRate  = _winRateOf(ids[best]);
            uint256 bestFight = profiles[ids[best]].totalFights;
            for (uint256 j = i + 1; j < total; j++) {
                uint256 rate  = _winRateOf(ids[j]);
                uint256 fight = profiles[ids[j]].totalFights;
                if (rate > bestRate || (rate == bestRate && fight > bestFight)) {
                    best = j; bestRate = rate; bestFight = fight;
                }
            }
            uint256 tmp = ids[i]; ids[i] = ids[best]; ids[best] = tmp;
        }

        agentIds    = new uint256[](limit);
        profileList = new AgentProfile[](limit);
        for (uint256 i = 0; i < limit; i++) {
            agentIds[i]    = ids[i];
            profileList[i] = profiles[ids[i]];
        }
    }

    function _winRateOf(uint256 agentId) internal view returns (uint256) {
        AgentProfile storage p = profiles[agentId];
        if (p.totalFights == 0) return 0;
        return (p.wins * 10000) / p.totalFights;
    }

    function tokenURI(uint256 agentId) public view returns (string memory) {
        AgentProfile storage p = profiles[agentId];
        if (bytes(p.avatarUri).length > 0) return p.avatarUri;
        return string(abi.encodePacked("https://leash.ai/agent/", _toString(agentId)));
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) { digits--; buffer[digits] = bytes1(uint8(48 + uint256(value % 10))); value /= 10; }
        return string(buffer);
    }
}
