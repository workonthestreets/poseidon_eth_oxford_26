// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {FtsoV2Interface} from "@flarenetwork/flare-periphery-contracts/coston2/FtsoV2Interface.sol";

/**
 * @title PoseidonVault
 * @notice Maritime Risk Prediction Market with Pre-Signed Commitments
 * @dev Implements the T-1 → T0 → T1 → T2 → T3 lifecycle for maritime hedging
 * 
 * ══════════════════════════════════════════════════════════════════════════════
 * LIFECYCLE PHASES
 * ══════════════════════════════════════════════════════════════════════════════
 * 
 * T-1: COMMITMENT_OPEN
 *      - Hedger posts RFQ with amountToHedge, minBidSize
 *      - Counterparties submit bids (bidAmount, noPrice)
 *      - Hedger accepts bids → commitments locked
 *      - Cancel rules: Hedger only if filledAmount == 0
 *                      Counterparty only if bid not accepted
 * 
 * T0: VOYAGE_ACTIVE (triggered by departure)
 *      - Oracle confirms vessel departure
 *      - emitShares() mints YES/NO shares to committed parties
 *      - No user interaction required (pre-signed)
 * 
 * T1: VOYAGE_ACTIVE (observation only)
 *      - NO trading, NO new RFQs
 *      - Risk events may occur
 *      - Shares locked
 * 
 * T2: PENDING_SETTLEMENT
 *      - Oracle submits synthetic outcome data
 *      - Data is FINAL and undisputable (DataSource.SYNTHETIC)
 * 
 * T3: SETTLED
 *      - settle() determines winners
 *      - claim() distributes payouts (minus 2% fee)
 */
