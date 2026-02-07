import { ethers } from "ethers";
import * as fs from "fs";
import * as dotenv from "dotenv";
import * as path from "path";

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// ABI for the FdcHub (Minimal interface for requesting attestation)
const IFdcHub = [
    "function requestAttestation(bytes calldata _data) external payable"
];

const IECHO_FDC_HUB_ADDRESS = "0x9f4391223016782564e33d275beb52e2a628f73a"; // Coston2

async function main() {
    console.log("Starting Vessel Risk Attestation (PSC/Casualties) on Coston2...");

    // 1. Definition of the Data Source
    // Allow passing IMO as first argument
    const args = process.argv.slice(2);
    // IMO numbers are usually 7 digits
    const imo = args.find(a => /^\d{7}$/.test(a) && !a.startsWith('--')) || "9703318"; // Default to MSC Oscar

    console.log(`Using Vessel IMO: ${imo}`);
    const proxyUrl = `http://localhost:3000/api/proxy/risk/psc/${imo}`;

    // 2. Definition of the JQ Filter
    // We want to attest that 'risk_detected' is true (i.e., vessel is high risk)
    // If risk_detected is true, return 1, else 0.
    const jqFilter = `if .risk_detected == true then 1 else 0 end`;

    // 3. Construct the Attestation Request
    const attestationType = "0x4955510000000000000000000000000000000000000000000000000000000000"; // Generic UIQ
    const sourceId = "0x4955510000000000000000000000000000000000000000000000000000000000"; // Generic UIQ

    // Helper to encode string to hex
    const toHex = (str: string) => "0x" + Buffer.from(str, "utf8").toString("hex");

    // The Request Body (ABI Encoded for FDC)
    const requestBody = ethers.AbiCoder.defaultAbiCoder().encode(
        ["string", "string", "string"],
        [proxyUrl, jqFilter, attestationType]
    );

    console.log(`Targeting Proxy URL: ${proxyUrl}`);
    console.log("---------------------------------------------------");

    // FETCH DATA FROM LOCAL PROXY TO VERIFY BEFORE SUBMITTING
    try {
        const response = await fetch(proxyUrl);
        const data: any = await response.json();
        console.log(" [Verified] Proxy Data:", JSON.stringify(data, null, 2));

        if (!data.risk_detected) {
            console.log("\n[Note] This vessel is currently marked as SAFE (risk_detected: false).");
            console.log(`Deficiencies Found: ${data.deficiency_count}`);
        } else {
            console.log("\n[Alert] Risk DETECTED for this vessel!");
            console.log(`Detentions: ${data.detention_count}`);
            console.log(`Deficiencies: ${data.deficiency_count}`);
            console.log(`Latest Deficiency: ${data.deficiency_description.substring(0, 100)}...`);
            console.log(`Last Detention Date: ${data.last_detention_date}`);
        }
    } catch (e) {
        console.error(" [Error] Could not fetch from local proxy. Ensure 'npm run dev' is running.");
        console.error(e);
        return;
    }
    console.log("---------------------------------------------------");

    // 4. Connect to Network
    const provider = new ethers.JsonRpcProvider("https://coston2-api.flare.network/ext/bc/C/rpc");
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        throw new Error("PRIVATE_KEY not found in .env");
    }
    const wallet = new ethers.Wallet(privateKey, provider);
    const fdcHub = new ethers.Contract(IECHO_FDC_HUB_ADDRESS, IFdcHub, wallet);


    // 5. Submit Transaction
    // Construct the payload for FdcHub.requestAttestation
    // Usually: abi.encode(attestationType, sourceId, requestBody)
    const payload = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "bytes32", "bytes"],
        [attestationType, sourceId, requestBody]
    );

    console.log(`FdcHub Address: ${IECHO_FDC_HUB_ADDRESS}`);
    console.log("Submitting attestation request...");

    // UNCOMMENT TO SUBMIT REAL TRANSACTION
    const tx = await fdcHub.requestAttestation(payload, { value: ethers.parseEther("1.0") }); // Fee 1 C2FLR
    console.log(`Transaction submitted: ${tx.hash}`);
    await tx.wait();

    console.log("---------------------------------------------------");
    console.log("Risk Attestation Request Submitted Successfully!");
    console.log("View on Explorer: https://coston2-explorer.flare.network/tx/" + tx.hash);
    console.log("Request Payload:", payload);
    console.log("---------------------------------------------------");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
