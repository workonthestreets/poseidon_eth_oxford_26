import { ethers } from "ethers";

/**
 * FDC Client Utilities
 * Consolidates attestation workflows for Web2Json and AddressValidity
 */

// Coston2 Configuration
export const COSTON2_RPC = "https://coston2-api.flare.network/ext/bc/C/rpc";
export const COSTON2_DA_LAYER_URL = "https://da.c2flr.testfsp.aflabs.org/api/v1/fdc/proof-by-request-round-raw";
export const VERIFIER_URL_TESTNET = "https://fdc-verifiers-testnet.flare.network";

// Contract addresses (via ContractRegistry on Coston2)
export const FDC_HUB_ADDRESS = "0x2cA6571Daa15ce734Bbd0Bf27D5C9D16787fc33f";
export const RELAY_ADDRESS = "0xbA35e39D01A3f5710d1e43FC61dbb738B68641c4";

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
        return { error: true, status: response.status };
    }

    try {
        return await response.json();
    } catch (e) {
        return { error: true, message: "Invalid JSON" };
    }
}

/**
 * Retrieve data and proof from DA Layer (matches Flare example: retrieveDataAndProofBase)
 */
export async function retrieveDataAndProofBase(
    url: string,
    abiEncodedRequest: string,
    roundId: number
): Promise<any> {
    const request = {
        votingRoundId: roundId,
        requestBytes: abiEncodedRequest,
    };

    console.log(`   DA Layer URL: ${url}`);
    console.log(`   Round ID: ${roundId}`);

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
    });

    if (response.status !== 200) {
        const text = await response.text();
        throw new Error(`DA Layer error ${response.status}: ${text}`);
    }

    return await response.json();
}

/**
 * Retrieve data and proof with retry (matches Flare example)
 */
export async function retrieveDataAndProofBaseWithRetry(
    url: string,
    abiEncodedRequest: string,
    roundId: number,
    maxRetries: number = 30,
    retryDelayMs: number = 10000
): Promise<any> {
    console.log(`\n⏳ Waiting for round ${roundId} to finalize...`);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const result = await retrieveDataAndProofBase(url, abiEncodedRequest, roundId);
            if (result && (result.data || result.proof)) {
                console.log("✅ Proof retrieved from DA Layer!");
                return result;
            }
        } catch (e: any) {
            // Expected to fail until round is finalized
            console.log(`   Attempt ${attempt + 1}/${maxRetries}: ${e.message}`);
        }

        await sleep(retryDelayMs);
    }

    throw new Error("Timeout waiting for proof from DA Layer.");
}

/**
 * Wait for round to finalize and retrieve proof
 */
export async function retrieveProof(
    roundId: number,
    abiEncodedRequest: string,
    provider: ethers.Provider
): Promise<any> {
    console.log(`\n⏳ Waiting for round ${roundId} to finalize...`);

    // Fetch RELAY_ADDRESS from Registry
    const registryAbi = ["function getContractAddressByName(string) external view returns (address)"];
    const registry = new ethers.Contract(CONTRACT_REGISTRY_ADDRESS, registryAbi, provider);
    const relayAddress = await registry.getContractAddressByName("Relay");

    const relayAbi = ["function isFinalized(uint256 _protocolId, uint256 _votingRoundId) external view returns (bool)"];
    const relay = new ethers.Contract(relayAddress, relayAbi, provider);

    // Check every 10 seconds if round is finalized OR if proof is available directly
    // Hackathon Fix: The Relay might be stuck, so we poll the new DA Layer URL concurrently.

    const startTime = Date.now();
    const TIMEOUT = 300 * 1000; // 5 minutes

    const request = {
        votingRoundId: roundId,
        requestBytes: abiEncodedRequest,
    };

    while (Date.now() - startTime < TIMEOUT) {
        // 1. Check Relay (On-Chain)
        let isFinalized = false;
        try {
            isFinalized = await relay.isFinalized(1, roundId);
        } catch (e) {
            // Ignore relay errors
        }

        if (isFinalized) {
            console.log("✅ Relay says: Round finalized!");
        }

        // 2. Check DA Layer (Off-Chain API) - EVEN IF relay says no
        // logic: if relay says yes, we fetch. If relay says no, we try anyway (in case relay is broken).

        try {
            const proof = await postRequestToDALayer(COSTON2_DA_LAYER_URL, request, false);
            if (proof && proof.data) {
                console.log("✅ Proof found on DA Layer!");
                return proof;
            }
        } catch (e) {
            // Ignore DA layer 404/errors until found
        }

        if (isFinalized) {
            // If finalized but DA layer didn't return data above, we might need to wait slightly or retry
            // But usually DA layer has data before relay confirms.
            // If we are here, it means relay says yes but DA layer failed.
            // We continue loop to retry DA fetch.
            console.log("   (Relay confirmed, waiting for DA Layer data...)");
        } else {
            console.log(`   Waiting for round ${roundId}...`);
        }

        await sleep(10000);
    }

    throw new Error("Timeout waiting for proof.");
}

