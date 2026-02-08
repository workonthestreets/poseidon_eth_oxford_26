// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "./MaritimeRiskOracle.sol";
import "./MaritimeRFQVault.sol";

/**
 * @title VoyageAuction
 * @notice Pre-voyage closed auction for parametric maritime risk protection
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * DESIGN RATIONALE — Anti-Toxic-Flow Pivot
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Problem: In an always-open prediction market, a speculator who sees a collision
 *          on satellite data before settlement can front-run the outcome (toxic flow).
 *
 * Solution: A one-shot sealed-bid auction that closes at departure time.
 *           No secondary trading is allowed after departure.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * VESSEL STATE VALIDATION
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * A vessel being "Moored" is necessary but NOT sufficient for market creation.
 * A vessel can be moored at:
 *   - Port of loading (pre-departure) → market creation allowed
 *   - Port of discharge (post-arrival) → settlement time, NOT creation time
 *
 * We distinguish these using Datalastic /vessel_pro data:
 *   - atd_epoch = 0  → vessel has NOT departed → at loading port ✓
 *   - atd_epoch > 0 AND ata_epoch > 0 → vessel has ARRIVED → at discharge port ✗
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * RISK-TYPE-SPECIFIC SETTLEMENT RULES
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ┌──────────────────┬──────────────────────────┬────────────────────────────┐
 * │ Risk Type        │ When to Settle           │ Oracle Check               │
 * ├──────────────────┼──────────────────────────┼────────────────────────────┤
 * │ PSC_DETENTION    │ At arrival (vessel moored │ wasVesselDetained() AND    │
 * │                  │ at destination, ETA past) │ hasVesselArrived()         │
 * ├──────────────────┼──────────────────────────┼────────────────────────────┤
 * │ COLLISION        │ Mid-voyage OR at arrival  │ hadCasualty("Collision")   │
 * │ GROUNDING        │ Mid-voyage OR at arrival  │ hadCasualty("Grounding")   │
 * │ CASUALTY_OTHER   │ Mid-voyage OR at arrival  │ casualtyRecords.detected   │
 * ├──────────────────┼──────────────────────────┼────────────────────────────┤
 * │ VOYAGE_DELAY     │ At or after ETA           │ !hasVesselArrived() after  │
 * │                  │                          │ etaEpoch has passed         │
 * └──────────────────┴──────────────────────────┴────────────────────────────┘
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * VAULT INTEGRATION
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * MaritimeRFQVault handles:
 *   - Deposit/withdraw of FLR for hedgers and bidders
 *   - Balance tracking (deposits mapping)
 *   - FTSO price oracle (FLR/USD conversion)
 *   - Protocol fee accounting
 *
 * VoyageAuction draws collateral from vault deposits and credits payouts back.
 * After auction finalization, minted YES/NO share positions are tracked here.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * LIFECYCLE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * 1. CREATION (vessel must be moored at loading port, atd_epoch = 0)
 *    - Hedger creates market: vesselIMO, riskType, departureTime, coverageSize
 *    - Hedger's premium deposit is deducted from their vault balance
 *
 * 2. AUCTION WINDOW  [createdAt → departureTime]
 *    - Counterparties submit sealed NO-side bids from vault balance
 *    - Bids can be cancelled (collateral returned to vault balance)
 *
 * 3. FINALIZATION  (at or after departureTime)
 *    - Bids sorted by premium ascending (best price for hedger first)
 *    - Partial fills supported; unfilled bids refunded to vault balance
 *    - YES/NO share positions recorded — no further trading
 *
 * 4. SETTLEMENT  (risk-type-specific timing, see table above)
 *    - Oracle resolves outcome → payouts credited to vault balances
 *    - Protocol fee deducted on payouts
 */
