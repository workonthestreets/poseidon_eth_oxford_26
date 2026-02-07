# FDC Integration Test Suite

Complete test scripts for Flare Data Connector (FDC) attestation workflow on Coston2 testnet.

## 📁 Files

- **`Base.ts`** - Core utilities for FDC operations
- **`testPSCInspection.ts`** - End-to-end test for PSC inspection attestations
- **`README.md`** - This file

## 🚀 Setup

### 1. Install Dependencies

```bash
npm install ethers dotenv
```

### 2. Configure Environment

Create `.env` in project root:

```env
PRIVATE_KEY=your_private_key_here
ORACLE_ADDRESS=0x...  # Address of deployed MaritimeRiskOracle
```

### 3. Get Testnet Tokens

Visit Coston2 faucet: https://faucet.flare.network/coston2

Request C2FLR tokens to your wallet address.

## 🧪 Running Tests

### Test PSC Inspection Attestation

```bash
npx ts-node onchain/scripts/fdcIntegration/testPSCInspection.ts
```

**What this does:**

1. ✅ Prepares attestation request for PSC data via Verifier API
2. ✅ Submits request to FDC Hub (pays ~0.001 C2FLR fee)
3. ✅ Waits for voting round to finalize (~90-180 seconds)
4. ✅ Retrieves Merkle proof from DA Layer
5. ✅ Submits verified proof to MaritimeRiskOracle contract
6. ✅ Verifies data was stored correctly onchain

## 📊 Expected Output

```
============================================================
🚢 FDC PSC Inspection Attestation Test
============================================================

👤 Using wallet: 0x...
💰 Balance: 10.5 C2FLR

📋 Attestation Configuration:
   IMO: 9703318
   API: http://localhost:3000/api/proxy/risk/psc/9703318

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1: Prepare Attestation Request
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 Preparing attestation request via Verifier...
✅ Request prepared

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2: Submit to FDC Hub
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📤 Submitting attestation request to FDC Hub...
   Fee: 0.001 C2FLR
   Tx: 0xabc123...
✅ Request submitted!

📊 Round ID: 12345
🔍 Track on Explorer: https://coston2-systems-explorer...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3: Retrieve Proof from DA Layer
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⏳ Waiting for round to finalize...
   Round 12345 not finalized yet, waiting 10s...
   Round 12345 not finalized yet, waiting 10s...
✅ Round finalized!

📡 Requesting proof from DA Layer...
⏳ Waiting for DA Layer to generate proof...
✅ Proof generated!

📦 Proof retrieved:
   Merkle proof length: 8
   Response hex length: 1024

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 4: Submit Proof to Oracle Contract
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📤 Submitting proof to oracle...
   Tx: 0xdef456...
✅ Proof submitted and verified!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 5: Verify Data Storage
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Stored PSC Inspection:
   IMO: 9703318
   Vessel: MSC OSCAR
   Date: 2024-01-15
   Detained: false
   Deficiencies: 3
   Port: SINGAPORE
   Authority: MPA
   Timestamp: 2025-01-20T10:30:00.000Z

============================================================
✅ FDC Integration Test Complete!
============================================================
```

## 🔧 Troubleshooting

### Error: "Empty Merkle proof"

**Cause:** Round not finalized or proof retrieval too early

**Fix:** Script automatically waits, but if it fails, increase wait time in `Base.ts`

### Error: "Invalid attestation type"

**Cause:** Mismatch between expected and actual attestation type

**Fix:** Verify `attestationType` is correctly set to `Web2Json` (0x5765623244617461...)

### Error: "FdcVerification reverted"

**Possible causes:**
1. Merkle proof doesn't match onchain root
2. Data was modified after attestation
3. Round ID mismatch

**Fix:** Re-run the test to generate a fresh attestation

### Error: "ORACLE_ADDRESS not set"

**Fix:** Deploy oracle contract first:

```bash
npx hardhat run onchain/scripts/deploy.js --network coston2
```

Then add address to `.env`:

```env
ORACLE_ADDRESS=0xYourOracleAddress
```

## 📚 FDC Workflow Explained

### 1. Prepare Request (Offchain)

```
Your API → Verifier API → ABI-encoded request
```

- Verifier validates API is accessible
- Applies jq filter to structure data
- Encodes data according to ABI signature

### 2. Submit Request (Onchain)

```
Wallet → FDC Hub → Attestation submitted
```

- Pays fee (~0.001 C2FLR)
- Request enters voting round queue
- Assigned round ID for tracking

### 3. Voting & Finalization (Distributed)

```
Attestation Providers → Vote on data → Round finalizes
```

- Multiple providers fetch data independently
- Vote on data hash matching
- Round finalizes after 90-180 seconds
- Merkle root stored onchain

### 4. Retrieve Proof (Offchain)

```
DA Layer API → Merkle proof + response data
```

- Provides Merkle proof path
- Includes original response data
- Both needed for onchain verification

### 5. Verify & Store (Onchain)

```
Oracle Contract → Verify proof → Store data
```

- Checks Merkle proof against root
- Validates attestation type
- Decodes and stores data

## 🔗 Useful Links

- **Coston2 Explorer:** https://coston2-explorer.flare.network/
- **FDC Systems Explorer:** https://coston2-systems-explorer.flare.rocks/
- **Faucet:** https://faucet.flare.network/coston2
- **Flare Docs:** https://dev.flare.network/fdc

## 📝 Next Steps

1. **Add more attestation types:**
   - Casualty data
   - Vessel positions
   - Dry dock schedules

2. **Batch testing:**
   - Multiple vessels
   - Historical data verification

3. **Integration with prediction markets:**
   - Automatic market settlement
   - Real-time risk updates
