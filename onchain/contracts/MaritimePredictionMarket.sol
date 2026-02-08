// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "./MaritimeRiskOracle.sol";

/// @notice Interface for oracle query functions used by this contract
interface IMaritimeRiskOracle {
    function wasVesselDetained(string memory imo) external view returns (bool);
    function hadCasualty(string memory imo, string memory casualtyType) external view returns (bool);
    function hasVesselArrived(string memory imo) external view returns (bool);
    function isVesselMoored(string memory imo) external view returns (bool);
}

/**
 * @title MaritimePredictionMarket
 * @notice Prediction market contract that settles based on verified maritime data
 * @dev Uses MaritimeRiskOracle for FDC-verified data
 */
contract MaritimePredictionMarket {
    
    // ============ Enums ============
    
    enum MarketType {
        PSC_DETENTION,      // Will vessel be detained?
        CASUALTY,           // Will casualty occur?
        VOYAGE_COMPLETION,  // Will vessel arrive on time?
        DRY_DOCK_TIMING,    // Will dry dock complete on time?
        PORT_CONGESTION     // Will wait time exceed threshold?
    }
    
    enum MarketStatus {
        OPEN,       // Accepting bets
        LOCKED,     // No more bets, waiting for settlement
        SETTLED,    // Outcome determined
        CANCELLED   // Market cancelled, refunds available
    }
    
    enum Outcome {
        UNDECIDED,
        YES,
        NO
    }
    
    // ============ Structs ============
    
    struct Market {
        uint256 id;
        MarketType marketType;
        MarketStatus status;
        Outcome outcome;
        
        string vesselIMO;
        string vesselName;
        string description;
        
        uint256 createdAt;
        uint256 expiresAt;
        uint256 settledAt;
        
        uint256 totalYesShares;
        uint256 totalNoShares;
        uint256 totalPool;
        
        // Market-specific parameters
        string targetPort;           // For PSC/Congestion markets
        string casualtyType;         // For Casualty markets
        uint256 thresholdHours;      // For timing markets
    }
    
    struct Position {
        uint256 yesShares;
        uint256 noShares;
        bool claimed;
    }
    
    // ============ Storage ============
    
    IMaritimeRiskOracle public oracle;
    
    uint256 public nextMarketId;
    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(address => Position)) public positions;
    
    address public owner;
    uint256 public protocolFeePercent = 200; // 2% (basis points)
    uint256 public constant BASIS_POINTS = 10000;
    
    // ============ Events ============
    
    event MarketCreated(
        uint256 indexed marketId,
        MarketType marketType,
        string vesselIMO,
        string description,
        uint256 expiresAt
    );
    
    event SharesPurchased(
        uint256 indexed marketId,
        address indexed buyer,
        bool isYes,
        uint256 shares,
        uint256 cost
    );
    
    event MarketSettled(
        uint256 indexed marketId,
        Outcome outcome,
        uint256 totalPool
    );
    
    event WinningsClaimed(
        uint256 indexed marketId,
        address indexed claimer,
        uint256 amount
    );
    
    // ============ Constructor ============
    
    constructor(address _oracle) {
        oracle = IMaritimeRiskOracle(_oracle);
        owner = msg.sender;
        nextMarketId = 1;
    }
    
    // ============ Market Creation ============
    
    function createPSCDetentionMarket(
        string calldata vesselIMO,
        string calldata vesselName,
        string calldata targetPort,
        uint256 expiresAt
    ) external returns (uint256) {
        require(expiresAt > block.timestamp, "Invalid expiry");
        
        uint256 marketId = nextMarketId++;
        
        markets[marketId] = Market({
            id: marketId,
            marketType: MarketType.PSC_DETENTION,
            status: MarketStatus.OPEN,
            outcome: Outcome.UNDECIDED,
            vesselIMO: vesselIMO,
            vesselName: vesselName,
            description: string(abi.encodePacked(
                "Will vessel ", vesselName, " (IMO: ", vesselIMO, 
                ") be detained at ", targetPort, "?"
            )),
            createdAt: block.timestamp,
            expiresAt: expiresAt,
            settledAt: 0,
            totalYesShares: 0,
            totalNoShares: 0,
            totalPool: 0,
            targetPort: targetPort,
            casualtyType: "",
            thresholdHours: 0
        });
        
        emit MarketCreated(marketId, MarketType.PSC_DETENTION, vesselIMO, 
            markets[marketId].description, expiresAt);
        
        return marketId;
    }
    
    function createCasualtyMarket(
        string calldata vesselIMO,
        string calldata vesselName,
        string calldata casualtyType,
        uint256 expiresAt
    ) external returns (uint256) {
        require(expiresAt > block.timestamp, "Invalid expiry");
        
        uint256 marketId = nextMarketId++;
        
        markets[marketId] = Market({
            id: marketId,
            marketType: MarketType.CASUALTY,
            status: MarketStatus.OPEN,
            outcome: Outcome.UNDECIDED,
            vesselIMO: vesselIMO,
            vesselName: vesselName,
            description: string(abi.encodePacked(
                "Will vessel ", vesselName, " experience a ", casualtyType, " incident?"
            )),
            createdAt: block.timestamp,
            expiresAt: expiresAt,
            settledAt: 0,
            totalYesShares: 0,
            totalNoShares: 0,
            totalPool: 0,
            targetPort: "",
            casualtyType: casualtyType,
            thresholdHours: 0
        });
        
        emit MarketCreated(marketId, MarketType.CASUALTY, vesselIMO,
            markets[marketId].description, expiresAt);
        
        return marketId;
    }
    
    function createVoyageCompletionMarket(
        string calldata vesselIMO,
        string calldata vesselName,
        string calldata destinationPort,
        uint256 thresholdHours,
        uint256 expiresAt
    ) external returns (uint256) {
        require(expiresAt > block.timestamp, "Invalid expiry");
        
        uint256 marketId = nextMarketId++;
        
        markets[marketId] = Market({
            id: marketId,
            marketType: MarketType.VOYAGE_COMPLETION,
            status: MarketStatus.OPEN,
            outcome: Outcome.UNDECIDED,
            vesselIMO: vesselIMO,
            vesselName: vesselName,
            description: string(abi.encodePacked(
                "Will vessel ", vesselName, " arrive at ", destinationPort, " on time?"
            )),
            createdAt: block.timestamp,
            expiresAt: expiresAt,
            settledAt: 0,
            totalYesShares: 0,
            totalNoShares: 0,
            totalPool: 0,
            targetPort: destinationPort,
            casualtyType: "",
            thresholdHours: thresholdHours
        });
        
        emit MarketCreated(marketId, MarketType.VOYAGE_COMPLETION, vesselIMO,
            markets[marketId].description, expiresAt);
        
        return marketId;
    }
    
    // ============ Trading ============
    
    function buyYesShares(uint256 marketId) external payable {
        Market storage market = markets[marketId];
        require(market.status == MarketStatus.OPEN, "Market not open");
        require(block.timestamp < market.expiresAt, "Market expired");
        require(msg.value > 0, "Must send value");
        
        uint256 shares = msg.value; // 1:1 for simplicity
        
        market.totalYesShares += shares;
        market.totalPool += msg.value;
        positions[marketId][msg.sender].yesShares += shares;
        
        emit SharesPurchased(marketId, msg.sender, true, shares, msg.value);
    }
    
    function buyNoShares(uint256 marketId) external payable {
        Market storage market = markets[marketId];
        require(market.status == MarketStatus.OPEN, "Market not open");
        require(block.timestamp < market.expiresAt, "Market expired");
        require(msg.value > 0, "Must send value");
        
        uint256 shares = msg.value; // 1:1 for simplicity
        
        market.totalNoShares += shares;
        market.totalPool += msg.value;
        positions[marketId][msg.sender].noShares += shares;
        
        emit SharesPurchased(marketId, msg.sender, false, shares, msg.value);
    }
    
    // ============ Settlement ============
    
    /**
     * @notice Lock market for settlement (no more trading)
     */
    function lockMarket(uint256 marketId) external {
        Market storage market = markets[marketId];
        require(market.status == MarketStatus.OPEN, "Market not open");
        require(block.timestamp >= market.expiresAt, "Market not expired");
        
        market.status = MarketStatus.LOCKED;
    }
    
    /**
     * @notice Settle PSC Detention market based on oracle data
     * @dev Reads PSC record directly — vessel should have arrived at destination
     */
    function settlePSCDetentionMarket(uint256 marketId) external {
        Market storage market = markets[marketId];
        require(market.status == MarketStatus.LOCKED || 
                (market.status == MarketStatus.OPEN && block.timestamp >= market.expiresAt), 
                "Cannot settle");
        require(market.marketType == MarketType.PSC_DETENTION, "Wrong market type");
        
        // Vessel must have arrived at destination before PSC settlement
        require(oracle.hasVesselArrived(market.vesselIMO), "Vessel must have arrived");
        
        // Check detention status via dedicated query
        bool wasDetained = oracle.wasVesselDetained(market.vesselIMO);
        
        market.outcome = wasDetained ? Outcome.YES : Outcome.NO;
        market.status = MarketStatus.SETTLED;
        market.settledAt = block.timestamp;
        
        emit MarketSettled(marketId, market.outcome, market.totalPool);
    }
    
    /**
     * @notice Settle Casualty market based on oracle data
     * @dev Can settle mid-voyage if casualty detected (early settlement)
     */
    function settleCasualtyMarket(uint256 marketId) external {
        Market storage market = markets[marketId];
        require(market.status == MarketStatus.LOCKED || 
                (market.status == MarketStatus.OPEN && block.timestamp >= market.expiresAt), 
                "Cannot settle");
        require(market.marketType == MarketType.CASUALTY, "Wrong market type");
        
        // Check if the specific casualty type occurred via dedicated query
        bool hadCasualty = oracle.hadCasualty(market.vesselIMO, market.casualtyType);
        
        if (hadCasualty) {
            market.outcome = Outcome.YES;
        } else {
            // No casualty — can only settle as NO after arrival
            require(oracle.hasVesselArrived(market.vesselIMO), "Wait for arrival or casualty detection");
            market.outcome = Outcome.NO;
        }
        
        market.status = MarketStatus.SETTLED;
        market.settledAt = block.timestamp;
        
        emit MarketSettled(marketId, market.outcome, market.totalPool);
    }
    
    /**
     * @notice Settle Voyage Completion market based on oracle data
     * @dev Uses hasVesselArrived() to check if vessel reached destination
     */
    function settleVoyageCompletionMarket(uint256 marketId) external {
        Market storage market = markets[marketId];
        require(market.status == MarketStatus.LOCKED || 
                (market.status == MarketStatus.OPEN && block.timestamp >= market.expiresAt), 
                "Cannot settle");
        require(market.marketType == MarketType.VOYAGE_COMPLETION, "Wrong market type");
        
        // Check if vessel has arrived at destination
        bool arrived = oracle.hasVesselArrived(market.vesselIMO);
        
        market.outcome = arrived ? Outcome.YES : Outcome.NO;
        market.status = MarketStatus.SETTLED;
        market.settledAt = block.timestamp;
        
        emit MarketSettled(marketId, market.outcome, market.totalPool);
    }
    
    /**
     * @notice Manual settlement by owner (for edge cases)
     */
    function settleMarketManual(uint256 marketId, Outcome outcome) external {
        require(msg.sender == owner, "Only owner");
        Market storage market = markets[marketId];
        require(market.status != MarketStatus.SETTLED, "Already settled");
        require(outcome != Outcome.UNDECIDED, "Invalid outcome");
        
        market.outcome = outcome;
        market.status = MarketStatus.SETTLED;
        market.settledAt = block.timestamp;
        
        emit MarketSettled(marketId, outcome, market.totalPool);
    }
    
    // ============ Claims ============
    
    function claimWinnings(uint256 marketId) external {
        Market storage market = markets[marketId];
        require(market.status == MarketStatus.SETTLED, "Not settled");
        
        Position storage pos = positions[marketId][msg.sender];
        require(!pos.claimed, "Already claimed");
        require(pos.yesShares > 0 || pos.noShares > 0, "No position");
        
        uint256 winningShares;
        uint256 totalWinningShares;
        
        if (market.outcome == Outcome.YES) {
            winningShares = pos.yesShares;
            totalWinningShares = market.totalYesShares;
        } else {
            winningShares = pos.noShares;
            totalWinningShares = market.totalNoShares;
        }
        
        require(winningShares > 0, "No winning shares");
        
        // Calculate payout
        uint256 grossPayout = (market.totalPool * winningShares) / totalWinningShares;
        uint256 fee = (grossPayout * protocolFeePercent) / BASIS_POINTS;
        uint256 netPayout = grossPayout - fee;
        
        pos.claimed = true;
        
        (bool success, ) = msg.sender.call{value: netPayout}("");
        require(success, "Transfer failed");
        
        emit WinningsClaimed(marketId, msg.sender, netPayout);
    }
    
    // ============ View Functions ============
    
    function getMarket(uint256 marketId) external view returns (Market memory) {
        return markets[marketId];
    }
    
    function getPosition(uint256 marketId, address user) external view returns (Position memory) {
        return positions[marketId][user];
    }
    
    function getMarketOdds(uint256 marketId) external view returns (uint256 yesPercent, uint256 noPercent) {
        Market storage market = markets[marketId];
        uint256 total = market.totalYesShares + market.totalNoShares;
        if (total == 0) {
            return (50, 50);
        }
        yesPercent = (market.totalYesShares * 100) / total;
        noPercent = 100 - yesPercent;
    }
    
    // ============ Admin ============
    
    function setProtocolFee(uint256 newFeePercent) external {
        require(msg.sender == owner, "Only owner");
        require(newFeePercent <= 1000, "Fee too high"); // Max 10%
        protocolFeePercent = newFeePercent;
    }
    
    function withdrawFees() external {
        require(msg.sender == owner, "Only owner");
        (bool success, ) = owner.call{value: address(this).balance}("");
        require(success, "Transfer failed");
    }
    
    function updateOracle(address newOracle) external {
        require(msg.sender == owner, "Only owner");
        oracle = IMaritimeRiskOracle(newOracle);
    }
}