contract VoyageAuction {

    // ============ Enums ============

    enum RiskType {
        PSC_DETENTION,      // Will vessel be detained at port of discharge?
        COLLISION,          // Will vessel be involved in a collision?
        GROUNDING,          // Will vessel run aground?
        CASUALTY_OTHER,     // Other casualty type
        VOYAGE_DELAY        // Will vessel arrive late?
    }

    enum MarketPhase {
        AUCTION,            // Accepting bids (before departure)
        FINALIZED,          // Auction closed, positions locked
        SETTLED,            // Outcome resolved, claims payable
        CANCELLED           // Market cancelled, full refunds
    }

    // ============ Structs ============

    struct Market {
        uint256 id;
        string  vesselIMO;
        string  vesselName;
        RiskType riskType;
        MarketPhase phase;

        address hedger;              // Vessel operator (YES side)
        uint256 coverageSize;        // Number of shares hedger wants (= max payout units)
        uint256 maxPremiumBps;       // Max premium hedger will pay (basis points of coverage)

        uint256 departureTime;       // Auction closes at this timestamp
        uint256 etaTimestamp;        // Expected arrival time (for settlement timing)
        uint256 createdAt;
        uint256 finalizedAt;
        uint256 settledAt;

        uint256 filledShares;        // How many shares were actually matched
        uint256 hedgerPremiumLocked; // Hedger's premium held in contract
        uint256 bidderCollateralLocked; // Total bidder collateral held in contract

        bool    outcome;             // true = risk occurred (YES wins), false = NO wins
    }

    struct Bid {
        uint256 bidId;
        uint256 marketId;
        address bidder;
        uint256 shares;              // Number of NO shares offered
        uint256 premiumBps;          // Premium in basis points (lower = better for hedger)
        uint256 collateralAmount;    // FLR collateral for this bid
        uint256 filledShares;        // How many shares were actually filled
        uint256 filledCollateral;    // Collateral for filled portion only
        bool    cancelled;
        bool    claimed;
    }

    /// @notice Minted share positions after finalization
    struct SharePosition {
        uint256 yesShares;           // Hedger's YES claim
        uint256 noShares;            // Bidder's NO claim
        uint256 costBasis;           // FLR locked for this position
        bool    claimed;
    }

    // ============ Constants ============

    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant COLLATERAL_PER_SHARE = 1 ether;  // 1 FLR per share
    uint256 public constant PROTOCOL_FEE_BPS = 200;          // 2% fee on settlement payouts
    uint256 public constant MIN_AUCTION_DURATION = 1 hours;

    // ============ State ============

    MaritimeRiskOracle public oracle;
    MaritimeRFQVault public vault;
    address public owner;
    address public settler;          // Address authorized to manually settle markets

    uint256 public nextMarketId;
    uint256 public nextBidId;
    uint256 public protocolFees;

    mapping(uint256 => Market) public markets;
    mapping(uint256 => Bid) public bids;
    mapping(uint256 => uint256[]) public marketBids;    // marketId → bidId[]

    /// @notice Minted share positions: marketId → user → position
    mapping(uint256 => mapping(address => SharePosition)) public positions;
    /// @notice All participants in a market (for enumeration)
    mapping(uint256 => address[]) public marketParticipants;

    // ============ Events ============

    event MarketCreated(
        uint256 indexed marketId,
        string vesselIMO,
        RiskType riskType,
        address indexed hedger,
        uint256 coverageSize,
        uint256 departureTime,
        uint256 etaTimestamp
    );

    event BidSubmitted(
        uint256 indexed marketId,
        uint256 indexed bidId,
        address indexed bidder,
        uint256 shares,
        uint256 premiumBps,
        uint256 collateralAmount
    );

    event BidCancelled(uint256 indexed bidId, uint256 refundAmount);

    event AuctionFinalized(
        uint256 indexed marketId,
        uint256 filledShares,
        uint256 totalCollateral,
        uint256 bidsAccepted
    );

    event SharesMinted(
        uint256 indexed marketId,
        address indexed user,
        uint256 yesShares,
        uint256 noShares,
        uint256 costBasis
    );

    event MarketSettled(
        uint256 indexed marketId,
        bool outcome,
        uint256 totalPayout
    );

    event Claimed(
        uint256 indexed marketId,
        address indexed claimant,
        uint256 payout,
        uint256 fee
    );

    event MarketCancelled(uint256 indexed marketId);

    // ============ Modifiers ============

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlySettler() {
        require(msg.sender == settler || msg.sender == owner, "Not settler");
        _;
    }

    // ============ Constructor ============

    constructor(address _oracle, address payable _vault) {
        oracle = MaritimeRiskOracle(_oracle);
        vault = MaritimeRFQVault(_vault);
        owner = msg.sender;
        settler = msg.sender;
        nextMarketId = 1;
        nextBidId = 1;
    }

    // ============ Market Creation ============

    /**
     * @notice Create a new pre-voyage auction market
     * @dev Vessel must be moored at PORT OF LOADING (not discharge).
     *      Checked via oracle: isVesselMoored AND (atdEpoch == 0 OR atdEpoch > now).
     *      Hedger's premium deposit is deducted from their vault balance.
     *
     * @param vesselIMO IMO number of the vessel
     * @param riskType Type of risk being hedged
     * @param coverageSize Number of shares (units of protection)
     * @param maxPremiumBps Maximum premium hedger is willing to pay (bps)
     * @param departureTime When the auction closes and vessel departs
     * @param etaTimestamp Expected arrival time (used for settlement timing)
     */
    function createMarket(
        string calldata vesselIMO,
        RiskType riskType,
        uint256 coverageSize,
        uint256 maxPremiumBps,
        uint256 departureTime,
        uint256 etaTimestamp
    ) external returns (uint256 marketId) {
        require(coverageSize > 0, "Zero coverage");
        require(maxPremiumBps > 0 && maxPremiumBps < BASIS_POINTS, "Invalid premium");
        require(departureTime > block.timestamp + MIN_AUCTION_DURATION, "Departure too soon");
        require(etaTimestamp > departureTime, "ETA must be after departure");

        // Verify vessel is moored at port of loading (pre-departure)
        require(oracle.isVesselAtLoadingPort(vesselIMO), "Vessel must be moored at loading port (pre-departure)");

        // Calculate and lock hedger's premium from vault balance
        uint256 hedgerDeposit = (coverageSize * maxPremiumBps * COLLATERAL_PER_SHARE) / BASIS_POINTS;
        require(vault.getBalance(msg.sender) >= hedgerDeposit, "Insufficient vault balance for premium");
        
        // Deduct from vault — vault will transfer FLR to this contract
        vault.deductForAuction(msg.sender, hedgerDeposit);

        // Get vessel name from oracle
        MaritimeRiskOracle.VesselData memory vesselData = oracle.getVessel(vesselIMO);

        marketId = nextMarketId++;
        markets[marketId] = Market({
            id: marketId,
            vesselIMO: vesselIMO,
            vesselName: vesselData.name,
            riskType: riskType,
            phase: MarketPhase.AUCTION,
            hedger: msg.sender,
            coverageSize: coverageSize,
            maxPremiumBps: maxPremiumBps,
            departureTime: departureTime,
            etaTimestamp: etaTimestamp,
            createdAt: block.timestamp,
            finalizedAt: 0,
            settledAt: 0,
            filledShares: 0,
            hedgerPremiumLocked: hedgerDeposit,
            bidderCollateralLocked: 0,
            outcome: false
        });

        emit MarketCreated(marketId, vesselIMO, riskType, msg.sender, coverageSize, departureTime, etaTimestamp);
    }

    // ============ Bidding ============

    /**
     * @notice Submit a NO-side bid during the auction window
     * @dev Bidder's collateral is deducted from their vault balance.
     *      collateral = shares × (10000 - premiumBps) / 10000 × COLLATERAL_PER_SHARE
     */
    function submitBid(
        uint256 marketId,
        uint256 shares,
        uint256 premiumBps
    ) external returns (uint256 bidId) {
        Market storage market = markets[marketId];
        require(market.phase == MarketPhase.AUCTION, "Not in auction");
        require(block.timestamp < market.departureTime, "Auction closed");
        require(shares > 0, "Zero shares");
        require(premiumBps > 0 && premiumBps <= market.maxPremiumBps, "Premium out of range");
        require(msg.sender != market.hedger, "Hedger cannot bid");

        uint256 bidderCollateral = (shares * (BASIS_POINTS - premiumBps) * COLLATERAL_PER_SHARE) / BASIS_POINTS;
        require(vault.getBalance(msg.sender) >= bidderCollateral, "Insufficient vault balance");

        // Deduct from vault
        vault.deductForAuction(msg.sender, bidderCollateral);

        bidId = nextBidId++;
        bids[bidId] = Bid({
            bidId: bidId,
            marketId: marketId,
            bidder: msg.sender,
            shares: shares,
            premiumBps: premiumBps,
            collateralAmount: bidderCollateral,
            filledShares: 0,
            filledCollateral: 0,
            cancelled: false,
            claimed: false
        });

        marketBids[marketId].push(bidId);

        emit BidSubmitted(marketId, bidId, msg.sender, shares, premiumBps, bidderCollateral);
    }

    /**
     * @notice Cancel a bid before auction finalization
     * @dev Collateral is returned to bidder's vault balance
     */
    function cancelBid(uint256 bidId) external {
        Bid storage bid = bids[bidId];
        require(bid.bidder == msg.sender, "Not your bid");
        require(!bid.cancelled, "Already cancelled");

        Market storage market = markets[bid.marketId];
        require(market.phase == MarketPhase.AUCTION, "Cannot cancel after finalization");

        bid.cancelled = true;
        uint256 refund = bid.collateralAmount;
        bid.collateralAmount = 0;

        // Return to vault balance
        vault.creditFromAuction{value: refund}(msg.sender);

        emit BidCancelled(bidId, refund);
    }

    // ============ Auction Finalization ============

    /**
     * @notice Finalize the auction at or after departure time
     * @dev Selects best bids (lowest premium first), supports partial fills.
     *      After finalization, YES/NO share positions are minted.
     *      No more bids or cancellations — positions are locked.
     */
    function finalizeAuction(uint256 marketId) external {
        Market storage market = markets[marketId];
        require(market.phase == MarketPhase.AUCTION, "Not in auction");
        require(block.timestamp >= market.departureTime, "Auction not ended");

        market.phase = MarketPhase.FINALIZED;
        market.finalizedAt = block.timestamp;

        uint256[] storage bidIds = marketBids[marketId];

        // Sort bids by premium (ascending — lowest premium first = best for hedger)
        _sortBidsByPremium(bidIds);

        uint256 remaining = market.coverageSize;
        uint256 totalBidderCollateral = 0;
        uint256 totalHedgerPremiumUsed = 0;
        uint256 bidsAccepted = 0;

        for (uint256 i = 0; i < bidIds.length && remaining > 0; i++) {
            Bid storage bid = bids[bidIds[i]];
            if (bid.cancelled) continue;

            uint256 fillAmount = bid.shares;
            if (fillAmount > remaining) {
                fillAmount = remaining;  // Partial fill
            }

            bid.filledShares = fillAmount;
            remaining -= fillAmount;
            bidsAccepted++;

            // Calculate collateral for filled portion
            uint256 filledCollateral = (fillAmount * (BASIS_POINTS - bid.premiumBps) * COLLATERAL_PER_SHARE) / BASIS_POINTS;
            bid.filledCollateral = filledCollateral;
            totalBidderCollateral += filledCollateral;

            // Premium the hedger pays for these filled shares
            uint256 premiumForFilled = (fillAmount * bid.premiumBps * COLLATERAL_PER_SHARE) / BASIS_POINTS;
            totalHedgerPremiumUsed += premiumForFilled;

            // Refund excess collateral for partially filled bids → back to vault
            if (fillAmount < bid.shares) {
                uint256 unfilledCollateral = bid.collateralAmount - filledCollateral;
                if (unfilledCollateral > 0) {
                    bid.collateralAmount = filledCollateral;
                    vault.creditFromAuction{value: unfilledCollateral}(bid.bidder);
                }
            }

            // Mint NO share position for this bidder
            _mintPosition(marketId, bid.bidder, 0, fillAmount, filledCollateral);
        }

        // Refund completely unfilled bids → back to vault
        for (uint256 i = 0; i < bidIds.length; i++) {
            Bid storage bid = bids[bidIds[i]];
            if (!bid.cancelled && bid.filledShares == 0) {
                uint256 refund = bid.collateralAmount;
                bid.collateralAmount = 0;
                bid.cancelled = true;
                if (refund > 0) {
                    vault.creditFromAuction{value: refund}(bid.bidder);
                }
            }
        }

        market.filledShares = market.coverageSize - remaining;
        market.bidderCollateralLocked = totalBidderCollateral;

        // Refund excess hedger premium → back to vault
        uint256 hedgerExcess = market.hedgerPremiumLocked > totalHedgerPremiumUsed
            ? market.hedgerPremiumLocked - totalHedgerPremiumUsed
            : 0;
        
        if (hedgerExcess > 0) {
            market.hedgerPremiumLocked -= hedgerExcess;
            vault.creditFromAuction{value: hedgerExcess}(market.hedger);
        }

        // Mint YES share position for hedger
        if (market.filledShares > 0) {
            _mintPosition(marketId, market.hedger, market.filledShares, 0, market.hedgerPremiumLocked);
        }

        uint256 totalLocked = market.hedgerPremiumLocked + market.bidderCollateralLocked;
        emit AuctionFinalized(marketId, market.filledShares, totalLocked, bidsAccepted);
    }

    // ============ Settlement ============

    /**
     * @notice Manual settlement by authorized settler
     * @param marketId Market to settle
     * @param outcome true = risk event occurred (YES/hedger wins), false = NO wins
     */
    function settle(uint256 marketId, bool outcome) external onlySettler {
        Market storage market = markets[marketId];
        require(market.phase == MarketPhase.FINALIZED, "Not finalized");

        market.phase = MarketPhase.SETTLED;
        market.settledAt = block.timestamp;
        market.outcome = outcome;

        uint256 totalPool = market.hedgerPremiumLocked + market.bidderCollateralLocked;
        emit MarketSettled(marketId, outcome, totalPool);
    }

    /**
     * @notice Auto-settle using on-chain oracle data with strict risk-type rules
     * @dev Each risk type has specific timing and data requirements:
     *
     *      PSC_DETENTION:
     *        - Can only settle AFTER vessel has arrived at destination
     *        - Oracle must confirm vessel is moored at discharge port
     *        - Checks wasVesselDetained() for outcome
     *
     *      COLLISION / GROUNDING / CASUALTY_OTHER:
     *        - Can settle MID-VOYAGE if casualty is detected (early settlement)
     *        - Can also settle at arrival if no casualty detected (NO wins)
     *        - For arrival settlement: vessel must have arrived OR ETA must have passed
     *
     *      VOYAGE_DELAY:
     *        - Can only settle AFTER ETA has passed
     *        - YES (delay occurred) if vessel has NOT arrived after ETA
     *        - NO (on time) if vessel HAS arrived by ETA
     */
    function settleFromOracle(uint256 marketId) external {
        Market storage market = markets[marketId];
        require(market.phase == MarketPhase.FINALIZED, "Not finalized");

        bool outcome;

        if (market.riskType == RiskType.PSC_DETENTION) {
            // PSC: vessel must have arrived at destination
            require(
                oracle.hasVesselArrived(market.vesselIMO),
                "PSC settlement requires vessel to have arrived at destination"
            );
            outcome = oracle.wasVesselDetained(market.vesselIMO);

        } else if (market.riskType == RiskType.COLLISION) {
            // Collision: check if casualty detected (can settle mid-voyage)
            bool hasCasualty = oracle.hadCasualty(market.vesselIMO, "Collision");
            if (hasCasualty) {
                // Early settlement: collision detected mid-voyage
                outcome = true;
            } else {
                // No collision yet — can only settle as NO after arrival or past ETA
                require(
                    oracle.hasVesselArrived(market.vesselIMO) || block.timestamp >= market.etaTimestamp,
                    "Collision: wait for arrival/ETA or casualty detection"
                );
                outcome = false;
            }

        } else if (market.riskType == RiskType.GROUNDING) {
            bool hasCasualty = oracle.hadCasualty(market.vesselIMO, "Grounding");
            if (hasCasualty) {
                outcome = true;
            } else {
                require(
                    oracle.hasVesselArrived(market.vesselIMO) || block.timestamp >= market.etaTimestamp,
                    "Grounding: wait for arrival/ETA or casualty detection"
                );
                outcome = false;
            }

        } else if (market.riskType == RiskType.CASUALTY_OTHER) {
            MaritimeRiskOracle.CasualtyRecord memory cas = oracle.getCasualty(market.vesselIMO);
            if (cas.detected) {
                outcome = true;
            } else {
                require(
                    oracle.hasVesselArrived(market.vesselIMO) || block.timestamp >= market.etaTimestamp,
                    "Casualty: wait for arrival/ETA or casualty detection"
                );
                outcome = false;
            }

        } else if (market.riskType == RiskType.VOYAGE_DELAY) {
            // Delay: can only settle after ETA has passed
            require(block.timestamp >= market.etaTimestamp, "Delay: ETA has not passed yet");
            // YES = delayed (not arrived after ETA), NO = on time (arrived)
            outcome = !oracle.hasVesselArrived(market.vesselIMO);

        } else {
            revert("Unknown risk type");
        }

        market.phase = MarketPhase.SETTLED;
        market.settledAt = block.timestamp;
        market.outcome = outcome;

        uint256 totalPool = market.hedgerPremiumLocked + market.bidderCollateralLocked;
        emit MarketSettled(marketId, outcome, totalPool);
    }

    // ============ Claims ============

    /**
     * @notice Claim payout after settlement
     * @dev Works for both hedger (YES) and bidders (NO).
     *      Payouts are credited to the user's vault balance.
     *
     *      If YES wins (risk occurred):
     *        - Hedger receives: hedgerPremium + bidderCollateral (full pool minus fees)
     *        - Bidders receive: 0
     *
     *      If NO wins (risk didn't occur):
     *        - Hedger receives: 0 (premium was cost of protection)
     *        - Each bidder receives: their collateral + their share of hedger premium (minus fees)
     */
    function claim(uint256 marketId) external {
        Market storage market = markets[marketId];
        require(market.phase == MarketPhase.SETTLED, "Not settled");

        SharePosition storage pos = positions[marketId][msg.sender];
        require(!pos.claimed, "Already claimed");
        require(pos.yesShares > 0 || pos.noShares > 0, "No position");

        pos.claimed = true;

        uint256 payout = 0;
        uint256 totalPool = market.hedgerPremiumLocked + market.bidderCollateralLocked;

        if (market.outcome) {
            // YES wins — hedger gets the full pool
            if (pos.yesShares > 0) {
                payout = totalPool;
            }
            // NO holders get nothing
        } else {
            // NO wins — bidders get their collateral back + proportional share of premium
            if (pos.noShares > 0 && market.filledShares > 0) {
                // Each NO share gets: (bidderCollateral + hedgerPremium) / totalFilledShares
                payout = (totalPool * pos.noShares) / market.filledShares;
            }
            // YES holder (hedger) gets nothing
        }

        uint256 fee = 0;
        if (payout > 0) {
            fee = (payout * PROTOCOL_FEE_BPS) / BASIS_POINTS;
            protocolFees += fee;
            payout -= fee;

            // Credit payout to user's vault balance
            vault.creditFromAuction{value: payout}(msg.sender);
        }

        emit Claimed(marketId, msg.sender, payout, fee);
    }

    // ============ Cancel Market ============

    /**
     * @notice Cancel a market (only during auction phase, by hedger or owner)
     * @dev All collateral returned to vault balances
     */
    function cancelMarket(uint256 marketId) external {
        Market storage market = markets[marketId];
        require(market.phase == MarketPhase.AUCTION, "Can only cancel during auction");
        require(msg.sender == market.hedger || msg.sender == owner, "Not authorized");

        market.phase = MarketPhase.CANCELLED;

        // Refund hedger premium to vault
        if (market.hedgerPremiumLocked > 0) {
            uint256 refund = market.hedgerPremiumLocked;
            market.hedgerPremiumLocked = 0;
            vault.creditFromAuction{value: refund}(market.hedger);
        }

        // Refund all bids to vault
        uint256[] storage bidIds = marketBids[marketId];
        for (uint256 i = 0; i < bidIds.length; i++) {
            Bid storage bid = bids[bidIds[i]];
            if (!bid.cancelled && bid.collateralAmount > 0) {
                uint256 refund = bid.collateralAmount;
                bid.collateralAmount = 0;
                bid.cancelled = true;
                vault.creditFromAuction{value: refund}(bid.bidder);
            }
        }

        emit MarketCancelled(marketId);
    }

    // ============ View Functions ============

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return markets[marketId];
    }

    function getBid(uint256 bidId) external view returns (Bid memory) {
        return bids[bidId];
    }

    function getPosition(uint256 marketId, address user) external view returns (SharePosition memory) {
        return positions[marketId][user];
    }

    function getMarketBidCount(uint256 marketId) external view returns (uint256) {
        return marketBids[marketId].length;
    }

    function getMarketBids(uint256 marketId) external view returns (uint256[] memory) {
        return marketBids[marketId];
    }

    function getMarketParticipants(uint256 marketId) external view returns (address[] memory) {
        return marketParticipants[marketId];
    }

    /// @notice Total collateral locked in a market (hedger premium + bidder collateral)
    function getMarketTotalCollateral(uint256 marketId) external view returns (uint256) {
        Market storage m = markets[marketId];
        return m.hedgerPremiumLocked + m.bidderCollateralLocked;
    }

    /// @notice Calculate the required hedger deposit for a given coverage and premium
    function calculateHedgerDeposit(uint256 coverageSize, uint256 maxPremiumBps) 
        external pure returns (uint256) 
    {
        return (coverageSize * maxPremiumBps * COLLATERAL_PER_SHARE) / BASIS_POINTS;
    }

    /// @notice Calculate the required bidder collateral for given shares and premium
    function calculateBidderCollateral(uint256 shares, uint256 premiumBps) 
        external pure returns (uint256) 
    {
        return (shares * (BASIS_POINTS - premiumBps) * COLLATERAL_PER_SHARE) / BASIS_POINTS;
    }

    // ============ Admin ============

    function setSettler(address _settler) external onlyOwner {
        settler = _settler;
    }

    function updateOracle(address _oracle) external onlyOwner {
        oracle = MaritimeRiskOracle(_oracle);
    }

    function updateVault(address payable _vault) external onlyOwner {
        vault = MaritimeRFQVault(_vault);
    }

    function withdrawFees() external onlyOwner {
        uint256 fees = protocolFees;
        require(fees > 0, "No fees");
        protocolFees = 0;
        (bool success, ) = owner.call{value: fees}("");
        require(success, "Fee withdrawal failed");
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    // ============ Internal ============

    /**
     * @dev Mint share position for a user in a market
     */
    function _mintPosition(
        uint256 marketId,
        address user,
        uint256 yesShares,
        uint256 noShares,
        uint256 costBasis
    ) internal {
        SharePosition storage pos = positions[marketId][user];
        
        // Track new participants
        if (pos.yesShares == 0 && pos.noShares == 0) {
            marketParticipants[marketId].push(user);
        }
        
        pos.yesShares += yesShares;
        pos.noShares += noShares;
        pos.costBasis += costBasis;

        emit SharesMinted(marketId, user, yesShares, noShares, costBasis);
    }

    /**
     * @dev Simple insertion sort for bids by premium (ascending)
     */
    function _sortBidsByPremium(uint256[] storage bidIds) internal {
        uint256 len = bidIds.length;
        if (len <= 1) return;

        for (uint256 i = 1; i < len; i++) {
            uint256 key = bidIds[i];
            uint256 keyPremium = bids[key].premiumBps;
            
            uint256 j = i;
            while (j > 0 && bids[bidIds[j - 1]].premiumBps > keyPremium) {
                bidIds[j] = bidIds[j - 1];
                j--;
            }
            bidIds[j] = key;
        }
    }

    receive() external payable {}
}
