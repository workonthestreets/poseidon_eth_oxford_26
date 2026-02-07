const hre = require("hardhat");

/**
 * FDC Attestation Integration Script
 * 
 * This script demonstrates how to:
 * 1. Prepare an attestation request for Datalastic API data
 * 2. Submit it to FDC
 * 3. Wait for finalization
 * 4. Retrieve and submit proof to the oracle contract
 */

// Configuration
const WEB2JSON_VERIFIER_URL = "https://fdc-verifiers-testnet.flare.network/verifier/web2/";
const COSTON2_DA_LAYER_URL = "https://ctn2-data-availability.flare.network/";
const VERIFIER_API_KEY = process.env.VERIFIER_API_KEY || "";

// Helper functions
function toHex(data) {
  let result = "";
  for (let i = 0; i < data.length; i++) {
    result += data.charCodeAt(i).toString(16);
  }
  return result.padEnd(64, "0");
}

function toUtf8HexString(data) {
  return "0x" + toHex(data);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Prepare attestation request for Datalastic Inspection API
 */
async function prepareInspectionAttestationRequest(imo) {
  const apiUrl = `https://api.datalastic.com/api/maritime_reports/inspections?api-key=${process.env.DATALASTIC_API_KEY}&imo=${imo}`;
  
  // JQ filter to extract relevant fields
  const postProcessJq = `{
    imo: .data[0].imo,
    vessel_name: .data[0].vessel_name,
    inspection_date: .data[0].inspection_date,
    detention: .data[0].detention,
    deficiency_count: (.data[0].ship_deficiencies | tonumber),
    inspection_port: .data[0].inspection_port,
    inspection_authority: .data[0].inspection_authority
  }`;
  
  // ABI signature for Solidity struct
  const abiSignature = `{
    "components": [
      {"internalType": "string", "name": "imo", "type": "string"},
      {"internalType": "string", "name": "vessel_name", "type": "string"},
      {"internalType": "string", "name": "inspection_date", "type": "string"},
      {"internalType": "string", "name": "detention", "type": "string"},
      {"internalType": "uint256", "name": "deficiency_count", "type": "uint256"},
      {"internalType": "string", "name": "inspection_port", "type": "string"},
      {"internalType": "string", "name": "inspection_authority", "type": "string"}
    ],
    "name": "PSCInspectionData",
    "type": "tuple"
  }`;

  const requestBody = {
    url: apiUrl,
    httpMethod: "GET",
    headers: "{}",
    queryParams: "{}",
    body: "{}",
    postProcessJq: postProcessJq,
    abiSignature: abiSignature,
  };

  const request = {
    attestationType: toUtf8HexString("Web2Json"),
    sourceId: toUtf8HexString("PublicWeb2"),
    requestBody: requestBody,
  };

  console.log("Preparing attestation request...");
  
  const response = await fetch(`${WEB2JSON_VERIFIER_URL}Web2Json/prepareRequest`, {
    method: "POST",
    headers: {
      "X-API-KEY": VERIFIER_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Verifier error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Prepare attestation request for Datalastic Casualty API
 */
async function prepareCasualtyAttestationRequest(imo) {
  const apiUrl = `https://api.datalastic.com/api/maritime_reports/casualty?api-key=${process.env.DATALASTIC_API_KEY}&imo=${imo}`;
  
  const postProcessJq = `{
    imo: .data[0].imo,
    vessel_name: .data[0].vessel_name,
    casualty_date: .data[0].casualty_date,
    casualty_type: .data[0].casualty_type,
    casualty_details: .data[0].casualty_details
  }`;
  
  const abiSignature = `{
    "components": [
      {"internalType": "string", "name": "imo", "type": "string"},
      {"internalType": "string", "name": "vessel_name", "type": "string"},
      {"internalType": "string", "name": "casualty_date", "type": "string"},
      {"internalType": "string", "name": "casualty_type", "type": "string"},
      {"internalType": "string", "name": "casualty_details", "type": "string"}
    ],
    "name": "CasualtyData",
    "type": "tuple"
  }`;

  const requestBody = {
    url: apiUrl,
    httpMethod: "GET",
    headers: "{}",
    queryParams: "{}",
    body: "{}",
    postProcessJq: postProcessJq,
    abiSignature: abiSignature,
  };

  const request = {
    attestationType: toUtf8HexString("Web2Json"),
    sourceId: toUtf8HexString("PublicWeb2"),
    requestBody: requestBody,
  };

  const response = await fetch(`${WEB2JSON_VERIFIER_URL}Web2Json/prepareRequest`, {
    method: "POST",
    headers: {
      "X-API-KEY": VERIFIER_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Verifier error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Submit attestation request to FDC Hub
 */
async function submitAttestationRequest(abiEncodedRequest) {
  const [signer] = await hre.ethers.getSigners();
  
  // Get FDC Hub contract
  const fdcHubAddress = "0xB7a75B4F8F5c6A20f88f42089C4F5E36f2D8C5E0"; // Coston2 FdcHub
  const fdcHubAbi = [
    "function requestAttestation(bytes calldata _data) external payable returns (bool)",
  ];
  const fdcHub = new hre.ethers.Contract(fdcHubAddress, fdcHubAbi, signer);

  // Get fee configuration
  const feeConfigAddress = "0x123..."; // Replace with actual address
  const feeConfigAbi = [
    "function getRequestFee(bytes calldata _data) external view returns (uint256)",
  ];
  
  // For demo, use a fixed fee (check actual fee from contract)
  const fee = hre.ethers.parseEther("0.001");

  console.log("Submitting attestation request to FDC Hub...");
  const tx = await fdcHub.requestAttestation(abiEncodedRequest, { value: fee });
  const receipt = await tx.wait();
  
  // Calculate round ID from block timestamp
  const block = await hre.ethers.provider.getBlock(receipt.blockNumber);
  const firstVotingRoundStartTs = 1658429955n; // Coston2 specific
  const votingEpochDurationSeconds = 90n;
  const roundId = Number((BigInt(block.timestamp) - firstVotingRoundStartTs) / votingEpochDurationSeconds);
  
  console.log(`Attestation submitted in round ${roundId}`);
  console.log(`Track progress: https://coston2-systems-explorer.flare.rocks/voting-epoch/${roundId}?tab=fdc`);
  
  return roundId;
}

/**
 * Wait for round finalization and retrieve proof
 */
async function retrieveProof(abiEncodedRequest, roundId) {
  // Check relay for finalization
  const relayAddress = "0x.."; // Coston2 Relay address
  const relayAbi = [
    "function isFinalized(uint256 _protocolId, uint256 _votingRoundId) external view returns (bool)",
  ];
  const relay = new hre.ethers.Contract(relayAddress, relayAbi, hre.ethers.provider);

  console.log("Waiting for round to finalize...");
  while (!(await relay.isFinalized(200, roundId))) {
    await sleep(10000); // Check every 10 seconds
  }
  console.log("Round finalized!");

  // Retrieve proof from DA Layer
  const proofRequest = {
    votingRoundId: roundId,
    requestBytes: abiEncodedRequest,
  };

  await sleep(5000); // Give DA Layer time to process

  let proof = null;
  while (!proof || !proof.response_hex) {
    const response = await fetch(`${COSTON2_DA_LAYER_URL}api/v1/fdc/proof-by-request-round-raw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(proofRequest),
    });
    proof = await response.json();
    if (!proof.response_hex) {
      console.log("Waiting for proof generation...");
      await sleep(5000);
    }
  }

  console.log("Proof retrieved successfully!");
  return proof;
}

/**
 * Submit proof to oracle contract
 */
async function submitProofToOracle(proof, oracleAddress, dataType) {
  const [signer] = await hre.ethers.getSigners();
  const oracle = await hre.ethers.getContractAt("MaritimeRiskOracle", oracleAddress, signer);

  // Decode response
  const IWeb2JsonVerificationAbi = [
    {
      "inputs": [{ "components": [
        { "name": "merkleProof", "type": "bytes32[]" },
        { "name": "data", "type": "tuple", "components": [
          { "name": "attestationType", "type": "bytes32" },
          { "name": "sourceId", "type": "bytes32" },
          { "name": "votingRound", "type": "uint64" },
          { "name": "lowestUsedTimestamp", "type": "uint64" },
          { "name": "requestBody", "type": "tuple", "components": [
            { "name": "url", "type": "string" },
            { "name": "httpMethod", "type": "string" },
            { "name": "headers", "type": "string" },
            { "name": "queryParams", "type": "string" },
            { "name": "body", "type": "string" },
            { "name": "postProcessJq", "type": "string" },
            { "name": "abiSignature", "type": "string" }
          ]},
          { "name": "responseBody", "type": "tuple", "components": [
            { "name": "abiEncodedData", "type": "bytes" }
          ]}
        ]}
      ], "name": "_proof", "type": "tuple" }],
      "name": "verify",
      "outputs": [{ "name": "", "type": "bool" }],
      "stateMutability": "view",
      "type": "function"
    }
  ];

  const abiCoder = hre.ethers.AbiCoder.defaultAbiCoder();
  const decodedResponse = abiCoder.decode(
    ["tuple(bytes32,bytes32,uint64,uint64,tuple(string,string,string,string,string,string,string),tuple(bytes))"],
    proof.response_hex
  )[0];

  const proofStruct = {
    merkleProof: proof.proof || [],
    data: decodedResponse,
  };

  console.log(`Submitting ${dataType} data to oracle...`);
  
  let tx;
  if (dataType === "inspection") {
    tx = await oracle.submitPSCInspectionWithProof(proofStruct);
  } else if (dataType === "casualty") {
    tx = await oracle.submitCasualtyWithProof(proofStruct);
  }
  
  await tx.wait();
  console.log("Data submitted to oracle successfully!");
}

/**
 * Main function - demonstrates full FDC flow
 */
async function main() {
  console.log("=== FDC Attestation Demo ===\n");

  const oracleAddress = process.env.ORACLE_ADDRESS;
  if (!oracleAddress) {
    console.log("Please set ORACLE_ADDRESS environment variable");
    console.log("Run deploy.js first and set the oracle address");
    return;
  }

  const imo = "9703318"; // MSC Oscar

  try {
    // Step 1: Prepare attestation request
    console.log("Step 1: Preparing attestation request...");
    const preparedRequest = await prepareInspectionAttestationRequest(imo);
    console.log("Request prepared:", preparedRequest.abiEncodedRequest?.substring(0, 100) + "...\n");

    // Step 2: Submit to FDC (requires actual deployment)
    // const roundId = await submitAttestationRequest(preparedRequest.abiEncodedRequest);

    // Step 3: Retrieve proof
    // const proof = await retrieveProof(preparedRequest.abiEncodedRequest, roundId);

    // Step 4: Submit to oracle
    // await submitProofToOracle(proof, oracleAddress, "inspection");

    console.log("\nNote: Full FDC flow requires:");
    console.log("  1. Deployed contracts on Coston2");
    console.log("  2. Datalastic API whitelisted by Flare");
    console.log("  3. Sufficient C2FLR for gas fees");
    console.log("\nFor hackathon demo, use manual data submission instead.");

  } catch (error) {
    console.error("Error:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
