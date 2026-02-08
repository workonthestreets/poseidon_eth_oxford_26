// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/**
 * @title PoseidonAuction
 * @notice Maritime Risk Prediction Market - Simplified Demo Flow
 * @dev 
 *      1. Hedger: requestQuote() → commits to hedge
 *      2. Counterparty: submitBid() → IMMEDIATELY emits shares (no accept needed)
 *      3. Oracle: settle() → determines winner
 *      4. Winner: claim() → receives payout
 * 
 * PREDICTION MARKET MATH:
 * - Hedger requests $X hedge, counterparty offers YES @ price P
 * - YES shares = X / P (hedger receives)
 * - NO shares = X / (1-P) (counterparty receives)  
 * - Total collateral = X + X = 2X
 * - Winner takes all (minus 2% fee)
 */
contract PoseidonAuction {
    uint256 public constant PROTOCOL_FEE_BPS = 200; // 2%
    uint256 public constant PRICE_DECIMALS = 1e18;

    enum RiskType { PSC_DETENTION, CASUALTY, VOYAGE_COMPLETION }
    enum MarketPhase { OPEN, ACTIVE, SETTLED }

    struct Vessel {
        string imo;
        string name;
        string flag;
        string vesselType;
        string route;
        bool exists;
    }

    struct Market {
        uint256 vesselId;
        RiskType riskType;
        string description;
        uint256 impliedProbability;
        MarketPhase phase;
        uint256 totalYesShares;
        uint256 totalNoShares;
        uint256 totalCollateral;
        bool outcome;
        uint256 emissionTimestamp;
    }

    struct QuoteRequest {
        address hedger;
        uint256 amountUSD;
        bool active;
        bool filled;
    }

    struct Position {
        uint256 yesShares;
        uint256 noShares;
        uint256 costBasis;
        bool claimed;
    }

    address public owner;
    address public oracle;

    uint256 public vesselCount;
    mapping(uint256 => Vessel) public vessels;

    uint256 public marketCount;
    mapping(uint256 => Market) public markets;
    mapping(uint256 => QuoteRequest) public quoteRequests;
    mapping(uint256 => mapping(address => Position)) public positions;
    mapping(address => uint256) public deposits;

    uint256 public protocolFees;
    uint256 public flrPriceUSD = 2 * 1e16; // $0.02

    event VesselAdded(uint256 indexed vesselId, string imo, string name);
    event MarketCreated(uint256 indexed marketId, uint256 indexed vesselId, RiskType riskType);
    event QuoteRequested(uint256 indexed marketId, address indexed hedger, uint256 amountUSD);
    event SharesEmitted(uint256 indexed marketId, address indexed hedger, address indexed counterparty, uint256 yesShares, uint256 noShares, uint256 collateral);
    event MarketSettled(uint256 indexed marketId, bool outcome);
    event Claimed(address indexed user, uint256 indexed marketId, uint256 payout);
    event Deposited(address indexed user, uint256 amount);

    constructor() {
        owner = msg.sender;
        oracle = msg.sender;
        _initializeVessels();
        _initializeMarkets();
    }

    function _initializeVessels() internal {
        _addVessel("9876543", "MV Pacific Sentinel", "Panama", "Bulk Carrier", "Shanghai - Rotterdam");
        _addVessel("9234567", "MV Atlantic Horizon", "Liberia", "Container Ship", "Singapore - Los Angeles");
        _addVessel("9345678", "MV Nordic Aurora", "Marshall Islands", "Oil Tanker", "Ras Tanura - Houston");
        _addVessel("9456789", "MV Caspian Voyager", "Singapore", "LNG Carrier", "Doha - Yokohama");
        _addVessel("9567890", "MV Iron Meridian", "Hong Kong", "Bulk Carrier", "Port Hedland - Qingdao");
    }

    function _addVessel(string memory imo, string memory name, string memory flag, string memory vesselType, string memory route) internal {
        uint256 id = vesselCount++;
        vessels[id] = Vessel(imo, name, flag, vesselType, route, true);
        emit VesselAdded(id, imo, name);
    }

    function _initializeMarkets() internal {
        for (uint256 i = 0; i < vesselCount; i++) {
            _createMarket(i, RiskType.PSC_DETENTION, "PSC Detention Risk", 82 * 1e16);
        }
    }

    function _createMarket(uint256 vesselId, RiskType riskType, string memory description, uint256 impliedProb) internal {
        uint256 marketId = marketCount++;
        markets[marketId] = Market({
            vesselId: vesselId,
            riskType: riskType,
            description: description,
            impliedProbability: impliedProb,
            phase: MarketPhase.OPEN,
            totalYesShares: 0,
            totalNoShares: 0,
            totalCollateral: 0,
            outcome: false,
            emissionTimestamp: 0
        });
        emit MarketCreated(marketId, vesselId, riskType);
    }

    function deposit() external payable {
        require(msg.value > 0, "Zero deposit");
        deposits[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        require(deposits[msg.sender] >= amount, "Insufficient");
        deposits[msg.sender] -= amount;
        payable(msg.sender).transfer(amount);
    }

    function usdToFLR(uint256 usdAmount) public view returns (uint256) {
        return (usdAmount * 1e18) / flrPriceUSD;
    }

    /**
     * @notice Hedger requests a quote - signs commitment
     */
    function requestQuote(uint256 marketId, uint256 amountUSD) external {
        Market storage market = markets[marketId];
        require(market.phase == MarketPhase.OPEN, "Market not open");
        require(!quoteRequests[marketId].active, "Quote exists");
        require(amountUSD > 0, "Zero amount");

        quoteRequests[marketId] = QuoteRequest({
            hedger: msg.sender,
            amountUSD: amountUSD,
            active: true,
            filled: false
        });

        emit QuoteRequested(marketId, msg.sender, amountUSD);
    }

    /**
     * @notice Counterparty submits bid → IMMEDIATELY emits shares
     * @dev No "accept" step needed - shares emit on bid submission
     */
    function submitBid(uint256 marketId, uint256 yesPrice) external {
        Market storage market = markets[marketId];
        QuoteRequest storage quote = quoteRequests[marketId];
        
        require(market.phase == MarketPhase.OPEN, "Market not open");
        require(quote.active && !quote.filled, "No active quote");
        require(yesPrice > 0 && yesPrice < PRICE_DECIMALS, "Invalid price");

        // Calculate shares
        uint256 yesShares = (quote.amountUSD * PRICE_DECIMALS) / yesPrice;
        uint256 noPrice = PRICE_DECIMALS - yesPrice;
        uint256 noShares = (quote.amountUSD * PRICE_DECIMALS) / noPrice;

        // Calculate collateral
        uint256 hedgerCollateralUSD = (yesShares * yesPrice) / PRICE_DECIMALS;
        uint256 counterpartyCollateralUSD = (noShares * noPrice) / PRICE_DECIMALS;
        
        uint256 hedgerCollateralFLR = usdToFLR(hedgerCollateralUSD);
        uint256 counterpartyCollateralFLR = usdToFLR(counterpartyCollateralUSD);

        // Check balances
        require(deposits[quote.hedger] >= hedgerCollateralFLR, "Hedger insufficient");
        require(deposits[msg.sender] >= counterpartyCollateralFLR, "Counterparty insufficient");

        // Lock collateral
        deposits[quote.hedger] -= hedgerCollateralFLR;
        deposits[msg.sender] -= counterpartyCollateralFLR;

        // Emit shares
        positions[marketId][quote.hedger].yesShares = yesShares;
        positions[marketId][quote.hedger].costBasis = hedgerCollateralFLR;
        positions[marketId][msg.sender].noShares = noShares;
        positions[marketId][msg.sender].costBasis = counterpartyCollateralFLR;

        // Update market
        market.totalYesShares = yesShares;
        market.totalNoShares = noShares;
        market.totalCollateral = hedgerCollateralFLR + counterpartyCollateralFLR;
        market.phase = MarketPhase.ACTIVE;
        market.emissionTimestamp = block.timestamp;

        quote.filled = true;

        emit SharesEmitted(marketId, quote.hedger, msg.sender, yesShares, noShares, market.totalCollateral);
    }

    /**
     * @notice Oracle settles market
     */
    function settle(uint256 marketId, bool yesWins) external {
        require(msg.sender == oracle || msg.sender == owner, "Not oracle");
        Market storage market = markets[marketId];
        require(market.phase == MarketPhase.ACTIVE, "Not active");

        market.outcome = yesWins;
        market.phase = MarketPhase.SETTLED;

        emit MarketSettled(marketId, yesWins);
    }

    /**
     * @notice Winner claims payout
     */
    function claim(uint256 marketId) external {
        Market storage market = markets[marketId];
        require(market.phase == MarketPhase.SETTLED, "Not settled");

        Position storage pos = positions[marketId][msg.sender];
        require(!pos.claimed, "Already claimed");

        uint256 winningShares = market.outcome ? pos.yesShares : pos.noShares;
        require(winningShares > 0, "No winning shares");

        pos.claimed = true;

        uint256 totalWinning = market.outcome ? market.totalYesShares : market.totalNoShares;
        uint256 payout = (market.totalCollateral * winningShares) / totalWinning;

        uint256 fee = (payout * PROTOCOL_FEE_BPS) / 10000;
        protocolFees += fee;
        payout -= fee;

        deposits[msg.sender] += payout;

        emit Claimed(msg.sender, marketId, payout);
    }

    // View functions
    function getVessel(uint256 vesselId) external view returns (Vessel memory) { return vessels[vesselId]; }
    function getMarket(uint256 marketId) external view returns (Market memory) { return markets[marketId]; }
    function getQuoteRequest(uint256 marketId) external view returns (QuoteRequest memory) { return quoteRequests[marketId]; }
    function getPosition(uint256 marketId, address user) external view returns (Position memory) { return positions[marketId][user]; }
    function getBalance(address user) external view returns (uint256) { return deposits[user]; }

    function setOracle(address _oracle) external { require(msg.sender == owner); oracle = _oracle; }
    
    receive() external payable { deposits[msg.sender] += msg.value; emit Deposited(msg.sender, msg.value); }
}