/**
 * Convert string to UTF-8 hex, padded to 32 bytes (required by Verifier API)
 */
export function toUtf8HexString(str: string): string {
    const hex = Buffer.from(str, "utf8").toString("hex");
    return "0x" + hex.padEnd(64, "0"); // Pad to 64 hex chars = 32 bytes
}

/**
 * Prepare Web2Json attestation request via Verifier Server API
 * This is the recommended approach from Flare documentation
 */
export async function prepareWeb2JsonRequest(
    apiUrl: string,
    postProcessJq: string,
    abiSignature: string
): Promise<any> {
    const VERIFIER_API_KEY = process.env.VERIFIER_API_KEY_TESTNET || "";

    // Web2Json specific verifier endpoint (matching Flare example exactly)
    const verifierUrl = `${VERIFIER_URL_TESTNET}/verifier/web2/Web2Json/prepareRequest`;

    const attestationType = toUtf8HexString("Web2Json");
    const sourceId = toUtf8HexString("PublicWeb2"); // Supported source ID for Web2Json

    // Request body structure per Flare FDC spec
    const requestBody = {
        url: apiUrl,
        httpMethod: "GET",
        headers: "{}",
        queryParams: "{}",
        body: "{}",
        postProcessJq: postProcessJq,
        abiSignature: abiSignature
    };

    const prepareRequest = {
        attestationType: attestationType,
        sourceId: sourceId,
        requestBody: requestBody
    };

    console.log("📡 Calling Verifier Server API...");
    console.log(`   URL: ${verifierUrl}`);

    const response = await fetch(verifierUrl, {
        method: "POST",
        headers: {
            "X-API-KEY": VERIFIER_API_KEY,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(prepareRequest)
    });

    if (response.status !== 200) {
        const errorText = await response.text();
        throw new Error(`Verifier API error: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const result: any = await response.json();
    console.log("✅ Verifier prepared request successfully\n");
    // Debugging:
    // console.log("   Verifier Response Status:", result.status);
    // console.log("   Verifier Response Keys:", Object.keys(result));
    // if (result.data) console.log("   Verifier Response Data (partial):", JSON.stringify(result.data).substring(0, 200) + "...");

    // Check if result.abiEncodedRequest exists
    if (!result.abiEncodedRequest) {
        console.warn("⚠️  WARNING: abiEncodedRequest MISSING in Verifier response!");
    }

    // The verifier returns { abiEncodedRequest: "0x..." } 
    // which is ready to submit to FdcHub
    return {
        abiEncodedRequest: result.abiEncodedRequest,
        attestationType,
        sourceId,
        requestBodyStruct: requestBody
    };
}

/**
 * Prepare manual AddressValidity request (for testing pipeline availability)
 */
export function prepareAddressValidityRequest(addressStr: string): string {
    const attestationType = "0x4164647265737356616c69646974790000000000000000000000000000000000"; // AddressValidity
    const sourceId = "0x7465737442544300000000000000000000000000000000000000000000000000";      // testBTC

    // Request Body: (string addressStr)
    const requestBody = ethers.AbiCoder.defaultAbiCoder().encode(["string"], [addressStr]);

    const abiEncodedRequest = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "bytes32", "bytes"],
        [attestationType, sourceId, requestBody]
    );

    return abiEncodedRequest;
}


/**
 * Submit attestation request to FDC Hub
 */
export const CONTRACT_REGISTRY_ADDRESS = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";

/**
 * Submit attestation request to FDC Hub
 */
export async function submitAttestationRequest(
    abiEncodedRequest: string,
    signer: ethers.Signer
): Promise<number> {
    const provider = signer.provider;
    if (!provider) throw new Error("Signer has no provider");

    // Validate input due to previous "undefined" errors
    if (!abiEncodedRequest || abiEncodedRequest === "0x") {
        throw new Error("Invalid abiEncodedRequest: cannot be empty or 0x");
    }

    // 1. Get FdcRequestFeeConfigurations address from Registry
    const registryAbi = ["function getContractAddressByName(string) external view returns (address)"];
    const registry = new ethers.Contract(CONTRACT_REGISTRY_ADDRESS, registryAbi, provider);
    const feeConfigAddress = await registry.getContractAddressByName("FdcRequestFeeConfigurations");

    // 2. Get Request Fee (Using correct ABI from working code)
    const feeConfigAbi = ["function getRequestFee(bytes calldata _data) external view returns (uint256)"];
    const feeConfig = new ethers.Contract(feeConfigAddress, feeConfigAbi, provider);

    // Use getRequestFee with the full encoded data
    let fee = ethers.parseEther("1.0"); // Fallback
    try {
        fee = await feeConfig.getRequestFee(abiEncodedRequest);
        console.log(`💰 FDC Fee (Dynamic): ${ethers.formatEther(fee)} C2FLR`);

        // Fee might be "1 wei" on testnet, but sending more is safer
        if (fee <= BigInt(1000)) {
            console.log("   (Fee seems extremely low, defaulting to 1.0 C2FLR to be safe)");
            fee = ethers.parseEther("1.0");
        }
    } catch (e) {
        console.warn("⚠️  FeeConfig lookup failed. Using FALLBACK Fee: 10.0 C2FLR");
        fee = ethers.parseEther("10.0");
    }

    // 3. Submit Request
    const fdcHubAddress = await registry.getContractAddressByName("FdcHub");
    if (!fdcHubAddress || fdcHubAddress === ethers.ZeroAddress) {
        throw new Error("FdcHub address not found in registry");
    }
    console.log(`   FDC Hub: ${fdcHubAddress}`);

    const fdcHubAbi = [
        "function requestAttestation(bytes calldata _data) external payable returns (bool)"
    ];

    const fdcHub = new ethers.Contract(fdcHubAddress, fdcHubAbi, signer);

    console.log("📤 Submitting attestation request to FDC Hub...");
    console.log(`   Bytes: ${abiEncodedRequest.length} chars`);

    try {
        // Robust pattern: populate -> send
        // This avoids issues where the contract object method resolution fails
        const txData = await fdcHub.requestAttestation.populateTransaction(abiEncodedRequest);
        txData.value = fee;

        const tx = await signer.sendTransaction(txData);
        if (!tx) throw new Error("Transaction object is undefined after sendTransaction");

        console.log(`   Tx: ${tx.hash}`);

        const receipt = await tx.wait();
        if (!receipt) {
            throw new Error("Transaction receipt is undefined");
        }
        console.log("✅ Request submitted!\n");

        // Calculate round ID from block timestamp
        const block = await provider.getBlock(receipt.blockNumber);
        if (!block) {
            throw new Error("Block not found");
        }
        const roundId = calculateRoundId(block.timestamp);

        console.log(`📊 Round ID: ${roundId}`);
        return roundId;
    } catch (txError: any) {
        console.error("   Detailed Submission Error:", txError);
        throw new Error(`FDC Hub submission failed: ${txError.message}`);
    }
}
