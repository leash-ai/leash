// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@coti-io/coti-contracts/contracts/utils/mpc/MpcCore.sol";

/**
 * @title AgentRegistry
 * @notice On-chain identity for every Leash agent.
 *         Each agent is an NFT. Public stats (wins/losses/fights) are visible to all.
 *         The rental fee and strategy details stay private.
 *
 * Minting: anyone can register an agent (one NFT per address recommended).
 * Stats: updated by DuelManager and AgentMarketplace after each fight.
 */
contract AgentRegistry is ERC721, Ownable {

    struct AgentProfile {
        string  name;           // public display name
        string  avatarUri;      // IPFS or URL
        address owner;
        uint256 mintedAt;

        // Public stats (anyone can read)
        uint256 wins;
        uint256 losses;
        uint256 draws;
        uint256 totalFights;
        uint256 rentalCount;    // how many times rented out

        // Earnings (in COTI wei — public totals, not encrypted)
        uint256 totalEarned;    // cumulative prize winnings
        uint256 rentalEarned;   // cumulative rental fees earned
    }

    // PnL history stored as int256 array (public aggregate, not individual positions)
    mapping(uint256 => int256[]) public pnlHistory; // agentId => [pnlBps...]

    uint256 public agentCount;

    // Only authorised callers (DuelManager, AgentMarketplace) can update stats
    mapping(address => bool) public authorised;

    mapping(uint256 => AgentProfile) public profiles;

    // Reverse lookup: owner address → agentId (0 = unregistered)
    mapping(address => uint256) public agentOf;

    event AgentMinted(uint256 indexed agentId, address indexed owner, string name);
    event StatsUpdated(uint256 indexed agentId, bool won, int256 pnlBps);
    event AuthorisedUpdated(address indexed caller, bool status);

    modifier onlyAuthorised() {
        require(authorised[msg.sender] || msg.sender == owner(), "Not authorised");
        _;
    }

    constructor() ERC721("Leash Agent", "AGENT") {}

    // ─── Registration ──────────────────────────────────────────────────────────

    /**
     * @notice Register a new agent. One per address.
     */
    function registerAgent(string calldata name, string calldata avatarUri) external returns (uint256 agentId) {
        require(agentOf[msg.sender] == 0, "Already registered");
        require(bytes(name).length > 0 && bytes(name).length <= 32, "Invalid name");

        agentId = ++agentCount;

        profiles[agentId] = AgentProfile({
            name: name,
            avatarUri: avatarUri,
            owner: msg.sender,
            mintedAt: block.timestamp,
            wins: 0,
            losses: 0,
            draws: 0,
            totalFights: 0,
            rentalCount: 0,
            totalEarned: 0,
            rentalEarned: 0
        });

        agentOf[msg.sender] = agentId;
        _mint(msg.sender, agentId);

        emit AgentMinted(agentId, msg.sender, name);
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

    function tokenURI(uint256 agentId) public view override returns (string memory) {
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
