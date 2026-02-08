// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/**
 * @title DemoAuction
 * @notice Simplified Maritime Risk Auction for Demo Purposes
 * @dev Instant execution flow:
 *      1. Hedger creates request (amount only, no price)
 *      2. Counterparty submits bid (amount + NO price)
 *      3. Hedger accepts bid → IMMEDIATE share emission
 *      4. Oracle submits outcome → IMMEDIATE settlement
 *      5. Winner claims
 * 
 * This contract is designed for hackathon demos where we can't wait for
 * real vessel departure/arrival timestamps.
 */
contract DemoAuction {
    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════

    uint256 public constant PROTOCOL_FEE_BPS = 200; // 2%
    uint256 public constant PRICE_PRECISION = 1e18;

    // ═══════════════════════════════════════════════════════════════════════════
    // ENUMS
    // ═══════════════════════════════════════════════════════════════════════════

    enum MarketState {
        OPEN,           // Accepting bids
        ACTIVE,         // Shares emitted, awaiting outcome
        SETTLED         // Outcome determined, claims enabled
    }

    enum BidStatus {
        PENDING,
        ACCEPTED,
        CANCELLED
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════════════════

    struct Market {
        string vesselIMO;
        string vesselName;
        string riskDescription;
        uint256 totalYesShares;
        uint256 totalNoShares;
        uint256 totalCollateral;
        MarketState state;
        bool outcome;           // true = YES wins
        bool outcomeSet;
    }

    struct HedgeRequest {
        address hedger;
        uint256 amountToHedge;  // USD value (18 decimals)
        uint256 filledAmount;
        bool active;
    }

    struct Bid {
        address counterparty;
        uint256 bidAmount;      // USD value (18 decimals)
        uint256 noPrice;        // Price per NO share (e.g., 0.15e18 = 15%)
        uint256 collateralFLR;
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

    uint256 public marketCount;
    mapping(uint256 => Market) public markets;
    mapping(uint256 => HedgeRequest) public hedgeRequests;
    mapping(uint256 => Bid[]) public bids;
    mapping(uint256 => mapping(address => Position)) public positions;
    mapping(address => uint256) public deposits;

    uint256 public protocolFees;

    // Simple FLR price: assume $0.02 per FLR for demo
    uint256 public flrPriceUSD = 2000; // $0.02 with 5 decimals
    int8 public flrDecimals = 5;

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    event MarketCreated(uint256 indexed marketId, string vesselIMO, string vesselName);
    event HedgeRequestCreated(uint256 indexed marketId, address indexed hedger, uint256 amount);
    event BidSubmitted(uint256 indexed marketId, uint256 bidIndex, address indexed counterparty, uint256 amount, uint256 noPrice);
    event BidAccepted(uint256 indexed marketId, uint256 bidIndex, address indexed hedger, address indexed counterparty);
    event SharesEmitted(uint256 indexed marketId, uint256 yesShares, uint256 noShares, uint256 collateral);
    event OutcomeSubmitted(uint256 indexed marketId, bool outcome);
    event MarketSettled(uint256 indexed marketId, bool outcome);
    event Claimed(address indexed user, uint256 indexed marketId, uint256 payout);
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);

    // ═══════════════════════════════════════════════════════════════════════════
    // MODIFIERS
    // ═══════════════════════════════════════════════════════════════════════════

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyOracle() {
        require(msg.sender == oracle || msg.sender == owner, "Not oracle");
        _;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    constructor() {
        owner = msg.sender;
        oracle = msg.sender;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PRICE HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    function usdToFLR(uint256 usdAmount) public view returns (uint256) {
        // usdAmount is in 18 decimals, price is in 5 decimals
        // FLR = USD / price * 10^decimals
        return (usdAmount * (10 ** uint8(flrDecimals))) / flrPriceUSD;
    }

    function setFLRPrice(uint256 price, int8 decimals) external onlyOwner {
        flrPriceUSD = price;
        flrDecimals = decimals;
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
        require(deposits[msg.sender] >= amount, "Insufficient balance");
        deposits[msg.sender] -= amount;
        payable(msg.sender).transfer(amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MARKET CREATION
    // ═══════════════════════════════════════════════════════════════════════════

    function createMarket(
        string calldata vesselIMO,
        string calldata vesselName,
        string calldata riskDescription
    ) external returns (uint256 marketId) {
        marketId = marketCount++;
        markets[marketId] = Market({
            vesselIMO: vesselIMO,
            vesselName: vesselName,
            riskDescription: riskDescription,
            totalYesShares: 0,
            totalNoShares: 0,
            totalCollateral: 0,
            state: MarketState.OPEN,
            outcome: false,
            outcomeSet: false
        });

        emit MarketCreated(marketId, vesselIMO, vesselName);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HEDGER: CREATE REQUEST (NO PRICE NEEDED)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Hedger creates a request to hedge risk
     * @dev NO price needed - counterparty sets the price via their bid
     * @param marketId Market to hedge
     * @param amountToHedge Total USD value to hedge (18 decimals)
     */
    function createHedgeRequest(
        uint256 marketId,
        uint256 amountToHedge
    ) external {
        require(markets[marketId].state == MarketState.OPEN, "Market not open");
        require(!hedgeRequests[marketId].active, "Request exists");
        require(amountToHedge > 0, "Zero amount");

        hedgeRequests[marketId] = HedgeRequest({
            hedger: msg.sender,
            amountToHedge: amountToHedge,
            filledAmount: 0,
            active: true
        });

        emit HedgeRequestCreated(marketId, msg.sender, amountToHedge);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // COUNTERPARTY: SUBMIT BID
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Counterparty submits a bid with their NO price
     * @param marketId Market to bid on
     * @param bidAmount USD amount to bid (18 decimals)
     * @param noPrice Price per NO share (e.g., 0.15e18 = 15%)
     */
    function submitBid(
        uint256 marketId,
        uint256 bidAmount,
        uint256 noPrice
    ) external {
        require(markets[marketId].state == MarketState.OPEN, "Market not open");
        HedgeRequest storage req = hedgeRequests[marketId];
        require(req.active, "No active request");
        require(bidAmount > 0, "Zero bid");
        require(noPrice > 0 && noPrice < PRICE_PRECISION, "Invalid NO price");

        // Lock counterparty's collateral based on their NO price
        uint256 collateralUSD = (bidAmount * noPrice) / PRICE_PRECISION;
        uint256 collateralFLR = usdToFLR(collateralUSD);
        require(deposits[msg.sender] >= collateralFLR, "Insufficient deposit");
        deposits[msg.sender] -= collateralFLR;

        uint256 bidIndex = bids[marketId].length;
        bids[marketId].push(Bid({
            counterparty: msg.sender,
            bidAmount: bidAmount,
            noPrice: noPrice,
            collateralFLR: collateralFLR,
            status: BidStatus.PENDING
        }));

        emit BidSubmitted(marketId, bidIndex, msg.sender, bidAmount, noPrice);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HEDGER: ACCEPT BID → IMMEDIATE SHARE EMISSION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Hedger accepts a bid - IMMEDIATELY emits shares
     * @dev This is the key difference from PoseidonVault:
     *      - No waiting for departure timestamp
     *      - Shares emit instantly upon acceptance
     *      - Hedger's YES price = 1 - counterparty's NO price
     */
    function acceptBid(
        uint256 marketId,
        uint256 bidIndex
    ) external {
        Market storage market = markets[marketId];
        require(market.state == MarketState.OPEN, "Market not open");
        
        HedgeRequest storage req = hedgeRequests[marketId];
        require(msg.sender == req.hedger, "Not hedger");
        require(req.active, "Request not active");
        
        Bid storage bid = bids[marketId][bidIndex];
        require(bid.status == BidStatus.PENDING, "Bid not pending");

        // Calculate YES price (complement of NO price)
        uint256 yesPrice = PRICE_PRECISION - bid.noPrice;
        
        // Lock hedger's collateral
        uint256 hedgerCollateralUSD = (bid.bidAmount * yesPrice) / PRICE_PRECISION;
        uint256 hedgerCollateralFLR = usdToFLR(hedgerCollateralUSD);
        require(deposits[msg.sender] >= hedgerCollateralFLR, "Hedger insufficient deposit");
        deposits[msg.sender] -= hedgerCollateralFLR;

        // Mark bid as accepted
        bid.status = BidStatus.ACCEPTED;
        req.filledAmount += bid.bidAmount;

        // ═══════════════════════════════════════════════════════════════════════
        // IMMEDIATE SHARE EMISSION (no waiting for T0)
        // ═══════════════════════════════════════════════════════════════════════

        uint256 shares = bid.bidAmount; // 1 share per USD

        // Hedger gets YES shares
        positions[marketId][req.hedger].yesShares += shares;
        positions[marketId][req.hedger].costBasis += hedgerCollateralFLR;

        // Counterparty gets NO shares
        positions[marketId][bid.counterparty].noShares += shares;
        positions[marketId][bid.counterparty].costBasis += bid.collateralFLR;

        // Update market totals
        market.totalYesShares += shares;
        market.totalNoShares += shares;
        market.totalCollateral += hedgerCollateralFLR + bid.collateralFLR;

        // Transition to ACTIVE state (shares emitted)
        market.state = MarketState.ACTIVE;

        emit BidAccepted(marketId, bidIndex, msg.sender, bid.counterparty);
        emit SharesEmitted(marketId, shares, shares, hedgerCollateralFLR + bid.collateralFLR);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CANCEL
    // ═══════════════════════════════════════════════════════════════════════════

    function cancelBid(uint256 marketId, uint256 bidIndex) external {
        Bid storage bid = bids[marketId][bidIndex];
        require(bid.counterparty == msg.sender, "Not bid owner");
        require(bid.status == BidStatus.PENDING, "Cannot cancel");

        bid.status = BidStatus.CANCELLED;
        deposits[msg.sender] += bid.collateralFLR;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ORACLE: SUBMIT OUTCOME → IMMEDIATE SETTLEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Oracle submits outcome - IMMEDIATELY settles market
     * @param marketId Market ID
     * @param yesWins true if YES wins (risk event occurred)
     */
    function submitOutcome(
        uint256 marketId,
        bool yesWins
    ) external onlyOracle {
        Market storage market = markets[marketId];
        require(market.state == MarketState.ACTIVE, "Market not active");
        require(!market.outcomeSet, "Outcome already set");

        market.outcome = yesWins;
        market.outcomeSet = true;
        market.state = MarketState.SETTLED;

        emit OutcomeSubmitted(marketId, yesWins);
        emit MarketSettled(marketId, yesWins);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CLAIM WINNINGS
    // ═══════════════════════════════════════════════════════════════════════════

    function claim(uint256 marketId) external {
        Market storage market = markets[marketId];
        require(market.state == MarketState.SETTLED, "Not settled");
        
        Position storage pos = positions[marketId][msg.sender];
        require(!pos.claimed, "Already claimed");

        uint256 winningShares = market.outcome ? pos.yesShares : pos.noShares;
        require(winningShares > 0, "No winning shares");

        pos.claimed = true;

        // Calculate payout: winner gets proportional share of total collateral
        uint256 totalWinningShares = market.outcome ? 
            market.totalYesShares : market.totalNoShares;
        
        uint256 payout = (market.totalCollateral * winningShares) / totalWinningShares;

        // Deduct protocol fee
        uint256 fee = (payout * PROTOCOL_FEE_BPS) / 10000;
        protocolFees += fee;
        payout -= fee;

        deposits[msg.sender] += payout;

        emit Claimed(msg.sender, marketId, payout);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return markets[marketId];
    }

    function getHedgeRequest(uint256 marketId) external view returns (HedgeRequest memory) {
        return hedgeRequests[marketId];
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

    function setOracle(address _oracle) external onlyOwner {
        oracle = _oracle;
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = protocolFees;
        require(fees > 0, "No fees");
        protocolFees = 0;
        payable(owner).transfer(fees);
    }

    receive() external payable {
        deposits[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }
}
