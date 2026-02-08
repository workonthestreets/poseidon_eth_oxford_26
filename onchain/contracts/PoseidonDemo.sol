// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/**
 * @title PoseidonDemo
 * @notice Maritime Risk Prediction Market with Pre-Signed Commitments
 * @dev Demo-optimized for hackathon: instant emission after accept, instant settlement
 * 
 * PREDICTION MARKET MATH:
 * - Hedger requests $X hedge, counterparty offers YES @ price P
 * - YES shares = $X / P (hedger receives)
 * - NO shares = $X / (1-P) (counterparty receives)
 * - Total collateral = YES_shares * P + NO_shares * (1-P) = $X + $X = $2X
 * - Winner takes all collateral (minus 2% fee)
 * 
 * DEMO FLOW:
 * 1. Markets are pre-initialized with vessels
 * 2. Hedger: requestQuote() - signs commitment to fulfill at departure
 * 3. Counterparty: submitBid() - signs commitment to fulfill at departure  
 * 4. Hedger: acceptBid() - both commitments locked
 * 5. AUTO after 3s: emitShares() - shares minted per prediction market math
 * 6. AUTO after 10s: settle() with synthetic outcome
 * 7. Winner: claim() - takes all collateral
 */
contract PoseidonDemo {
    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════

    uint256 public constant PROTOCOL_FEE_BPS = 200; // 2%
    uint256 public constant PRICE_DECIMALS = 1e18;  // 18 decimals for prices
    uint256 public constant EMISSION_DELAY = 3;     // 3 seconds after accept
    uint256 public constant SETTLEMENT_DELAY = 10;  // 10 seconds after emission

    // ═══════════════════════════════════════════════════════════════════════════
    // ENUMS
    // ═══════════════════════════════════════════════════════════════════════════

    enum RiskType { PSC_DETENTION, CASUALTY, VOYAGE_COMPLETION }
    enum MarketPhase { OPEN, COMMITTED, ACTIVE, SETTLED }
    enum BidStatus { PENDING, ACCEPTED, CANCELLED }

    // ═══════════════════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════════════════

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
        uint256 impliedProbability;   // e.g., 0.82e18 = 82% chance of YES
        uint256 departureTimestamp;
        uint256 arrivalTimestamp;
        MarketPhase phase;
        // Shares
        uint256 totalYesShares;
        uint256 totalNoShares;
        uint256 totalCollateral;
        // Settlement
        bool outcome;                  // true = YES wins
        uint256 emissionTimestamp;
        uint256 settlementTimestamp;
    }

    struct QuoteRequest {
        address hedger;
        uint256 amountUSD;            // Amount to hedge in USD (18 decimals)
        uint256 commitmentTimestamp;  // When hedger signed commitment
        bool active;
        bool filled;
    }

    struct Bid {
        address counterparty;
        uint256 yesPrice;             // Price per YES share (e.g., 0.66e18 = $0.66)
        uint256 collateralFLR;        // FLR locked by counterparty
        uint256 commitmentTimestamp;  // When counterparty signed commitment
        BidStatus status;
    }

    struct Position {
        uint256 yesShares;
        uint256 noShares;
        uint256 costBasis;
        bool claimed;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    address public owner;
    address public oracle;

    // Vessels (pre-defined)
    uint256 public vesselCount;
    mapping(uint256 => Vessel) public vessels;

    // Markets
    uint256 public marketCount;
    mapping(uint256 => Market) public markets;
    mapping(uint256 => QuoteRequest) public quoteRequests;
    mapping(uint256 => Bid[]) public bids;
    mapping(uint256 => mapping(address => Position)) public positions;

    // Deposits
    mapping(address => uint256) public deposits;
    uint256 public protocolFees;

    // FLR price (simplified for demo: $0.02)
    uint256 public flrPriceUSD = 2 * 1e16; // $0.02 with 18 decimals

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    event VesselAdded(uint256 indexed vesselId, string imo, string name);
    event MarketCreated(uint256 indexed marketId, uint256 indexed vesselId, RiskType riskType);
    event QuoteRequested(uint256 indexed marketId, address indexed hedger, uint256 amountUSD);
    event BidSubmitted(uint256 indexed marketId, uint256 bidIndex, address indexed counterparty, uint256 yesPrice);
    event BidAccepted(uint256 indexed marketId, uint256 bidIndex);
    event SharesEmitted(uint256 indexed marketId, uint256 yesShares, uint256 noShares, uint256 collateral);
    event MarketSettled(uint256 indexed marketId, bool outcome);
    event Claimed(address indexed user, uint256 indexed marketId, uint256 payout);
    event Deposited(address indexed user, uint256 amount);

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR & INITIALIZATION
    // ═══════════════════════════════════════════════════════════════════════════

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

    function _addVessel(
        string memory imo,
        string memory name,
        string memory flag,
        string memory vesselType,
        string memory route
    ) internal {
        uint256 id = vesselCount++;
        vessels[id] = Vessel(imo, name, flag, vesselType, route, true);
        emit VesselAdded(id, imo, name);
    }

    function _initializeMarkets() internal {
        // Create PSC Detention markets for each vessel
        for (uint256 i = 0; i < vesselCount; i++) {
            _createMarket(i, RiskType.PSC_DETENTION, "PSC Detention Risk", 82 * 1e16); // 82% implied prob
        }
    }

    function _createMarket(
        uint256 vesselId,
        RiskType riskType,
        string memory description,
        uint256 impliedProb
    ) internal {
        uint256 marketId = marketCount++;
        markets[marketId] = Market({
            vesselId: vesselId,
            riskType: riskType,
            description: description,
            impliedProbability: impliedProb,
            departureTimestamp: block.timestamp + 1 hours,  // Demo: departs in 1 hour
            arrivalTimestamp: block.timestamp + 24 hours,
            phase: MarketPhase.OPEN,
            totalYesShares: 0,
            totalNoShares: 0,
            totalCollateral: 0,
            outcome: false,
            emissionTimestamp: 0,
            settlementTimestamp: 0
        });
        emit MarketCreated(marketId, vesselId, riskType);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DEPOSIT / WITHDRAW
    // ═══════════════════════════════════════════════════════════════════════════

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

    // ═══════════════════════════════════════════════════════════════════════════
    // HEDGER: REQUEST QUOTE (Pre-sign commitment)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Hedger requests a quote - signs commitment to fulfill at departure
     * @param marketId Market to hedge
     * @param amountUSD Amount to hedge in USD (18 decimals, e.g., 10e18 = $10)
     */
    function requestQuote(uint256 marketId, uint256 amountUSD) external {
        Market storage market = markets[marketId];
        require(market.phase == MarketPhase.OPEN, "Market not open");
        require(!quoteRequests[marketId].active, "Quote exists");
        require(amountUSD > 0, "Zero amount");

        quoteRequests[marketId] = QuoteRequest({
            hedger: msg.sender,
            amountUSD: amountUSD,
            commitmentTimestamp: block.timestamp,
            active: true,
            filled: false
        });

        emit QuoteRequested(marketId, msg.sender, amountUSD);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // COUNTERPARTY: SUBMIT BID (Pre-sign commitment)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Counterparty submits bid with YES price - signs commitment
     * @param marketId Market to bid on
     * @param yesPrice Price per YES share (e.g., 0.66e18 = $0.66 = 66%)
     * @dev NO price is automatically 1 - yesPrice
     * 
     * Example: Hedger wants $10 hedge, counterparty offers YES @ $0.66
     * - Hedger will get: $10 / $0.66 = 15.15 YES shares
     * - Counterparty will get: $10 / $0.34 = 29.41 NO shares
     * - Hedger collateral: 15.15 * $0.66 = $10
     * - Counterparty collateral: 29.41 * $0.34 = $10
     */
    function submitBid(uint256 marketId, uint256 yesPrice) external {
        Market storage market = markets[marketId];
        QuoteRequest storage quote = quoteRequests[marketId];
        
        require(market.phase == MarketPhase.OPEN, "Market not open");
        require(quote.active && !quote.filled, "No active quote");
        require(yesPrice > 0 && yesPrice < PRICE_DECIMALS, "Invalid price");

        // Calculate counterparty's required collateral
        // NO price = 1 - YES price
        uint256 noPrice = PRICE_DECIMALS - yesPrice;
        // NO shares = amountUSD / noPrice
        uint256 noShares = (quote.amountUSD * PRICE_DECIMALS) / noPrice;
        // Collateral = NO shares * NO price
        uint256 collateralUSD = (noShares * noPrice) / PRICE_DECIMALS;
        uint256 collateralFLR = usdToFLR(collateralUSD);

        require(deposits[msg.sender] >= collateralFLR, "Insufficient deposit");
        deposits[msg.sender] -= collateralFLR;

        uint256 bidIndex = bids[marketId].length;
        bids[marketId].push(Bid({
            counterparty: msg.sender,
            yesPrice: yesPrice,
            collateralFLR: collateralFLR,
            commitmentTimestamp: block.timestamp,
            status: BidStatus.PENDING
        }));

        emit BidSubmitted(marketId, bidIndex, msg.sender, yesPrice);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HEDGER: ACCEPT BID → IMMEDIATE EMISSION (Demo mode)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Hedger accepts bid - triggers IMMEDIATE share emission for demo
     * @dev In production, emission would wait for departure timestamp
     */
    function acceptBid(uint256 marketId, uint256 bidIndex) external {
        Market storage market = markets[marketId];
        QuoteRequest storage quote = quoteRequests[marketId];
        Bid storage bid = bids[marketId][bidIndex];

        require(market.phase == MarketPhase.OPEN, "Market not open");
        require(msg.sender == quote.hedger, "Not hedger");
        require(quote.active && !quote.filled, "Quote not active");
        require(bid.status == BidStatus.PENDING, "Bid not pending");

        // Calculate hedger's collateral
        uint256 yesShares = (quote.amountUSD * PRICE_DECIMALS) / bid.yesPrice;
        uint256 hedgerCollateralUSD = (yesShares * bid.yesPrice) / PRICE_DECIMALS;
        uint256 hedgerCollateralFLR = usdToFLR(hedgerCollateralUSD);

        require(deposits[msg.sender] >= hedgerCollateralFLR, "Insufficient deposit");
        deposits[msg.sender] -= hedgerCollateralFLR;

        // Calculate counterparty shares
        uint256 noPrice = PRICE_DECIMALS - bid.yesPrice;
        uint256 noShares = (quote.amountUSD * PRICE_DECIMALS) / noPrice;

        // Update state
        bid.status = BidStatus.ACCEPTED;
        quote.filled = true;
        market.phase = MarketPhase.ACTIVE;

        // ═══════════════════════════════════════════════════════════════════════
        // IMMEDIATE SHARE EMISSION (Demo mode - no waiting)
        // ═══════════════════════════════════════════════════════════════════════

        // Hedger gets YES shares
        positions[marketId][quote.hedger].yesShares = yesShares;
        positions[marketId][quote.hedger].costBasis = hedgerCollateralFLR;

        // Counterparty gets NO shares
        positions[marketId][bid.counterparty].noShares = noShares;
        positions[marketId][bid.counterparty].costBasis = bid.collateralFLR;

        // Update market totals
        market.totalYesShares = yesShares;
        market.totalNoShares = noShares;
        market.totalCollateral = hedgerCollateralFLR + bid.collateralFLR;
        market.emissionTimestamp = block.timestamp;

        emit BidAccepted(marketId, bidIndex);
        emit SharesEmitted(marketId, yesShares, noShares, market.totalCollateral);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ORACLE: SETTLE MARKET
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Oracle settles market with outcome
     * @param marketId Market to settle
     * @param yesWins true if YES wins (risk event occurred for hedger)
     */
    function settle(uint256 marketId, bool yesWins) external {
        require(msg.sender == oracle || msg.sender == owner, "Not oracle");
        
        Market storage market = markets[marketId];
        require(market.phase == MarketPhase.ACTIVE, "Not active");

        market.outcome = yesWins;
        market.phase = MarketPhase.SETTLED;
        market.settlementTimestamp = block.timestamp;

        emit MarketSettled(marketId, yesWins);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CLAIM WINNINGS
    // ═══════════════════════════════════════════════════════════════════════════

    function claim(uint256 marketId) external {
        Market storage market = markets[marketId];
        require(market.phase == MarketPhase.SETTLED, "Not settled");

        Position storage pos = positions[marketId][msg.sender];
        require(!pos.claimed, "Already claimed");

        uint256 winningShares = market.outcome ? pos.yesShares : pos.noShares;
        require(winningShares > 0, "No winning shares");

        pos.claimed = true;

        // Winner takes proportional share of total collateral
        uint256 totalWinning = market.outcome ? market.totalYesShares : market.totalNoShares;
        uint256 payout = (market.totalCollateral * winningShares) / totalWinning;

        // Deduct 2% protocol fee
        uint256 fee = (payout * PROTOCOL_FEE_BPS) / 10000;
        protocolFees += fee;
        payout -= fee;

        deposits[msg.sender] += payout;

        emit Claimed(msg.sender, marketId, payout);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function getVessel(uint256 vesselId) external view returns (Vessel memory) {
        return vessels[vesselId];
    }

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return markets[marketId];
    }

    function getQuoteRequest(uint256 marketId) external view returns (QuoteRequest memory) {
        return quoteRequests[marketId];
    }

    function getBids(uint256 marketId) external view returns (Bid[] memory) {
        return bids[marketId];
    }

    function getPosition(uint256 marketId, address user) external view returns (Position memory) {
        return positions[marketId][user];
    }

    function getBalance(address user) external view returns (uint256) {
        return deposits[user];
    }

    function getBidCount(uint256 marketId) external view returns (uint256) {
        return bids[marketId].length;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ADMIN
    // ═══════════════════════════════════════════════════════════════════════════

    function setOracle(address _oracle) external {
        require(msg.sender == owner, "Not owner");
        oracle = _oracle;
    }

    function addVessel(
        string calldata imo,
        string calldata name,
        string calldata flag,
        string calldata vesselType,
        string calldata route
    ) external {
        require(msg.sender == owner, "Not owner");
        _addVessel(imo, name, flag, vesselType, route);
    }

    function createMarket(
        uint256 vesselId,
        RiskType riskType,
        string calldata description,
        uint256 impliedProb
    ) external {
        require(msg.sender == owner, "Not owner");
        require(vessels[vesselId].exists, "Vessel not found");
        _createMarket(vesselId, riskType, description, impliedProb);
    }

    receive() external payable {
        deposits[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }
}
