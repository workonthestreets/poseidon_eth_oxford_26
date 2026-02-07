# Flare Data Connector (FDC) Workflow Guide

## Overview

FDC enables **trustless verification of off-chain data** on the Flare blockchain. Instead of trusting a single oracle, data is attested by Flare's decentralized data providers and stored in a Merkle tree.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FDC DATA FLOW                                       │
└─────────────────────────────────────────────────────────────────────────────┘

  DATALASTIC API                 FLARE NETWORK                 OUR CONTRACTS
  ─────────────                  ─────────────                 ─────────────
       │                              │                              │
       │  1. API Request              │                              │
       │◄─────────────────────────────┤                              │
       │                              │                              │
       │  2. JSON Response            │                              │
       ├─────────────────────────────►│                              │
       │                              │                              │
       │                   3. Data Providers                         │
       │                      Verify & Vote                          │
       │                              │                              │
       │                   4. Merkle Root                            │
       │                      Finalized                              │
       │                              │                              │
       │                   5. Proof Retrieved                        │
       │                              ├─────────────────────────────►│
       │                              │                              │
       │                              │  6. Verify Proof On-Chain    │
       │                              │         & Store Data         │
       │                              │                              │
```

---

## Step-by-Step Attestation Flow

### Step 1: Prepare Attestation Request

Define what data you want to attest from Datalastic API.

```javascript
// File: onchain/scripts/fdcAttestation.js

const request = {
  // What type of attestation
  attestationType: "0x5765623254736f6e...",  // "Web2Json" in hex
  
  // Source identifier
  sourceId: "0x5075626c69635765623200...",   // "PublicWeb2" in hex
  
  // The actual request
  requestBody: {
    url: "https://api.datalastic.com/api/maritime_reports/inspections?api-key=XXX&imo=9703318",
    httpMethod: "GET",
    headers: "{}",
    queryParams: "{}",
    body: "{}",
    
    // JQ filter to extract specific fields
    postProcessJq: `{
      imo: .data[0].imo,
      vessel_name: .data[0].vessel_name,
      detention: .data[0].detention,
      deficiency_count: (.data[0].ship_deficiencies | tonumber)
    }`,
    
    // How to encode for Solidity
    abiSignature: `{
      "components": [
        {"name": "imo", "type": "string"},
        {"name": "vessel_name", "type": "string"},
        {"name": "detention", "type": "string"},
        {"name": "deficiency_count", "type": "uint256"}
      ],
      "type": "tuple"
    }`
  }
};
```

### Step 2: Submit to FDC Verifier

Send the request to Flare's verifier to prepare it for submission.

```javascript
const VERIFIER_URL = "https://fdc-verifiers-testnet.flare.network/verifier/web2/";

const response = await fetch(`${VERIFIER_URL}Web2Json/prepareRequest`, {
  method: "POST",
  headers: {
    "X-API-KEY": process.env.VERIFIER_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(request),
});

const preparedRequest = await response.json();
// Returns: { abiEncodedRequest: "0x..." }
```

### Step 3: Submit to FDC Hub (On-Chain)

Pay the attestation fee and submit the request to the FdcHub contract.

```javascript
const FDC_HUB_ADDRESS = "0x9f4391223016782564e33d275beb52e2a628f73a"; // Coston2

const fdcHub = new ethers.Contract(FDC_HUB_ADDRESS, [
  "function requestAttestation(bytes calldata _data) external payable"
], signer);

// Submit with fee (typically 0.5-1 C2FLR)
const tx = await fdcHub.requestAttestation(
  preparedRequest.abiEncodedRequest,
  { value: ethers.parseEther("1.0") }
);

const receipt = await tx.wait();
console.log("Submitted in block:", receipt.blockNumber);
```

### Step 4: Wait for Voting Round Finalization

FDC operates in 90-second voting rounds. Wait for the round to finalize.

```javascript
// Calculate which round our request is in
const block = await provider.getBlock(receipt.blockNumber);
const FIRST_VOTING_ROUND_START = 1658429955n;  // Coston2 specific
const VOTING_EPOCH_DURATION = 90n;             // 90 seconds

const roundId = Number(
  (BigInt(block.timestamp) - FIRST_VOTING_ROUND_START) / VOTING_EPOCH_DURATION
);

console.log(`Request in voting round: ${roundId}`);
console.log(`Track: https://coston2-systems-explorer.flare.rocks/voting-epoch/${roundId}?tab=fdc`);

// Wait for finalization (typically 3-5 minutes)
const relay = new ethers.Contract(RELAY_ADDRESS, [
  "function isFinalized(uint256 _protocolId, uint256 _votingRoundId) view returns (bool)"
], provider);

while (!(await relay.isFinalized(200, roundId))) {
  console.log("Waiting for finalization...");
  await sleep(10000);  // Check every 10 seconds
}

console.log("Round finalized!");
```

### Step 5: Retrieve Proof from DA Layer

Once finalized, fetch the Merkle proof from Flare's Data Availability layer.

```javascript
const DA_LAYER_URL = "https://ctn2-data-availability.flare.network/";

const proofResponse = await fetch(
  `${DA_LAYER_URL}api/v1/fdc/proof-by-request-round-raw`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      votingRoundId: roundId,
      requestBytes: preparedRequest.abiEncodedRequest,
    }),
  }
);

const proof = await proofResponse.json();
// Returns: { proof: [...merkleProof], response_hex: "0x..." }
```

### Step 6: Submit Proof to Oracle Contract

Finally, submit the verified proof to our MaritimeRiskOracle contract.

```javascript
const oracle = await ethers.getContractAt("MaritimeRiskOracle", ORACLE_ADDRESS);

