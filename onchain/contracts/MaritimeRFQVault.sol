// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {ContractRegistry} from "@flarenetwork/flare-periphery-contracts/coston2/ContractRegistry.sol";
import {FtsoV2Interface} from "@flarenetwork/flare-periphery-contracts/coston2/FtsoV2Interface.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title MaritimeRFQVault
 * @notice Prediction Market with RFQ Auction for Maritime Risk Hedging
 * 
 * ══════════════════════════════════════════════════════════════════════════════
 * PREDICTION MARKET MECHANICS
 * ══════════════════════════════════════════════════════════════════════════════
 * 
 * Core Rule: 1 YES share + 1 NO share = $1 collateral (ALWAYS)
 * 
 * Example Flow:
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ Market: "Will vessel MAERSK CHENNAI be detained?"                          │
 * │                                                                             │
 * │ STEP 1: Alice (ship owner) wants to hedge                                   │
 * │         Creates REQUEST: "I want 100 YES shares, max 60¢ each"              │
 * │                                                                             │
 * │ STEP 2: Bob (speculator) sees the request, submits BID                      │
 * │         "I'll take 100 NO shares at 40¢ each"                               │
 * │         (This means Alice pays 60¢, Bob pays 40¢ = $1 total per share)      │
 * │                                                                             │
 * │ STEP 3: Alice ACCEPTS Bob's bid → EMISSION                                  │
 * │         - Alice deposits $60 → receives 100 YES shares                      │
 * │         - Bob deposits $40 → receives 100 NO shares                         │
 * │         - Vault holds $100 collateral (100 share pairs × $1)                │
 * │                                                                             │
 * │ STEP 4: SETTLEMENT - Vessel IS detained (YES wins)                          │
 * │         - Alice redeems 100 YES shares → $100 payout                        │
 * │         - Bob's 100 NO shares → $0 (worthless)                              │
 * │         - Alice profit: $100 - $60 = +$40                                   │
 * │         - Bob loss: $0 - $40 = -$40                                         │
 * │                                                                             │
 * │ Alternative: Vessel passes (NO wins)                                        │
 * │         - Alice's YES shares → $0                                           │
 * │         - Bob redeems NO shares → $100 payout                               │
 * │         - Alice loss: -$60, Bob profit: +$60                                │
 * └─────────────────────────────────────────────────────────────────────────────┘
 * 
 * Key Invariants:
 * - yesPrice + noPrice = 100 (always sums to $1)
 * - totalYesShares == totalNoShares (always equal)
 * - totalCollateral == totalYesShares * $1 (fully backed)
 * - Winner gets $1 per share, loser gets $0
 */
