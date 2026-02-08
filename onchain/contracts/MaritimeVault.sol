// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {FtsoV2Interface} from "@flarenetwork/flare-periphery-contracts/coston2/FtsoV2Interface.sol";

/**
 * @title MaritimeVault
 * @notice Vault contract for Maritime Shield prediction market on Flare
 * @dev Integrates with FTSO for FLR/USD price feeds
 */
contract MaritimeVault {
    // Feed ID for FLR/USD price
    bytes21 public constant FLR_USD_FEED_ID = bytes21(0x01464c522f55534400000000000000000000000000);

    address public owner;
    address public operator;

    struct Market {
        string vesselIMO;
        string description;
        uint256 totalCollateral;     // Total FLR deposited
        uint256 totalCollateralUSD;  // Total value in USD (18 decimals)
        uint256 expiresAt;
        bool settled;
        bool outcome;                // true = YES wins, false = NO wins
    }

    struct UserPosition {
        uint256 yesShares;           // Number of YES shares (18 decimals)
        uint256 noShares;            // Number of NO shares (18 decimals)
        uint256 depositedFLR;        // Original FLR deposited
        bool claimed;
    }

    uint256 public marketCount;
    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(address => UserPosition)) public positions;
    mapping(uint256 => address[]) public marketParticipants;

    // Protocol fee (2%)
    uint256 public constant PROTOCOL_FEE_BPS = 200;
    uint256 public protocolFees;

    // Events
    event MarketCreated(uint256 indexed marketId, string vesselIMO, string description, uint256 expiresAt);
    event Deposited(address indexed user, uint256 indexed marketId, uint256 flrAmount, uint256 usdValue, uint256 yesShares, uint256 noShares);
    event PositionsCommitted(uint256 indexed marketId, uint256 userCount);
    event MarketSettled(uint256 indexed marketId, bool outcome);
    event Claimed(address indexed user, uint256 indexed marketId, uint256 payout);
    event Redeemed(address indexed user, uint256 indexed marketId, uint256 shares, uint256 flrReturned);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == operator || msg.sender == owner, "Not operator");
        _;
    }

    constructor() {
        owner = msg.sender;
        operator = msg.sender;
    }

    // ============ FTSO Integration ============

    // Cached price (updated on each deposit)
    uint256 public cachedFLRPrice;
    int8 public cachedDecimals;
    uint64 public lastPriceUpdate;

    /**
     * @notice Get current FLR/USD price from FTSO (payable - may require fee)
     * @return price The price value
     * @return decimals The decimal places
     * @return timestamp When the price was updated
     */
    function getFLRPrice() public payable returns (uint256 price, int8 decimals, uint64 timestamp) {
        FtsoV2Interface ftso = ContractRegistry.getFtsoV2();
        (price, decimals, timestamp) = ftso.getFeedById(FLR_USD_FEED_ID);
        // Cache for view functions
        cachedFLRPrice = price;
        cachedDecimals = decimals;
        lastPriceUpdate = timestamp;
    }

    /**
     * @notice Get cached FLR/USD price (view function)
     */
    function getCachedFLRPrice() public view returns (uint256 price, int8 decimals, uint64 timestamp) {
        return (cachedFLRPrice, cachedDecimals, lastPriceUpdate);
    }

    /**
     * @notice Convert FLR amount to USD value (18 decimals) using cached price
     * @param flrAmount Amount of FLR in wei
     * @return usdValue Value in USD with 18 decimals
     */
    function convertFLRtoUSD(uint256 flrAmount) public view returns (uint256 usdValue) {
        uint256 price = cachedFLRPrice;
        int8 decimals = cachedDecimals;
        
        // If no cached price, use a default (for testing)
        if (price == 0) {
            // Default: 1 FLR = $0.02 (2 cents) with 5 decimals = 2000
            price = 2000;
            decimals = 5;
        }
        
        // FTSO price has variable decimals, normalize to 18
        if (decimals >= 0) {
            usdValue = (flrAmount * price) / (10 ** uint8(decimals));
        } else {
            usdValue = (flrAmount * price * (10 ** uint8(-decimals))) / 1e18;
        }
    }

    /**
     * @notice Update price and convert in one call
     */
    function convertFLRtoUSDWithUpdate(uint256 flrAmount) public payable returns (uint256 usdValue) {
        getFLRPrice();
        return convertFLRtoUSD(flrAmount);
    }

    // ============ Market Management ============

    /**
     * @notice Create a new prediction market
     * @param vesselIMO The vessel IMO number
     * @param description Market description
     * @param expiresAt Expiration timestamp
     */
    function createMarket(
        string calldata vesselIMO,
        string calldata description,
        uint256 expiresAt
    ) external onlyOperator returns (uint256 marketId) {
        require(expiresAt > block.timestamp, "Invalid expiry");

        marketId = marketCount++;
        markets[marketId] = Market({
            vesselIMO: vesselIMO,
            description: description,
            totalCollateral: 0,
            totalCollateralUSD: 0,
            expiresAt: expiresAt,
            settled: false,
            outcome: false
        });

        emit MarketCreated(marketId, vesselIMO, description, expiresAt);
    }

    // ============ Deposit & Mint ============

    /**
     * @notice Deposit FLR and mint paired YES+NO shares
     * @param marketId The market to deposit into
     */
    function deposit(uint256 marketId) external payable {
        require(msg.value > 0, "No value");
        Market storage market = markets[marketId];
        require(!market.settled, "Market settled");
        require(block.timestamp < market.expiresAt, "Market expired");

        // Convert FLR to USD value using FTSO
        uint256 usdValue = convertFLRtoUSD(msg.value);

        // Get or create position
        UserPosition storage pos = positions[marketId][msg.sender];
        if (pos.depositedFLR == 0) {
            marketParticipants[marketId].push(msg.sender);
        }

        // Mint paired shares (1 USD value = 1 YES + 1 NO)
        pos.yesShares += usdValue;
        pos.noShares += usdValue;
        pos.depositedFLR += msg.value;

        market.totalCollateral += msg.value;
        market.totalCollateralUSD += usdValue;

        emit Deposited(msg.sender, marketId, msg.value, usdValue, usdValue, usdValue);
    }

    /**
     * @notice Redeem paired YES+NO shares for FLR (before settlement)
     * @param marketId The market
     * @param shares Number of share pairs to redeem
     */
    function redeem(uint256 marketId, uint256 shares) external {
        Market storage market = markets[marketId];
        require(!market.settled, "Market settled");

        UserPosition storage pos = positions[marketId][msg.sender];
        require(pos.yesShares >= shares && pos.noShares >= shares, "Insufficient shares");

        // Calculate FLR to return (proportional to shares)
        uint256 flrToReturn = (pos.depositedFLR * shares) / pos.yesShares;

        pos.yesShares -= shares;
        pos.noShares -= shares;
        pos.depositedFLR -= flrToReturn;

        market.totalCollateral -= flrToReturn;
        market.totalCollateralUSD -= shares;

        payable(msg.sender).transfer(flrToReturn);

        emit Redeemed(msg.sender, marketId, shares, flrToReturn);
    }

    // ============ Position Commitment (from RFQ engine) ============

    /**
     * @notice Commit final positions from off-chain RFQ trading
     * @dev Called by operator before settlement
     * @param marketId The market
     * @param users Array of user addresses
     * @param yesAmounts Array of YES share amounts
     * @param noAmounts Array of NO share amounts
     */
    function commitPositions(
        uint256 marketId,
        address[] calldata users,
        uint256[] calldata yesAmounts,
        uint256[] calldata noAmounts
    ) external onlyOperator {
        require(users.length == yesAmounts.length && users.length == noAmounts.length, "Length mismatch");
        
        Market storage market = markets[marketId];
        require(!market.settled, "Already settled");

        for (uint256 i = 0; i < users.length; i++) {
            UserPosition storage pos = positions[marketId][users[i]];
            pos.yesShares = yesAmounts[i];
            pos.noShares = noAmounts[i];
        }

        emit PositionsCommitted(marketId, users.length);
    }

    // ============ Settlement ============

    /**
     * @notice Settle a market with the outcome
     * @param marketId The market to settle
     * @param outcome true if YES wins, false if NO wins
     */
    function settle(uint256 marketId, bool outcome) external onlyOperator {
        Market storage market = markets[marketId];
        require(!market.settled, "Already settled");

        market.settled = true;
        market.outcome = outcome;

        emit MarketSettled(marketId, outcome);
    }

    /**
     * @notice Claim winnings after settlement
     * @param marketId The market to claim from
     */
    function claim(uint256 marketId) external {
        Market storage market = markets[marketId];
        require(market.settled, "Not settled");

        UserPosition storage pos = positions[marketId][msg.sender];
        require(!pos.claimed, "Already claimed");

        uint256 winningShares = market.outcome ? pos.yesShares : pos.noShares;
        require(winningShares > 0, "No winning shares");

        pos.claimed = true;

        // Calculate payout: winning shares as proportion of total pool
        uint256 totalWinningShares = market.outcome ? 
            _getTotalYesShares(marketId) : _getTotalNoShares(marketId);

        uint256 payout = (market.totalCollateral * winningShares) / totalWinningShares;

        // Deduct protocol fee
        uint256 fee = (payout * PROTOCOL_FEE_BPS) / 10000;
        protocolFees += fee;
        payout -= fee;

        payable(msg.sender).transfer(payout);

        emit Claimed(msg.sender, marketId, payout);
    }

    // ============ View Functions ============

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return markets[marketId];
    }

    function getPosition(uint256 marketId, address user) external view returns (UserPosition memory) {
        return positions[marketId][user];
    }

    function getMarketParticipants(uint256 marketId) external view returns (address[] memory) {
        return marketParticipants[marketId];
    }

    function _getTotalYesShares(uint256 marketId) internal view returns (uint256 total) {
        address[] storage participants = marketParticipants[marketId];
        for (uint256 i = 0; i < participants.length; i++) {
            total += positions[marketId][participants[i]].yesShares;
        }
    }

    function _getTotalNoShares(uint256 marketId) internal view returns (uint256 total) {
        address[] storage participants = marketParticipants[marketId];
        for (uint256 i = 0; i < participants.length; i++) {
            total += positions[marketId][participants[i]].noShares;
        }
    }

    // ============ Admin Functions ============

    function setOperator(address _operator) external onlyOwner {
        operator = _operator;
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = protocolFees;
        protocolFees = 0;
        payable(owner).transfer(fees);
    }

    receive() external payable {}
}
