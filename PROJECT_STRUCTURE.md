# Maritime Risk Prediction Market - Project Structure

## Quick Navigation

```
hak_2026/
│
├── onchain/                    # 🔗 BLOCKCHAIN (Flare/Solidity)
│   ├── contracts/              # Smart contracts (.sol files)
│   │   ├── MaritimeRiskOracle.sol      # FDC-verified data oracle
│   │   └── MaritimePredictionMarket.sol # Prediction market logic
│   └── scripts/                # Deployment & interaction scripts
│       ├── deploy.js           # Deploy to Coston2 testnet
│       ├── demo.js             # Test contract interactions
│       └── fdcAttestation.js   # FDC proof submission
│
├── offchain/                   # 🖥️ BACKEND (TypeScript/Rust)
│   ├── api/                    # REST API endpoints
│   ├── clob/                   # Central Limit Order Book
│   ├── clob-rs/                # Rust CLOB implementation
│   ├── fdc/                    # Flare Data Connector integration
│   │   └── AttestRisk.ts       # FDC attestation helper
│   ├── test_clob.sh            # CLOB test script
│   └── test_trading.sh         # Trading test script
│
├── ui/                         # 🎨 FRONTEND
│   ├── client/                 # React/frontend code
│   └── public/                 # Static assets
│
├── docs/                       # 📚 DOCUMENTATION
│   ├── ARCHITECTURE.md         # System architecture overview
│   ├── PREDICTION_MARKET_SPECIFICATION.md  # Market rules & settlement
│   ├── API_ENDPOINTS_BY_RISK.md           # Datalastic API mapping
│   ├── MARITIME_API_PROVIDERS.md          # Data provider comparison
│   ├── MARITIME_API_DEEP_RESEARCH.md      # API research notes
│   ├── MARITIME_MARKET_PARAMETERS.md      # Market parameters
│   ├── MARITIME_RISK_MARKETS.md           # Risk type definitions
│   ├── PLATFORM_DOCUMENTATION.md          # Platform docs
│   ├── PREDICTION_MARKET_DOCS.md          # Market mechanics
│   ├── EFFECTS.md                         # State effects
│   ├── terminal49documentation.md         # Terminal49 API docs
│   └── Untitled Diagram.drawio            # Architecture diagram
│
├── src/                        # 🔧 LEGACY/SHARED CODE
│   ├── api/                    # API code
│   ├── clob/                   # CLOB TypeScript
│   ├── liquidity/              # Liquidity management
│   ├── test/                   # Tests
│   └── types/                  # TypeScript types
│
├── artifacts/                  # 📦 Compiled contracts (auto-generated)
├── cache/                      # 🗄️ Build cache (auto-generated)
├── dist/                       # 📦 Built JS output
├── node_modules/               # 📦 NPM dependencies
│
├── .env                        # 🔐 Environment variables (DO NOT COMMIT)
├── .gitignore                  # Git ignore rules
├── hardhat.config.cjs          # Hardhat configuration
├── package.json                # NPM dependencies
├── tsconfig.json               # TypeScript config
└── PROJECT_STRUCTURE.md        # This file
```

## Team Responsibilities

| Folder | Team | Description |
|--------|------|-------------|
| `onchain/` | Smart Contract Dev | Solidity contracts, FDC integration |
| `offchain/` | Backend Dev | API, CLOB, data pipelines |
| `ui/` | Frontend Dev | React UI, user interactions |
| `docs/` | Everyone | Read before coding! |

## Key Documentation

| Document | What It Covers |
|----------|----------------|
| `docs/FDC_WORKFLOW_GUIDE.md` | **START HERE** - Step-by-step FDC attestation flow |
| `docs/PREDICTION_MARKET_SPECIFICATION.md` | Market rules, settlement logic, API mapping |
| `docs/ARCHITECTURE.md` | System architecture overview |
| `docs/API_ENDPOINTS_BY_RISK.md` | Datalastic API endpoints by risk type |

## Quick Commands

```bash
# Compile smart contracts
npx hardhat compile

# Deploy to Coston2 testnet
npx hardhat run onchain/scripts/deploy.js --network coston2

# Run demo (set ORACLE_ADDRESS and MARKET_ADDRESS in .env first)
npx hardhat run onchain/scripts/demo.js --network coston2

# FDC attestation flow
npx hardhat run onchain/scripts/fdcAttestation.js --network coston2

# Run FDC risk attestation (TypeScript)
npx ts-node offchain/fdc/AttestRisk.ts

# Test CLOB
cd offchain && ./test_clob.sh
```

## Environment Variables (.env)

```
PORT=3000
PRIVATE_KEY=your_wallet_private_key
DATALASTIC_API_KEY=your_api_key
WALLETCONNECT_PROJECT_ID=your_walletconnect_project_id
ORACLE_ADDRESS=deployed_oracle_address
MARKET_ADDRESS=deployed_market_address
```

## Wallet Connection Setup

1. **Get WalletConnect Project ID**: https://cloud.walletconnect.com
2. **Edit `public/js/wallet.js`** - paste your project ID on line 8
3. **After deploying contracts** - update `CONTRACTS.oracle` and `CONTRACTS.market` in wallet.js
4. **Run server**: `npm run dev`
5. **Open demo**: http://localhost:3000/demo.html