contract MaritimeRFQVault is EIP712 {
    using ECDSA for bytes32;

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════

    bytes21 public constant FLR_USD_FEED_ID = bytes21(0x01464c522f55534400000000000000000000000000);
    
    bytes32 public constant EMISSION_TYPEHASH = keccak256(
        "Emission(uint256 marketId,address yesUser,address noUser,uint256 quantity,uint256 yesPrice,uint256 noPrice,uint256 nonce,uint256 deadline)"
    );

    uint256 public constant PROTOCOL_FEE_BPS = 200; // 2% fee on winnings
    uint256 public constant PRICE_PRECISION = 100;  // Prices in cents (1-99)
    
    // Share value: 1 share = $1 = 1e18 wei equivalent in USD terms
    uint256 public constant SHARE_VALUE_USD = 1e18;

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE
    // ═══════════════════════════════════════════════════════════════════════════

    address public owner;
    address public operator;  // Signs emissions from off-chain RFQ engine
    address public oracle;    // Settles markets with outcome

    uint256 public marketCount;
    
    struct Market {
        bytes32 uuid;            // Off-chain market UUID
        string vesselIMO;
        string description;
        uint256 totalCollateral; // Total FLR locked (backs all share pairs)
        uint256 totalShares;     // Total share pairs (YES count == NO count)
        uint256 expiresAt;
        bool settled;
        bool outcome;            // true = YES wins, false = NO wins
    }
    
    mapping(uint256 => Market) public markets;
    mapping(bytes32 => uint256) public uuidToMarketId;

    // User deposits (available for trading)
    mapping(address => uint256) public deposits;
    
    // User positions per market
    struct Position {
        uint256 yesShares;   // Number of YES shares owned
        uint256 noShares;    // Number of NO shares owned
        uint256 yesCost;     // FLR spent acquiring YES shares
        uint256 noCost;      // FLR spent acquiring NO shares
        bool claimed;        // Whether winnings have been claimed
    }
    
    mapping(uint256 => mapping(address => Position)) public positions;
    mapping(uint256 => address[]) internal participants;

    // Emission tracking (prevent replay)
    mapping(bytes32 => bool) public usedEmissions;
    uint256 public emissionNonce;

    // Protocol fees
    uint256 public protocolFees;
    address public feeRecipient;  // Address that receives protocol fees

    // FTSO price cache
    uint256 public flrPriceUSD;  // FLR price in USD (scaled by 10^decimals)
    int8 public flrDecimals;
    uint64 public priceTimestamp;

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════

    event MarketCreated(uint256 indexed marketId, bytes32 uuid, string vesselIMO, uint256 expiresAt);
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event SharesEmitted(
        uint256 indexed marketId,
        address indexed yesUser,
        address indexed noUser,
        uint256 shares,
        uint256 yesPrice,
        uint256 noPrice,
        uint256 collateralLocked
    );
    event MarketSettled(uint256 indexed marketId, bool outcome);
    event WinningsClaimed(address indexed user, uint256 indexed marketId, uint256 shares, uint256 payout);
    event FeesWithdrawn(address indexed recipient, uint256 amount);

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

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════

    constructor() EIP712("MaritimeRFQVault", "1") {
        owner = msg.sender;
        operator = msg.sender;
        oracle = msg.sender;
        feeRecipient = msg.sender;  // Default fee recipient is owner
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // FTSO PRICE ORACLE
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Update FLR/USD price from Flare FTSO
     */
    function updatePrice() public payable {
        FtsoV2Interface ftso = ContractRegistry.getFtsoV2();
        (flrPriceUSD, flrDecimals, priceTimestamp) = ftso.getFeedById(FLR_USD_FEED_ID);
    }

    /**
     * @notice Internal: Try to update price, don't revert if FTSO unavailable
     * @dev Used before emitShares to get fresh price. Falls back to cached/default if fails.
     *      On Hardhat/local networks, ContractRegistry doesn't exist, so we skip.
     */
    function _tryUpdatePrice() internal {
        // Check if we're on a network with FTSO (Flare/Coston2)
        // ContractRegistry is at a fixed address that only exists on Flare networks
        // On local/hardhat, this address has no code, so we skip
        address registryAddr = 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019; // Flare ContractRegistry
        
        uint256 codeSize;
        assembly {
            codeSize := extcodesize(registryAddr)
        }
        
        // Only try FTSO if ContractRegistry exists (i.e., we're on Flare network)
        if (codeSize > 0) {
            try ContractRegistry.getFtsoV2().getFeedById(FLR_USD_FEED_ID) returns (
                uint256 price, int8 decimals, uint64 timestamp
            ) {
                flrPriceUSD = price;
                flrDecimals = decimals;
                priceTimestamp = timestamp;
            } catch {
                // FTSO call failed - use cached or default price
            }
        }
        // If no registry (local/hardhat), usdToFLR will use default $0.02 price
    }

    /**
     * @notice Convert USD amount to FLR using cached price
     * @param usdAmount USD amount (18 decimals)
     * @return flrAmount FLR amount in wei
     */
    function usdToFLR(uint256 usdAmount) public view returns (uint256 flrAmount) {
        uint256 price = flrPriceUSD;
        int8 decimals = flrDecimals;
        
        // Default price if not set: $0.02 per FLR
        if (price == 0) {
            price = 2000;
            decimals = 5;
        }
        
        // Convert: FLR = USD / price
        if (decimals >= 0) {
            flrAmount = (usdAmount * (10 ** uint8(decimals))) / price;
        } else {
            flrAmount = (usdAmount) / (price * (10 ** uint8(-decimals)));
        }
    }

    /**
     * @notice Convert FLR amount to USD
     * @param flrAmount FLR amount in wei
     * @return usdAmount USD amount (18 decimals)
     */
    function flrToUSD(uint256 flrAmount) public view returns (uint256 usdAmount) {
        uint256 price = flrPriceUSD;
        int8 decimals = flrDecimals;
        
        if (price == 0) {
            price = 2000;
            decimals = 5;
        }
        
        if (decimals >= 0) {
            usdAmount = (flrAmount * price) / (10 ** uint8(decimals));
        } else {
            usdAmount = (flrAmount * price * (10 ** uint8(-decimals)));
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DEPOSIT / WITHDRAW
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Deposit FLR for trading
     */
    function deposit() external payable {
        require(msg.value > 0, "Zero deposit");
        deposits[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /**
     * @notice Withdraw available FLR
     */
    function withdraw(uint256 amount) external {
        require(deposits[msg.sender] >= amount, "Insufficient balance");
        deposits[msg.sender] -= amount;
        payable(msg.sender).transfer(amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // MARKET MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Create a new prediction market
     */
    function createMarket(
        bytes32 uuid,
        string calldata vesselIMO,
        string calldata description,
        uint256 expiresAt
    ) external onlyOperator returns (uint256 marketId) {
        require(expiresAt > block.timestamp, "Invalid expiry");
        require(uuidToMarketId[uuid] == 0 || markets[uuidToMarketId[uuid] - 1].uuid != uuid, "UUID exists");

        marketId = marketCount++;
        markets[marketId] = Market({
            uuid: uuid,
            vesselIMO: vesselIMO,
            description: description,
            totalCollateral: 0,
            totalShares: 0,
            expiresAt: expiresAt,
            settled: false,
            outcome: false
        });
        
        uuidToMarketId[uuid] = marketId + 1;

        emit MarketCreated(marketId, uuid, vesselIMO, expiresAt);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SHARE EMISSION (Core Prediction Market Logic)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Emit shares after off-chain RFQ match is accepted
     * 
     * @dev This is the core prediction market operation:
     *      - YES buyer pays yesPrice cents per share
     *      - NO buyer pays noPrice cents per share
     *      - yesPrice + noPrice MUST equal 100 (= $1)
     *      - Creates equal YES and NO shares
     *      - Total collateral = shares × $1
     * 
     * @param marketId Market index
     * @param yesUser Address buying YES shares (typically hedger)
     * @param noUser Address buying NO shares (typically speculator)
     * @param shares Number of share pairs to create
     * @param yesPrice Price per YES share in cents (1-99)
     * @param noPrice Price per NO share in cents (1-99), must equal 100 - yesPrice
     * @param nonce Unique identifier for this emission
     * @param deadline Signature expiration timestamp
     * @param signature Operator's EIP-712 signature authorizing emission
     */
    function emitShares(
        uint256 marketId,
        address yesUser,
        address noUser,
        uint256 shares,
        uint256 yesPrice,
        uint256 noPrice,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external {
        // ─── UPDATE FTSO PRICE ────────────────────────────────────────────────
        // Fetch current FLR/USD price from Flare FTSO before calculating collateral
        _tryUpdatePrice();
        
        // ─── VALIDATION ───────────────────────────────────────────────────────
        require(block.timestamp <= deadline, "Signature expired");
        require(shares > 0, "Zero shares");
        require(yesPrice >= 1 && yesPrice <= 99, "Invalid YES price");
        require(noPrice >= 1 && noPrice <= 99, "Invalid NO price");
        
        // CRITICAL: Prices MUST sum to 100 cents = $1
        require(yesPrice + noPrice == PRICE_PRECISION, "Prices must sum to 100");
        
        Market storage market = markets[marketId];
        require(!market.settled, "Market settled");
        require(block.timestamp < market.expiresAt, "Market expired");

        // ─── VERIFY SIGNATURE ─────────────────────────────────────────────────
        bytes32 structHash = keccak256(abi.encode(
            EMISSION_TYPEHASH,
            marketId,
            yesUser,
            noUser,
            shares,
            yesPrice,
            noPrice,
            nonce,
            deadline
        ));
        
        bytes32 digest = _hashTypedDataV4(structHash);
        require(!usedEmissions[digest], "Emission already used");
        
        address signer = digest.recover(signature);
        require(signer == operator, "Invalid operator signature");
        
        usedEmissions[digest] = true;

        // ─── CALCULATE COLLATERAL ─────────────────────────────────────────────
        // Each share pair needs $1 total collateral
        // YES buyer contributes: shares × yesPrice / 100 dollars
        // NO buyer contributes: shares × noPrice / 100 dollars
        
        // Convert to FLR using current price
        // yesPrice is in cents, so yesPrice/100 = dollars per share
        // shares × yesPrice cents = total cents → convert to USD then FLR
        
        uint256 yesUSD = (shares * yesPrice * SHARE_VALUE_USD) / PRICE_PRECISION;
        uint256 noUSD = (shares * noPrice * SHARE_VALUE_USD) / PRICE_PRECISION;
        
        uint256 yesFLR = usdToFLR(yesUSD);
        uint256 noFLR = usdToFLR(noUSD);
        uint256 totalFLR = yesFLR + noFLR;

        // ─── CHECK & DEDUCT BALANCES ──────────────────────────────────────────
        require(deposits[yesUser] >= yesFLR, "YES user: insufficient balance");
        require(deposits[noUser] >= noFLR, "NO user: insufficient balance");
        
        deposits[yesUser] -= yesFLR;
        deposits[noUser] -= noFLR;

        // ─── UPDATE MARKET STATE ──────────────────────────────────────────────
        market.totalCollateral += totalFLR;
        market.totalShares += shares;

        // ─── UPDATE POSITIONS ─────────────────────────────────────────────────
        _updatePosition(marketId, yesUser, shares, 0, yesFLR, 0);
        _updatePosition(marketId, noUser, 0, shares, 0, noFLR);

        emissionNonce++;

        emit SharesEmitted(marketId, yesUser, noUser, shares, yesPrice, noPrice, totalFLR);
    }

    function _updatePosition(
        uint256 marketId,
        address user,
        uint256 yesShares,
        uint256 noShares,
        uint256 yesCost,
        uint256 noCost
    ) internal {
        Position storage pos = positions[marketId][user];
        
        // Track new participants
        if (pos.yesShares == 0 && pos.noShares == 0 && (yesShares > 0 || noShares > 0)) {
            participants[marketId].push(user);
        }
        
        pos.yesShares += yesShares;
        pos.noShares += noShares;
        pos.yesCost += yesCost;
        pos.noCost += noCost;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SETTLEMENT
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * @notice Settle market with outcome from oracle
     * @param marketId Market to settle
     * @param outcome true = YES wins (event occurred), false = NO wins (event didn't occur)
     */
    function settle(uint256 marketId, bool outcome) external onlyOracle {
        Market storage market = markets[marketId];
        require(!market.settled, "Already settled");
        
        market.settled = true;
        market.outcome = outcome;

        emit MarketSettled(marketId, outcome);
    }

    /**
     * @notice Claim winnings after market settlement
     * 
     * @dev Payout calculation:
     *      - Winner's share of collateral pool
     *      - Each winning share gets proportional payout
     *      - If YES wins: payout = (yesShares / totalShares) × totalCollateral
     *      - Losing shares get $0
     */
    function claim(uint256 marketId) external {
        Market storage market = markets[marketId];
        require(market.settled, "Not settled");

        Position storage pos = positions[marketId][msg.sender];
        require(!pos.claimed, "Already claimed");
        
        uint256 winningShares = market.outcome ? pos.yesShares : pos.noShares;
        require(winningShares > 0, "No winning shares");

        pos.claimed = true;

        // Calculate payout: winning shares get proportional share of total collateral
        // Since YES shares = NO shares always, each winning share gets:
        // totalCollateral / totalShares (approximately $1 per share in USD terms)
        uint256 payout = (market.totalCollateral * winningShares) / market.totalShares;

        // Deduct protocol fee
        uint256 fee = (payout * PROTOCOL_FEE_BPS) / 10000;
        protocolFees += fee;
        payout -= fee;

        // Credit to user's deposit balance
        deposits[msg.sender] += payout;

        emit WinningsClaimed(msg.sender, marketId, winningShares, payout);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function getMarket(uint256 marketId) external view returns (Market memory) {
        return markets[marketId];
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

    /// @notice Get EIP-712 domain separator for signature verification
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Compute the digest that must be signed for share emission
    function getEmissionDigest(
        uint256 marketId,
        address yesUser,
        address noUser,
        uint256 shares,
        uint256 yesPrice,
        uint256 noPrice,
        uint256 nonce,
        uint256 deadline
    ) external view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            EMISSION_TYPEHASH,
            marketId,
            yesUser,
            noUser,
            shares,
            yesPrice,
            noPrice,
            nonce,
            deadline
        ));
        return _hashTypedDataV4(structHash);
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

    function setFeeRecipient(address _feeRecipient) external onlyOwner {
        require(_feeRecipient != address(0), "Zero address");
        feeRecipient = _feeRecipient;
    }

    /**
     * @notice Withdraw accumulated protocol fees to feeRecipient
     */
    function withdrawFees() external onlyOwner {
        require(feeRecipient != address(0), "Fee recipient not set");
        uint256 fees = protocolFees;
        require(fees > 0, "No fees to withdraw");
        protocolFees = 0;
        payable(feeRecipient).transfer(fees);
        emit FeesWithdrawn(feeRecipient, fees);
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
