export const MaritimeRFQVaultABI = [
  // Constructor
  { inputs: [], stateMutability: "nonpayable", type: "constructor" },
  
  // Events
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" }
    ],
    name: "Deposited",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "recipient", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" }
    ],
    name: "FeesWithdrawn",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "marketId", type: "uint256" },
      { indexed: false, internalType: "bytes32", name: "uuid", type: "bytes32" },
      { indexed: false, internalType: "string", name: "vesselIMO", type: "string" },
      { indexed: false, internalType: "uint256", name: "expiresAt", type: "uint256" }
    ],
    name: "MarketCreated",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "marketId", type: "uint256" },
      { indexed: false, internalType: "bool", name: "outcome", type: "bool" }
    ],
    name: "MarketSettled",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "marketId", type: "uint256" },
      { indexed: true, internalType: "address", name: "yesUser", type: "address" },
      { indexed: true, internalType: "address", name: "noUser", type: "address" },
      { indexed: false, internalType: "uint256", name: "shares", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "yesPrice", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "noPrice", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "collateralLocked", type: "uint256" }
    ],
    name: "SharesEmitted",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: true, internalType: "uint256", name: "marketId", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "shares", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "payout", type: "uint256" }
    ],
    name: "WinningsClaimed",
    type: "event"
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: false, internalType: "uint256", name: "amount", type: "uint256" }
    ],
    name: "Withdrawn",
    type: "event"
  },
  
  // Read Functions
  {
    inputs: [],
    name: "PRICE_PRECISION",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "PROTOCOL_FEE_BPS",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "SHARE_VALUE_USD",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "address", name: "", type: "address" }],
    name: "deposits",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "marketCount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "markets",
    outputs: [
      { internalType: "bytes32", name: "uuid", type: "bytes32" },
      { internalType: "string", name: "vesselIMO", type: "string" },
      { internalType: "string", name: "description", type: "string" },
      { internalType: "uint256", name: "totalCollateral", type: "uint256" },
      { internalType: "uint256", name: "totalShares", type: "uint256" },
      { internalType: "uint256", name: "expiresAt", type: "uint256" },
      { internalType: "bool", name: "settled", type: "bool" },
      { internalType: "bool", name: "outcome", type: "bool" }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [
      { internalType: "uint256", name: "marketId", type: "uint256" },
      { internalType: "address", name: "user", type: "address" }
    ],
    name: "getPosition",
    outputs: [
      { internalType: "uint256", name: "yesShares", type: "uint256" },
      { internalType: "uint256", name: "noShares", type: "uint256" },
      { internalType: "bool", name: "claimed", type: "bool" }
    ],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "flrPriceUSD",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "flrDecimals",
    outputs: [{ internalType: "int8", name: "", type: "int8" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "owner",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "operator",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "oracle",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "feeRecipient",
    outputs: [{ internalType: "address", name: "", type: "address" }],
    stateMutability: "view",
    type: "function"
  },
  {
    inputs: [],
    name: "accumulatedFees",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function"
  },
  
  // Write Functions
  {
    inputs: [],
    name: "deposit",
    outputs: [],
    stateMutability: "payable",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "amount", type: "uint256" }],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ internalType: "uint256", name: "marketId", type: "uint256" }],
    name: "claim",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [
      { internalType: "uint256", name: "marketId", type: "uint256" },
      { internalType: "address", name: "yesUser", type: "address" },
      { internalType: "address", name: "noUser", type: "address" },
      { internalType: "uint256", name: "quantity", type: "uint256" },
      { internalType: "uint256", name: "yesPrice", type: "uint256" },
      { internalType: "uint256", name: "noPrice", type: "uint256" },
      { internalType: "uint256", name: "nonce", type: "uint256" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
      { internalType: "bytes", name: "operatorSignature", type: "bytes" }
    ],
    name: "emitShares",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  
  // Receive function
  { stateMutability: "payable", type: "receive" }
] as const;
