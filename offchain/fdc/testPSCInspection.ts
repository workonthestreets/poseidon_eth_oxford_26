import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";
import {
  COSTON2_RPC,
  COSTON2_DA_LAYER_URL,
  prepareAttestationRequest,
  submitAttestationRequest,
  retrieveDataAndProofBase,
} from "./Base";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

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
  const imo = "9703318"; // MSC Oscar
  const apiUrl = `http://localhost:3000/api/proxy/risk/psc/${imo}`;
  
  console.log("📋 Attestation Configuration:");
  console.log(`   IMO: ${imo}`);
  console.log(`   API: ${apiUrl}\n`);

  // JQ filter to extract PSC inspection data
  const postProcessJq = `{
    imo: .imo,
    vessel_name: .vessel_name,
    inspection_date: .last_inspection_date,
    detention: (if .risk_detected then "TRUE" else "FALSE" end),
    deficiency_count: .deficiency_count,
    inspection_port: .last_inspection_port,
    inspection_authority: .inspection_authority
  }`;

  // ABI signature matching Solidity struct
  const abiSignature = JSON.stringify({
    components: [
      { internalType: "string", name: "imo", type: "string" },
      { internalType: "string", name: "vessel_name", type: "string" },
      { internalType: "string", name: "inspection_date", type: "string" },
      { internalType: "string", name: "detention", type: "string" },
      { internalType: "uint256", name: "deficiency_count", type: "uint256" },
      { internalType: "string", name: "inspection_port", type: "string" },
      { internalType: "string", name: "inspection_authority", type: "string" }
    ],
    name: "PSCInspectionData",
    type: "tuple"
  });

  try {
    // Step 2: Prepare attestation request
    console.log("━".repeat(60));
    console.log("STEP 1: Prepare Attestation Request");
    console.log("━".repeat(60));
    
    const preparedData = await prepareAttestationRequest(
      apiUrl,
      postProcessJq,
      abiSignature
    );

    // Step 3: Submit to FDC Hub
    console.log("━".repeat(60));
    console.log("STEP 2: Submit to FDC Hub");
    console.log("━".repeat(60));
    
    const roundId = await submitAttestationRequest(
      preparedData.abiEncodedRequest,
      wallet
    );

    // Step 4: Retrieve proof
    console.log("━".repeat(60));
    console.log("STEP 3: Retrieve Proof from DA Layer");
    console.log("━".repeat(60));
    
    const url = `${COSTON2_DA_LAYER_URL}api/v1/fdc/proof-by-request-round-raw`;
    const proof = await retrieveDataAndProofBase(
      url,
      preparedData.abiEncodedRequest,
      roundId,
      provider
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

    const proofStruct = {
      merkleProof: proof.proof || [],
      data: decodedResponse,
    };

    console.log("📤 Submitting proof to oracle...");
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