// Decode and structure the proof
const proofStruct = {
  merkleProof: proof.proof,
  data: {
    attestationType: "...",
    sourceId: "...",
    votingRound: roundId,
    lowestUsedTimestamp: "...",
    requestBody: { /* ... */ },
    responseBody: {
      abiEncodedData: proof.response_hex
    }
  }
};

// Submit to oracle - this verifies the proof on-chain!
const tx = await oracle.submitPSCInspectionWithProof(proofStruct);
await tx.wait();

console.log("Data verified and stored on-chain!");
```

---

## Complete Timeline

```
Time      Action                                    Who
────────────────────────────────────────────────────────────────
T+0s      Submit attestation request to FdcHub      You
T+0s      FDC collects request                      FdcHub
T+90s     Voting round ends                         Network
T+90s     Data providers vote on data               100+ Providers
T+180s    Votes tallied, Merkle root finalized      Relay Contract
T+180s    Proof available on DA Layer               DA Layer
T+180s    Submit proof to Oracle                    You
T+180s    Data stored trustlessly on-chain!         Oracle Contract
```

---

## Code Files Reference

| File | Purpose |
|------|---------|
| `onchain/scripts/fdcAttestation.js` | Full FDC flow example |
| `onchain/contracts/MaritimeRiskOracle.sol` | Receives & verifies proofs |
| `offchain/fdc/AttestRisk.ts` | TypeScript attestation helper |

---

## Key Contracts (Coston2 Testnet)

| Contract | Address |
|----------|---------|
| FdcHub | `0x9f4391223016782564e33d275beb52e2a628f73a` |
| Relay | Check [Flare Docs](https://dev.flare.network/network/solidity-reference) |
| FdcVerification | Retrieved via `ContractRegistry.getFdcVerification()` |

---

## Datalastic Endpoints for FDC

### PSC Inspections
```
URL: https://api.datalastic.com/api/maritime_reports/inspections?api-key={KEY}&imo={IMO}

JQ Filter:
{
  imo: .data[0].imo,
  vessel_name: .data[0].vessel_name,
  inspection_date: .data[0].inspection_date,
  detention: .data[0].detention,
  deficiency_count: (.data[0].ship_deficiencies | tonumber),
  inspection_port: .data[0].inspection_port
}
```

### Casualties
```
URL: https://api.datalastic.com/api/maritime_reports/casualty?api-key={KEY}&imo={IMO}

JQ Filter:
{
  imo: .data[0].imo,
  vessel_name: .data[0].vessel_name,
  casualty_date: .data[0].casualty_date,
  casualty_type: .data[0].casualty_type
}
```

### Dry Dock
```
URL: https://api.datalastic.com/api/v2/dry_dock_dates?api-key={KEY}&imo={IMO}

JQ Filter:
{
  imo: .data[0].imo,
  dry_dock_from: .data[0].dry_dock_from,
  dry_dock_to: .data[0].dry_dock_to
}
```

### Vessel Position
```
URL: https://api.datalastic.com/api/v2/vessel?api-key={KEY}&imo={IMO}

JQ Filter:
{
  imo: .data.imo,
  lat: .data.lat,
  lon: .data.lon,
  navigation_status: .data.navigation_status,
  destination: .data.destination
}
```

---

## Hackathon Shortcut: Manual Submission

For the hackathon demo, you can skip FDC and use manual submission:

```javascript
// No FDC proof needed - authorized address can submit directly
await oracle.submitPSCInspectionManual(
  "9703318",        // IMO
  "MSC OSCAR",      // Vessel name
  "2025-02-07",     // Inspection date
  false,            // Detained
  2,                // Deficiency count
  "Rotterdam",      // Port
  "Paris MOU"       // Authority
);
```

This is useful for:
- Testing contract logic
- Demo purposes
- When Datalastic isn't whitelisted by Flare yet

---

## Troubleshooting

### "Proof verification failed"
- Ensure you're using the correct voting round ID
- Wait a few more seconds after finalization
- Check that the request bytes match exactly

### "Attestation request rejected"
- Verify API URL is accessible
- Check JQ filter syntax
- Ensure ABI signature matches expected types

### "Insufficient fee"
- Increase the value sent to `requestAttestation()`
- Typical fee: 0.5-1 C2FLR

---

## Visual Summary

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Datalastic  │    │   FDC Hub    │    │  DA Layer    │    │   Oracle     │
│     API      │    │  (On-Chain)  │    │  (Off-Chain) │    │  Contract    │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │                   │
       │ ◄──── Request ────┤                   │                   │
       │                   │                   │                   │
       │ ──── Response ───►│                   │                   │
       │                   │                   │                   │
       │                   │ ── Attestation ──►│                   │
       │                   │    Request        │                   │
       │                   │                   │                   │
       │                   │ ◄── Merkle Root ──┤                   │
       │                   │    Finalized      │                   │
       │                   │                   │                   │
       │                   │                   │ ◄── Get Proof ────┤
       │                   │                   │                   │
       │                   │                   │ ──── Proof ──────►│
       │                   │                   │                   │
       │                   │                   │         ┌─────────┴─────────┐
       │                   │                   │         │ verifyWeb2Json()  │
       │                   │                   │         │ Store if valid    │
       │                   │                   │         └───────────────────┘
```

---

## Next Steps

1. **Deploy contracts**: `npx hardhat run onchain/scripts/deploy.js --network coston2`
2. **Test with manual data**: `npx hardhat run onchain/scripts/demo.js --network coston2`
3. **Try FDC flow**: `npx hardhat run onchain/scripts/fdcAttestation.js --network coston2`
4. **Create markets**: Use `MaritimePredictionMarket.createPSCDetentionMarket()`
5. **Settle with oracle**: Call `settlePSCDetentionMarket()` after expiry
