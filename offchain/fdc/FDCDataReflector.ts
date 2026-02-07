import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import {
  toUtf8HexString,
  COSTON2_RPC,
  COSTON2_DA_LAYER_URL,
  prepareWeb2JsonRequest,
  submitAttestationRequest,
  retrieveDataAndProofBaseWithRetry
} from "./FDCClient.js";

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// --- Application Config ---
const VERIFIER_URL = process.env.VERIFIER_URL_TESTNET || "https://fdc-verifiers-testnet.flare.network";
const COSTON2_DA_LAYER_URL_ENV = process.env.COSTON2_DA_LAYER_URL || COSTON2_DA_LAYER_URL;

// --- JQ Filter & ABI ---
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

// --- Main Service Logic ---

async function runReflector() {
  console.log("=".repeat(60));
  console.log("🚢 FDC Data Reflector Service (Production Mode)");
  console.log("=".repeat(60));

  const provider = new ethers.JsonRpcProvider(COSTON2_RPC);
  const privateKey = process.env.PRIVATE_KEY;

  if (!privateKey) {
    throw new Error("PRIVATE_KEY not found in .env file");
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  const targetImo = "9749544"; // Configurable target

  console.log(`[SERVICE] Starting pipeline for IMO: ${targetImo}`);

  try {
    await processVesselRisk(targetImo, wallet);
  } catch (criticalError: any) {
    console.error(`[CRITICAL] Reflector Service Failure: ${criticalError.message}`);
    process.exit(1);
  }
}

async function processVesselRisk(imo: string, wallet: ethers.Wallet) {
  const githubUser = "joakimtallingsmith";
  const repo = "eth-oxford";
  const branch = "main"; // Production data
  const apiUrl = `https://cdn.jsdelivr.net/gh/${githubUser}/${repo}@${branch}/offchain/data/risk_data/${imo}.json`;

  console.log(`[INFO] Source: ${apiUrl}`);

  try {
    // Step 1: Prepare Attestation
    console.log(`[STEP 1] Preparing Web2Json Request...`);
    const preparedData = await prepareWeb2JsonRequest(apiUrl, postProcessJq, abiSignature);

    // Step 2: Submit to FDC Hub
    console.log(`[STEP 2] Submitting to FDC Hub...`);
    const roundId = await submitAttestationRequest(preparedData.abiEncodedRequest, wallet);
    console.log(`[INFO] Round ID: ${roundId}`);

    // Step 3: Retrieve Proof
    console.log(`[STEP 3] Waiting for proof finalization (~90s)...`);

    // Use client utility with retry loops
    const proof = await retrieveDataAndProofBaseWithRetry(
      COSTON2_DA_LAYER_URL_ENV,
      preparedData.abiEncodedRequest,
      roundId
    );

    // Step 4: Validate and Push On-Chain
    console.log(`[STEP 4] Proof Retrieved! Pushing to Risk Oracle...`);
    await updateRiskOracleWithProof(imo, proof, wallet);

  } catch (e: any) {
    console.warn(`[WARN] FDC Verification Failed: ${e.message}`);
    console.warn(`[WARN] Triggering FALLBACK Mechanism...`);
    await fallbackDirectUpdate(imo, wallet);
  }
}

async function updateRiskOracleWithProof(imo: string, proof: any, wallet: ethers.Wallet) {
  // Contract Interaction Logic
  // const oracle = new ethers.Contract(ORACLE_ADDRESS, ORACLE_ABI, wallet);
  // await oracle.updateRiskWithProof(proof);

  console.log(`[ACTION] (MOCK) Successfully updated Risk Oracle for IMO ${imo} with verified proof.`);
}

async function fallbackDirectUpdate(imo: string, wallet: ethers.Wallet) {
  // Fallback Logic: Direct Trusted Update
  console.log(`[FALLBACK] (MOCK) Bypassing verification. Updating Risk Oracle DIRECTLY with raw data.`);
  console.log(`[SUCCESS] Fallback update completed.`);
}

// Execute
runReflector().catch(console.error);
