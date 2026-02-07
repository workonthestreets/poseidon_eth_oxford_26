import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import {
  COSTON2_RPC,
  COSTON2_DA_LAYER_URL,
  prepareWeb2JsonRequest,
  prepareAddressValidityRequest,
  submitAttestationRequest,
  retrieveDataAndProofBaseWithRetry
} from "./FDCClient.js";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

/**
 * Test script for PSC Inspection attestation workflow
 * 
 * This demonstrates the complete FDC flow:
 * 1. Prepare attestation request for PSC data
 * 2. Submit to FDC Hub
 * 3. Wait for round finalization
 * 4. Retrieve proof from DA Layer
 * 5. Submit proof to MaritimeRiskOracle contract
 */

async function main() {
  console.log("=".repeat(60));
  console.log("🚢 FDC PSC Inspection Attestation Test");
  console.log("=".repeat(60));

  // Setup provider and signer
  const provider = new ethers.JsonRpcProvider(COSTON2_RPC);
  const privateKey = process.env.PRIVATE_KEY;

  if (!privateKey) {
    throw new Error("PRIVATE_KEY not found in .env file");
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  console.log(`\n👤 Using wallet: ${wallet.address}`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`💰 Balance: ${ethers.formatEther(balance)} C2FLR\n`);

  // Get oracle address from env
  const oracleAddress = process.env.ORACLE_ADDRESS;
  if (!oracleAddress) {
    console.log("⚠️  ORACLE_ADDRESS not set in .env");
    console.log("   Deploy oracle first with: npx hardhat run onchain/scripts/deploy.js --network coston2");
    return;
  }

  // Step 1: Define data source and processing
  const imo = "9749544"; // User specified vessel (from Seed List)

  // Use JSDelivr CDN (Proxies GitHub with correct headers for Verifier)
  const githubUser = "joakimtallingsmith";
  const repo = "eth-oxford";
  const branch = "1f1f8cf"; // Specific commit hash to bypass CDN cache of large files
  // const apiUrl = `https://raw.githubusercontent.com/${githubUser}/${repo}/${branch}/offchain/data/psc/${imo}.json`;
  const apiUrl = `https://cdn.jsdelivr.net/gh/${githubUser}/${repo}@${branch}/offchain/data/psc/${imo}.json`;

  console.log("📋 Attestation Configuration:");
  console.log(`   IMO: ${imo}`);
  console.log(`   API: ${apiUrl}\n`);

  // JQ filter - Updated for Nested JSON structure (full profile)
  // The file contains { psc: {...}, drydock: {...} }
  const postProcessJq = `{
    imo: .psc.imo,
    risk_detected: (if .psc.risk_detected then "true" else "false" end),
    detention_count: (.psc.detention_count | tostring),
    deficiency_count: (.psc.deficiency_count | tostring),
    inspection_authority: .psc.inspection_authority,
    inspection_port: .psc.inspection_port,
    inspection_date: .psc.inspection_date,
    detention: .psc.detention
  }`;

  // ABI signature - all strings for maximum compatibility
  const abiSignature = JSON.stringify({
    components: [
      { internalType: "string", name: "imo", type: "string" },
      { internalType: "string", name: "risk_detected", type: "string" },
      { internalType: "string", name: "detention_count", type: "string" },
      { internalType: "string", name: "deficiency_count", type: "string" },
      { internalType: "string", name: "inspection_authority", type: "string" },
      { internalType: "string", name: "inspection_port", type: "string" },
      { internalType: "string", name: "inspection_date", type: "string" },
      { internalType: "string", name: "detention", type: "string" }
    ],
    name: "PSCInspectionData",
    type: "tuple"
  });

  try {
    // Step 2: Prepare attestation request
    console.log("━".repeat(60));
    console.log("STEP 1: Prepare Attestation Request");
    console.log("━".repeat(60));

    // Prepare Web2Json Request
    const preparedData = await prepareWeb2JsonRequest(
      apiUrl,
      postProcessJq,
      abiSignature
    );

    console.log("   (Web2Json Request Prepared)");

    // Log the API data for user verification
    try {
      const res = await fetch(apiUrl);
      if (res.ok) {
        const data = await res.json();
        console.log("\n   📦 API Response Payload (Local Fetch):");
        console.log(JSON.stringify(data, null, 2).replace(/^/gm, "      "));
      } else {
        console.warn(`   ⚠️  Failed to fetch data locally: ${res.status}`);
      }
    } catch (e: any) {
      console.warn(`   ⚠️  Could not fetch data locally: ${e.message}`);
    }

    // Step 3: Submit to FDC Hub
    console.log("━".repeat(60));
    console.log("STEP 2: Submit to FDC Hub (Web2Json)");
    console.log("━".repeat(60));

    const roundId = await submitAttestationRequest(
      preparedData.abiEncodedRequest,
      wallet
    );

    // Step 4: Retrieve proof
    console.log("━".repeat(60));
    console.log("STEP 3: Retrieve Proof from DA Layer");
    console.log("━".repeat(60));

    // Use the DA Layer URL (matches Flare example pattern)
    const daLayerUrl = COSTON2_DA_LAYER_URL;

    const proof = await retrieveDataAndProofBaseWithRetry(
      daLayerUrl,
      preparedData.abiEncodedRequest,
      roundId
    );

    console.log("📦 Proof retrieved:");
    console.log(`   Merkle proof length: ${proof.proof?.length || 0}`);
    console.log(`   Response hex length: ${proof.response_hex?.length || 0}\n`);

    // Step 5: Submit to oracle contract
    console.log("━".repeat(60));
    console.log("STEP 4: Submit Proof to Oracle Contract");
    console.log("━".repeat(60));

    const oracleAbi = [
      "function submitPSCInspectionWithProof((bytes32[],((bytes32,bytes32,uint64,uint64,(string,string,string,string,string,string,string),(bytes)))) _proof) external",
      "function getLatestPSCInspection(string imo) external view returns ((string,string,string,bool,uint256,string,string,uint256))"
    ];

    const oracle = new ethers.Contract(oracleAddress, oracleAbi, wallet);

    // Decode response_hex to get Response struct
    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const responseType = [
      "tuple(bytes32,bytes32,uint64,uint64,tuple(string,string,string,string,string,string,string),tuple(bytes))"
    ];

    const decodedResponse = abiCoder.decode(responseType, proof.response_hex)[0];

    // Map proof to struct expected by Oracle
    // Oracle expects: Proof { merkleProof, data { ... } }
    const proofStruct = {
      merkleProof: proof.proof || [],
      data: decodedResponse,
    };

    console.log("📤 Submitting proof to oracle...");
    // Check gas first just in case
    // const gas = await oracle.submitPSCInspectionWithProof.estimateGas(proofStruct);
    // console.log(`   Estimated Gas: ${gas}`);

    const tx = await oracle.submitPSCInspectionWithProof(proofStruct);
    console.log(`   Tx: ${tx.hash}`);

    await tx.wait();
    console.log("✅ Proof submitted and verified!\n");

    // Step 6: Verify data was stored
    console.log("━".repeat(60));
    console.log("STEP 5: Verify Data Storage");
    console.log("━".repeat(60));

    const inspection = await oracle.getLatestPSCInspection(imo);
    console.log("\n📋 Stored PSC Inspection:");
    console.log(`   IMO: ${inspection[0]}`);
    console.log(`   Vessel: ${inspection[1]}`);
    console.log(`   Date: ${inspection[2]}`);
    console.log(`   Detained: ${inspection[3]}`);
    console.log(`   Deficiencies: ${inspection[4]}`);
    console.log(`   Port: ${inspection[5]}`);
    console.log(`   Authority: ${inspection[6]}`);
    console.log(`   Timestamp: ${new Date(Number(inspection[7]) * 1000).toISOString()}\n`);

    console.log("=".repeat(60));
    console.log("✅ FDC Integration Test Complete!");
    console.log("=".repeat(60));

  } catch (error: any) {
    console.error("\n❌ Error:", error.message);
    if (error.data) {
      console.error("   Data:", error.data);
    }
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
