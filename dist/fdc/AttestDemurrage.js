"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hardhat_1 = require("hardhat");
// Helper to encode string to hex
function toHex(data) {
    return hardhat_1.ethers.hexlify(hardhat_1.ethers.toUtf8Bytes(data));
}
async function main() {
    console.log("Starting Demurrage Attestation on Coston2...");
    // 1. Definition of the Data Source
    const containerId = "TEST_CONTAINER_001";
    // NOTE: For local testing, this URL must be reachable by the Flare Validator nodes.
    // You would typically tunnel this via ngrok, e.g., https://your-ngrok-id.ngrok-free.app/api/proxy/demurrage/...
    const proxyUrl = `http://localhost:3000/api/proxy/demurrage/${containerId}`;
    console.log(`Targeting Proxy URL (Must be publicly accessible): ${proxyUrl}`);
    // 2. Define the Request
    const targetVesselIMO = "9703318";
    const targetPort = "USNYC";
    // JQ Filter: Selects 1 if vessel/port match and demurrage is true, else 0
    const jqFilter = `if .vessel_imo == "${targetVesselIMO}" and .pod_locode == "${targetPort}" and .demurrage_fee_detected == true then 1 else 0 end`;
    // 3. Construct the Attestation Request Body
    const requestBody = {
        url: proxyUrl,
        postprocessJq: jqFilter,
        abiSignature: "{\"components\":[{\"name\":\"demurrageOccurred\",\"type\":\"uint256\"}],\"name\":\"result\",\"type\":\"tuple\"}"
    };
    // 4. Encode the Request for the FDC
    const abiEncodedRequest = hardhat_1.ethers.AbiCoder.defaultAbiCoder().encode(["string", "string", "string"], [requestBody.url, requestBody.postprocessJq, requestBody.abiSignature]);
    // 5. Interact with Flare Data Connector
    // Verified Coston2 FdcHub Address
    const fdcHubAddress = "0x9f4391223016782564E33D275Beb52E2a628f73A";
    console.log(`FdcHub Address: ${fdcHubAddress}`);
    // Get Contract instance (using a generic interface or the artifact if available)
    // Here we use a minimal interface for submission
    const IFdcHub = [
        "function requestAttestation(bytes calldata _data) external payable"
    ];
    const fdcHub = await hardhat_1.ethers.getContractAt(IFdcHub, fdcHubAddress);
    // 6. Submit Attestation
    // Type 0x01 is Web2Json on recent Flare updates (verify if changed)
    const attestationType = "0x01";
    const sourceType = "0x01"; // WEB2 source type
    // The encoding for submitAttestation depends on the specific FDC version.
    // For the Hackathon scope, we assume the standard submitAttestation(bytes)
    // where bytes = abi.encode(type, sourceType, request)
    const payload = hardhat_1.ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32", "bytes"], [hardhat_1.ethers.zeroPadValue(attestationType, 32), hardhat_1.ethers.zeroPadValue(sourceType, 32), abiEncodedRequest]);
    console.log("Submitting attestation request...");
    // const tx = await fdcHub.requestAttestation(payload, { value: ethers.parseEther("1") }); // 1 FLR fee usually
    // console.log(`Transaction submitted: ${tx.hash}`);
    // await tx.wait();
    console.log("---------------------------------------------------");
    console.log("Mock Submission Complete (Commented out actual transaction for safety).");
    console.log("Request Payload:", payload);
    console.log("To actually submit, ensure you have C2FLR in your account and uncomment the tx lines.");
    console.log("---------------------------------------------------");
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