contract PoseidonVault {
    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════

    bytes21 public constant FLR_USD_FEED_ID = bytes21(0x01464c522f55534400000000000000000000000000);
    uint256 public constant PROTOCOL_FEE_BPS = 200; // 2%
    uint256 public constant PRICE_PRECISION = 1e18; // 18 decimals for prices

    // ═══════════════════════════════════════════════════════════════════════════
    // ENUMS
    // ═══════════════════════════════════════════════════════════════════════════

    enum MarketState {
        COMMITMENT_OPEN,     // T-1: Accepting hedger/counterparty commitments
        VOYAGE_ACTIVE,       // T0-T1: Shares emitted, locked, no trading
        PENDING_SETTLEMENT,  // T2: Oracle data submitted, awaiting settle()
        SETTLED              // T3: Outcome determined, claims enabled
    }

    enum RiskType {
        PSC_DETENTION,       // Port State Control detention
        CASUALTY,            // Major casualty or total loss
        VOYAGE_COMPLETION    // On-time arrival
    }

    enum DataSource {
        NONE,                // No data submitted yet
        SYNTHETIC,           // Simulated data - FINAL, undisputable
        FDC_VERIFIED         // Flare Data Connector verified
    }

    enum CommitmentStatus {
        PENDING,             // Bid submitted, not yet accepted
        ACCEPTED,            // Hedger accepted, locked for emission
        CANCELLED,           // Cancelled by counterparty (only if pending)
        EMITTED              // Shares minted at T0
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════════════════════════════════════════

    struct Market {
        string vesselIMO;
        string vesselName;
        RiskType riskType;
        uint256 commitmentDeadline;  // T-1 ends
        uint256 departureTime;       // T0: shares emit
        uint256 arrivalTime;         // T2: market closes
        uint256 totalYesShares;
        uint256 totalNoShares;
        uint256 totalCollateral;     // FLR locked
        MarketState state;
        OracleData oracleData;
    }

    struct OracleData {
        DataSource source;
        uint256 timestamp;
        bool outcome;            // true = YES wins
        bytes32 dataHash;        // keccak256 of raw data for audit
        bool finalized;          // true = cannot be changed
    }

    struct HedgeRequest {
        address hedger;
        uint256 amountToHedge;   // Total USD value to hedge (18 decimals)
        uint256 minBidSize;      // Minimum acceptable bid (18 decimals)
        uint256 filledAmount;    // Total accepted bids
        uint256 yesPrice;        // Price per YES share (18 decimals, e.g., 0.85e18 = 85¢)
        bool active;
        bool emitted;            // Shares minted
    }

    struct CounterpartyBid {
        address counterparty;
        uint256 bidAmount;       // USD value (18 decimals)
        uint256 noPrice;         // Price per NO share (18 decimals, e.g., 0.15e18 = 15¢)
        uint256 collateralFLR;   // FLR locked for this bid
        CommitmentStatus status;
    }

    struct Position {
        uint256 yesShares;
        uint256 noShares;
        uint256 costBasis;       // FLR spent
        bool claimed;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    address public owner;
    address public operator;
    address public oracle;

    uint256 public marketCount;
    mapping(uint256 => Market) public markets;
    
    // Market ID → Hedge Request
    mapping(uint256 => HedgeRequest) public hedgeRequests;
    
    // Market ID → Array of counterparty bids
    mapping(uint256 => CounterpartyBid[]) public bids;
    
    // Market ID → User → Position
    mapping(uint256 => mapping(address => Position)) public positions;
    
    // Market ID → Participants list
    mapping(uint256 => address[]) internal participants;

    // User deposits
    mapping(address => uint256) public deposits;

    // Protocol fees
    uint256 public protocolFees;

    // FTSO price cache
    uint256 public flrPriceUSD;
    int8 public flrDecimals;
    uint64 public priceTimestamp;

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    event MarketCreated(uint256 indexed marketId, string vesselIMO, RiskType riskType, uint256 departureTime);
    event HedgeRequestCreated(uint256 indexed marketId, address indexed hedger, uint256 amount, uint256 minBid);
    event BidSubmitted(uint256 indexed marketId, uint256 bidIndex, address indexed counterparty, uint256 amount, uint256 noPrice);
    event BidAccepted(uint256 indexed marketId, uint256 bidIndex, address indexed hedger, address indexed counterparty);
    event BidCancelled(uint256 indexed marketId, uint256 bidIndex, address indexed counterparty);
    event HedgeRequestCancelled(uint256 indexed marketId, address indexed hedger);
    event DepartureConfirmed(uint256 indexed marketId, uint256 timestamp);
    event SharesEmitted(uint256 indexed marketId, uint256 totalYes, uint256 totalNo, uint256 collateral);
    event SyntheticOutcomeSubmitted(uint256 indexed marketId, bool outcome, bytes32 dataHash);
    event MarketSettled(uint256 indexed marketId, bool outcome, DataSource source);
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

    modifier onlyOperator() {
        require(msg.sender == operator || msg.sender == owner, "Not operator");
        _;
    }

    modifier onlyOracle() {
        require(msg.sender == oracle || msg.sender == owner, "Not oracle");
        _;
    }

    modifier inState(uint256 marketId, MarketState required) {
        require(markets[marketId].state == required, "Invalid market state");
        _;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    constructor() {
        owner = msg.sender;
        operator = msg.sender;
        oracle = msg.sender;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FTSO PRICE ORACLE
    // ═══════════════════════════════════════════════════════════════════════════

    function _tryUpdatePrice() internal {
        address registryAddr = 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019;
        uint256 codeSize;
        assembly { codeSize := extcodesize(registryAddr) }
        
        if (codeSize > 0) {
            try ContractRegistry.getFtsoV2().getFeedById(FLR_USD_FEED_ID) returns (
                uint256 price, int8 decimals, uint64 timestamp
            ) {
                flrPriceUSD = price;
                flrDecimals = decimals;
                priceTimestamp = timestamp;
            } catch {}
        }
    }

    function usdToFLR(uint256 usdAmount) public view returns (uint256) {
        uint256 price = flrPriceUSD;
        int8 decimals = flrDecimals;
        if (price == 0) { price = 2000; decimals = 5; } // Default: $0.02
        
        if (decimals >= 0) {
            return (usdAmount * (10 ** uint8(decimals))) / price;
        } else {
            return usdAmount / (price * (10 ** uint8(-decimals)));
        }
    }

    function flrToUSD(uint256 flrAmount) public view returns (uint256) {
        uint256 price = flrPriceUSD;
        int8 decimals = flrDecimals;
        if (price == 0) { price = 2000; decimals = 5; }
        
        if (decimals >= 0) {
            return (flrAmount * price) / (10 ** uint8(decimals));
        } else {
            return flrAmount * price * (10 ** uint8(-decimals));
        }
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
        RiskType riskType,
        uint256 commitmentDeadline,
        uint256 departureTime,
        uint256 arrivalTime
    ) external onlyOperator returns (uint256 marketId) {
        require(commitmentDeadline > block.timestamp, "Invalid commitment deadline");
        require(departureTime > commitmentDeadline, "Departure must be after commitment deadline");
        require(arrivalTime > departureTime, "Arrival must be after departure");

        marketId = marketCount++;
        markets[marketId] = Market({
            vesselIMO: vesselIMO,
            vesselName: vesselName,
            riskType: riskType,
            commitmentDeadline: commitmentDeadline,
            departureTime: departureTime,
            arrivalTime: arrivalTime,
            totalYesShares: 0,
            totalNoShares: 0,
            totalCollateral: 0,
            state: MarketState.COMMITMENT_OPEN,
            oracleData: OracleData({
                source: DataSource.NONE,
                timestamp: 0,
                outcome: false,
                dataHash: bytes32(0),
                finalized: false
            })
        });

        emit MarketCreated(marketId, vesselIMO, riskType, departureTime);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // T-1: COMMITMENT PHASE
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Hedger creates a request to hedge risk
     * @param marketId Market to hedge
     * @param amountToHedge Total USD value to hedge (18 decimals)
     * @param minBidSize Minimum acceptable bid size (18 decimals)
     * @param yesPrice Price willing to pay per YES share (18 decimals, e.g., 0.85e18)
     */
    function createHedgeRequest(
        uint256 marketId,
        uint256 amountToHedge,
        uint256 minBidSize,
        uint256 yesPrice
    ) external inState(marketId, MarketState.COMMITMENT_OPEN) {
        Market storage market = markets[marketId];
        require(block.timestamp < market.commitmentDeadline, "Commitment deadline passed");
        require(!hedgeRequests[marketId].active, "Hedge request exists");
        require(amountToHedge > 0, "Zero amount");
        require(minBidSize > 0 && minBidSize <= amountToHedge, "Invalid min bid");
        require(yesPrice > 0 && yesPrice < PRICE_PRECISION, "Invalid YES price");

        // Lock hedger's collateral (yesPrice per share)
        uint256 maxCollateralUSD = (amountToHedge * yesPrice) / PRICE_PRECISION;
        uint256 collateralFLR = usdToFLR(maxCollateralUSD);
        require(deposits[msg.sender] >= collateralFLR, "Insufficient deposit");
        deposits[msg.sender] -= collateralFLR;

        hedgeRequests[marketId] = HedgeRequest({
            hedger: msg.sender,
            amountToHedge: amountToHedge,
            minBidSize: minBidSize,
            filledAmount: 0,
            yesPrice: yesPrice,
            active: true,
            emitted: false
        });

        emit HedgeRequestCreated(marketId, msg.sender, amountToHedge, minBidSize);
    }

    /**
     * @notice Counterparty submits a bid to take NO position
     * @param marketId Market to bid on
     * @param bidAmount USD amount to bid (18 decimals)
     * @param noPrice Price per NO share (18 decimals, e.g., 0.15e18)
     */
    function submitBid(
        uint256 marketId,
        uint256 bidAmount,
        uint256 noPrice
    ) external inState(marketId, MarketState.COMMITMENT_OPEN) {
        Market storage market = markets[marketId];
        HedgeRequest storage req = hedgeRequests[marketId];
        
        require(block.timestamp < market.commitmentDeadline, "Commitment deadline passed");
        require(req.active, "No active hedge request");
        require(bidAmount >= req.minBidSize, "Bid below minimum");
        require(noPrice > 0 && noPrice < PRICE_PRECISION, "Invalid NO price");
        
        // In RFQ model, counterparty sets their own NO price
        // No constraint that YES + NO = 1 (spread goes to liquidity providers)

        _tryUpdatePrice();

        // Lock counterparty's collateral
        uint256 collateralUSD = (bidAmount * noPrice) / PRICE_PRECISION;
        uint256 collateralFLR = usdToFLR(collateralUSD);
        require(deposits[msg.sender] >= collateralFLR, "Insufficient deposit");
        deposits[msg.sender] -= collateralFLR;

        uint256 bidIndex = bids[marketId].length;
        bids[marketId].push(CounterpartyBid({
            counterparty: msg.sender,
            bidAmount: bidAmount,
            noPrice: noPrice,
            collateralFLR: collateralFLR,
            status: CommitmentStatus.PENDING
        }));

        emit BidSubmitted(marketId, bidIndex, msg.sender, bidAmount, noPrice);
    }

    /**
     * @notice Hedger accepts a counterparty bid
     * @param marketId Market ID
     * @param bidIndex Index of bid to accept
     */
    function acceptBid(
        uint256 marketId,
        uint256 bidIndex
    ) external inState(marketId, MarketState.COMMITMENT_OPEN) {
        HedgeRequest storage req = hedgeRequests[marketId];
        require(msg.sender == req.hedger, "Not hedger");
        require(req.active, "Request not active");
        
        CounterpartyBid storage bid = bids[marketId][bidIndex];
        require(bid.status == CommitmentStatus.PENDING, "Bid not pending");
        
        // Check we don't exceed total amount
        uint256 remaining = req.amountToHedge - req.filledAmount;
        uint256 fillAmount = bid.bidAmount > remaining ? remaining : bid.bidAmount;
        
        bid.status = CommitmentStatus.ACCEPTED;
        req.filledAmount += fillAmount;

        emit BidAccepted(marketId, bidIndex, msg.sender, bid.counterparty);
    }

    /**
     * @notice Counterparty cancels their pending bid
     * @dev Only allowed if bid has NOT been accepted
     */
    function cancelBid(uint256 marketId, uint256 bidIndex) external {
        CounterpartyBid storage bid = bids[marketId][bidIndex];
        require(bid.counterparty == msg.sender, "Not bid owner");
        require(bid.status == CommitmentStatus.PENDING, "Cannot cancel accepted bid");

        bid.status = CommitmentStatus.CANCELLED;
        
        // Refund collateral
        deposits[msg.sender] += bid.collateralFLR;

        emit BidCancelled(marketId, bidIndex, msg.sender);
    }

    /**
     * @notice Hedger cancels their hedge request
     * @dev Only allowed if NO bids have been accepted (filledAmount == 0)
     */
    function cancelHedgeRequest(uint256 marketId) external {
        HedgeRequest storage req = hedgeRequests[marketId];
        require(msg.sender == req.hedger, "Not hedger");
        require(req.active, "Request not active");
        require(req.filledAmount == 0, "Cannot cancel: bids accepted");

        req.active = false;

        // Refund hedger's locked collateral
        uint256 maxCollateralUSD = (req.amountToHedge * req.yesPrice) / PRICE_PRECISION;
        uint256 collateralFLR = usdToFLR(maxCollateralUSD);
        deposits[msg.sender] += collateralFLR;

        // Refund all pending bids
        CounterpartyBid[] storage marketBids = bids[marketId];
        for (uint256 i = 0; i < marketBids.length; i++) {
            if (marketBids[i].status == CommitmentStatus.PENDING) {
                marketBids[i].status = CommitmentStatus.CANCELLED;
                deposits[marketBids[i].counterparty] += marketBids[i].collateralFLR;
            }
        }

        emit HedgeRequestCancelled(marketId, msg.sender);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // T0: DEPARTURE & EMISSION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Oracle confirms vessel departure, triggering share emission
     * @dev Automatically mints YES/NO shares to all committed parties
     */
    function confirmDeparture(uint256 marketId) 
        external 
        onlyOracle 
        inState(marketId, MarketState.COMMITMENT_OPEN) 
    {
        Market storage market = markets[marketId];
        HedgeRequest storage req = hedgeRequests[marketId];
        
        require(req.active && req.filledAmount > 0, "No committed positions");
        
        _tryUpdatePrice();

        uint256 totalYes = 0;
        uint256 totalNo = 0;
        uint256 totalCollateral = 0;

        // Emit shares for hedger (YES position)
        uint256 hedgerShares = req.filledAmount; // 1 share per USD
        positions[marketId][req.hedger].yesShares += hedgerShares;
        totalYes += hedgerShares;
        
        // Calculate hedger's actual collateral used
        uint256 hedgerCollateralUSD = (hedgerShares * req.yesPrice) / PRICE_PRECISION;
        uint256 hedgerCollateralFLR = usdToFLR(hedgerCollateralUSD);
        positions[marketId][req.hedger].costBasis += hedgerCollateralFLR;
        totalCollateral += hedgerCollateralFLR;
        
        _addParticipant(marketId, req.hedger);

        // Emit shares for counterparties (NO positions)
        CounterpartyBid[] storage marketBids = bids[marketId];
        for (uint256 i = 0; i < marketBids.length; i++) {
            CounterpartyBid storage bid = marketBids[i];
            if (bid.status == CommitmentStatus.ACCEPTED) {
                bid.status = CommitmentStatus.EMITTED;
                
                uint256 cpShares = bid.bidAmount; // 1 share per USD
                positions[marketId][bid.counterparty].noShares += cpShares;
                positions[marketId][bid.counterparty].costBasis += bid.collateralFLR;
                totalNo += cpShares;
                totalCollateral += bid.collateralFLR;
                
                _addParticipant(marketId, bid.counterparty);
            } else if (bid.status == CommitmentStatus.PENDING) {
                // Refund unaccepted bids
                bid.status = CommitmentStatus.CANCELLED;
                deposits[bid.counterparty] += bid.collateralFLR;
            }
        }

        // Refund excess hedger collateral (if not fully filled)
        if (req.filledAmount < req.amountToHedge) {
            uint256 unusedUSD = ((req.amountToHedge - req.filledAmount) * req.yesPrice) / PRICE_PRECISION;
            uint256 refundFLR = usdToFLR(unusedUSD);
            deposits[req.hedger] += refundFLR;
        }

        req.emitted = true;
        market.totalYesShares = totalYes;
        market.totalNoShares = totalNo;
        market.totalCollateral = totalCollateral;
        market.state = MarketState.VOYAGE_ACTIVE;

        emit DepartureConfirmed(marketId, block.timestamp);
        emit SharesEmitted(marketId, totalYes, totalNo, totalCollateral);
    }

    function _addParticipant(uint256 marketId, address user) internal {
        Position storage pos = positions[marketId][user];
        if (pos.yesShares == 0 && pos.noShares == 0) {
            participants[marketId].push(user);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // T2: ORACLE DATA SUBMISSION
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Submit synthetic outcome data (undisputable)
     * @param marketId Market ID
     * @param outcome true = YES wins (risk event occurred)
     * @param dataHash keccak256 hash of raw simulation data for audit
     */
    function submitSyntheticOutcome(
        uint256 marketId,
        bool outcome,
        bytes32 dataHash
    ) external onlyOracle inState(marketId, MarketState.VOYAGE_ACTIVE) {
        Market storage market = markets[marketId];
        require(!market.oracleData.finalized, "Data already finalized");

        market.oracleData = OracleData({
            source: DataSource.SYNTHETIC,
            timestamp: block.timestamp,
            outcome: outcome,
            dataHash: dataHash,
            finalized: true  // IMMEDIATELY FINAL - no dispute for synthetic
        });

        market.state = MarketState.PENDING_SETTLEMENT;

        emit SyntheticOutcomeSubmitted(marketId, outcome, dataHash);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // T3: SETTLEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Settle market based on oracle data
     */
    function settle(uint256 marketId) 
        external 
        inState(marketId, MarketState.PENDING_SETTLEMENT) 
    {
        Market storage market = markets[marketId];
        require(market.oracleData.finalized, "Oracle data not finalized");

        market.state = MarketState.SETTLED;

        emit MarketSettled(marketId, market.oracleData.outcome, market.oracleData.source);
    }

    /**
     * @notice Claim winnings after settlement
     */
    function claim(uint256 marketId) external inState(marketId, MarketState.SETTLED) {
        Market storage market = markets[marketId];
        Position storage pos = positions[marketId][msg.sender];
        
        require(!pos.claimed, "Already claimed");
        
        uint256 winningShares = market.oracleData.outcome ? pos.yesShares : pos.noShares;
        require(winningShares > 0, "No winning shares");

        pos.claimed = true;

        // Calculate payout: proportional share of total collateral
        uint256 totalWinningShares = market.oracleData.outcome ? 
            market.totalYesShares : market.totalNoShares;
        
        uint256 payout = (market.totalCollateral * winningShares) / totalWinningShares;

        // Deduct protocol fee
        uint256 fee = (payout * PROTOCOL_FEE_BPS) / 10000;
        protocolFees += fee;
        payout -= fee;

        // Credit to user's deposit
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

    function getBids(uint256 marketId) external view returns (CounterpartyBid[] memory) {
        return bids[marketId];
    }

    function getBid(uint256 marketId, uint256 bidIndex) external view returns (CounterpartyBid memory) {
        return bids[marketId][bidIndex];
    }

    function getPosition(uint256 marketId, address user) external view returns (Position memory) {
        return positions[marketId][user];
    }

    function getParticipants(uint256 marketId) external view returns (address[] memory) {
        return participants[marketId];
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

    function setOperator(address _operator) external onlyOwner {
        operator = _operator;
    }

    function setOracle(address _oracle) external onlyOwner {
        oracle = _oracle;
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = protocolFees;
        require(fees > 0, "No fees");
        protocolFees = 0;
        payable(owner).transfer(fees);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    receive() external payable {
        deposits[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }
}
