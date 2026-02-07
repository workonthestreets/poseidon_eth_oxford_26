import { ethers } from "ethers";

/**
 * Base utilities for FDC attestation workflow
 */

// Coston2 Configuration
export const COSTON2_RPC = "https://coston2-api.flare.network/ext/bc/C/rpc";
export const COSTON2_DA_LAYER_URL = "https://coston2-data-availability.flare.rocks/";
export const VERIFIER_URL = "https://fdc-verifiers-testnet.flare.network/verifier/web2/";

// Contract addresses (via ContractRegistry)
export const FDC_HUB_ADDRESS = "0x2cA6571Daa15ce734Bbd0Bf27D5C9D16787fc33f"; // Coston2
export const RELAY_ADDRESS = "0xbA35e39D01A3f5710d1e43FC61dbb738B68641c4"; // Coston2

/**
 * Sleep utility for waiting between operations
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Convert string to hex (UTF-8 encoding, padded to 32 bytes)
 */
export function toUtf8Hex32(str: string): string {
  const hex = Buffer.from(str, 'utf8').toString('hex');
  return '0x' + hex.padEnd(64, '0');
}

/**
 * Get Relay contract for checking round finalization
 */
export async function getRelay(provider: ethers.Provider) {
  const relayAbi = [
    "function isFinalized(uint256 _protocolId, uint256 _votingRoundId) external view returns (bool)"
  ];
  return new ethers.Contract(RELAY_ADDRESS, relayAbi, provider);
}

/**
 * Calculate round ID from block timestamp
 */
export function calculateRoundId(blockTimestamp: number): number {
  const FIRST_VOTING_ROUND_START_TS = 1658429955; // Coston2 specific
  const VOTING_EPOCH_DURATION_SECONDS = 90;
  return Math.floor((blockTimestamp - FIRST_VOTING_ROUND_START_TS) / VOTING_EPOCH_DURATION_SECONDS);
}

/**
 * Post request to DA Layer
 */
export async function postRequestToDALayer(
  url: string,
  request: any,
  watchStatus: boolean = false
): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (watchStatus && response.status !== 200) {
    throw new Error(
      `DA Layer error: ${response.status} ${response.statusText}`
    );
  }

  return await response.json();
}

/**
 * Wait for round to finalize and retrieve proof
 */
export async function retrieveDataAndProofBase(
  url: string,
  abiEncodedRequest: string,
  roundId: number,
  provider: ethers.Provider
): Promise<any> {
  console.log("\n⏳ Waiting for round to finalize...");
  
  const relay = await getRelay(provider);
  
  // Check every 10 seconds if round is finalized
  while (!(await relay.isFinalized(200, roundId))) {
    console.log(`   Round ${roundId} not finalized yet, waiting 10s...`);
    await sleep(10000);
  }
  
  console.log("✅ Round finalized!\n");

  const request = {
    votingRoundId: roundId,
    requestBytes: abiEncodedRequest,
  };

  console.log("📡 Requesting proof from DA Layer...");
  await sleep(10000); // Give DA Layer time to process

  let proof = await postRequestToDALayer(url, request, true);
  
  console.log("⏳ Waiting for DA Layer to generate proof...");
  while (!proof.response_hex) {
    await sleep(5000);
    proof = await postRequestToDALayer(url, request, false);
  }
  
  console.log("✅ Proof generated!\n");
  return proof;
}

/**
 * Prepare attestation request via Verifier API
 */
export async function prepareAttestationRequest(
  apiUrl: string,
  postProcessJq: string,
  abiSignature: string
): Promise<any> {
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
    attestationType: toUtf8Hex32("Web2Json"),
    sourceId: toUtf8Hex32("PublicWeb2"),
    requestBody: requestBody,
  };

  console.log("📝 Preparing attestation request via Verifier...");
  
  const response = await fetch(`${VERIFIER_URL}Web2Json/prepareRequest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Verifier error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  console.log("✅ Request prepared\n");
  
  return data;
}

/**
 * Submit attestation request to FDC Hub
 */
export async function submitAttestationRequest(
  abiEncodedRequest: string,
  signer: ethers.Signer
): Promise<number> {
  const fdcHubAbi = [
    "function requestAttestation(bytes calldata _data) external payable returns (bool)"
  ];
  
  const fdcHub = new ethers.Contract(FDC_HUB_ADDRESS, fdcHubAbi, signer);
  
  // Fee is typically 0.001 C2FLR
  const fee = ethers.parseEther("0.001");

  console.log("📤 Submitting attestation request to FDC Hub...");
  console.log(`   Fee: ${ethers.formatEther(fee)} C2FLR`);
  
  const tx = await fdcHub.requestAttestation(abiEncodedRequest, { value: fee });
  console.log(`   Tx: ${tx.hash}`);
  
  const receipt = await tx.wait();
  console.log("✅ Request submitted!\n");
  
  // Calculate round ID from block timestamp
  const block = await signer.provider!.getBlock(receipt!.blockNumber);
  const roundId = calculateRoundId(block!.timestamp);
  
  console.log(`📊 Round ID: ${roundId}`);
  console.log(`🔍 Track on Explorer: https://coston2-systems-explorer.flare.rocks/voting-epoch/${roundId}?tab=fdc\n`);
  
  return roundId;
}
