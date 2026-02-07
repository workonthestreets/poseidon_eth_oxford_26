import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as fs from "fs";

dotenv.config();

// FDC Constants (Coston2)
const FLARE_CONTRACT_REGISTRY_ADDRESS = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const COSTON2_DA_LAYER_URL = "https://ctn2-data-availability.flare.network/api/v1/fdc/proof-by-request-round-raw";

// User Configuration
const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || "http://localhost:3000"; // Fallback to localhost if not set (will warn)

// ABIs
const IContractRegistry = [
    "function getContractAddressByName(string calldata _name) external view returns (address)"
];

const IFdcHub = [
    "function requestAttestation(bytes calldata _data) external payable",
    "event AttestationRequest(bytes data, uint256 fee)"
];

const IRelay = [
    "function isFinalized(uint8 _protocolId, uint256 _votingRoundId) external view returns (bool)"
];

const IFlareSystemsManager = [
    "function firstVotingRoundStartTs() external view returns (uint256)",
    "function votingEpochDurationSeconds() external view returns (uint256)",
    "function getCurrentVotingEpochId() external view returns (uint256)"
];

const IFdcRequestFeeConfigurations = [
    "function getRequestFee(bytes calldata _data) external view returns (uint256)"
];

// Web2Json Request Body Struct ABI (Derived from contract artifacts)
// struct RequestBody { string url; string httpMethod; string body; string postProcessJq; string abiSignature; }
// Note: Some artifacts show extra fields like 'headers', 'queryParams'. We follow the artifact inspection result:
// [url, httpMethod, headers, queryParams, body, postProcessJq, abiSignature]
const WEB2JSON_REQUEST_ABI = [
    "string", // url
    "string", // httpMethod
    "string", // headers (JSON string)
    "string", // queryParams (JSON string)
    "string", // body (JSON string)
    "string", // postProcessJq
    "string"  // abiSignature
];

const DISCOVERY_FILE = "discovered_vessels.json";
const PORT_LAT = "51.90";
const PORT_LON = "4.50";

async function main() {
    if (!process.env.PUBLIC_APP_URL) {
        console.warn("⚠️  WARNING: PUBLIC_APP_URL not set in .env.");
        console.warn("   FDC Verifiers need a reachabale URL. Using 'ngrok' is recommended.");
        console.warn("   Proceeding with localhost (Verification will likely fail)...");
    }

    const args = process.argv.slice(2);
    const mode = args[0];

    if (mode === '--discover') {
        await runDiscovery();
    } else if (mode === '--process-discovery') {
        await runBatchProcessing();
    } else {
        const imo = (mode && /^\d{7}$/.test(mode)) ? mode : "9703318";
        await runRiskAnalysis(imo);
    }
}

async function runDiscovery() {
    console.log("🔍 Running Vessel Discovery (Port: Rotterdam) [Limit: 5]...");
    const proxyUrl = `http://localhost:3000/api/proxy/discovery/port?lat=${PORT_LAT}&lon=${PORT_LON}&limit=5`;
    try {
        const response = await fetch(proxyUrl);
        const data: any = await response.json();
        console.log(`\nFound ${data.meta.count} vessels in ${data.meta.location}`);
        fs.writeFileSync(DISCOVERY_FILE, JSON.stringify(data.candidates, null, 2));
        console.log(`✅ Discovery data saved to '${DISCOVERY_FILE}'`);
    } catch (e) { console.error("Discovery Failed:", e); }
}

async function runBatchProcessing() {
    if (!fs.existsSync(DISCOVERY_FILE)) {
        console.error(`❌ Discovery file '${DISCOVERY_FILE}' not found. Run --discover first.`);
        return;
    }

    const args = process.argv.slice(2);
    const limit = (args.indexOf('--limit') > -1) ? parseInt(args[args.indexOf('--limit') + 1]) : 0;
    let vessels = JSON.parse(fs.readFileSync(DISCOVERY_FILE, 'utf8'));
    if (limit > 0) vessels = vessels.slice(0, limit);

    console.log(`\n🚀 Processing ${vessels.length} vessels for FDC Attestation...`);

    const provider = new ethers.JsonRpcProvider("https://coston2-api.flare.network/ext/bc/C/rpc");
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) throw new Error("PRIVATE_KEY not found in .env");
    const wallet = new ethers.Wallet(privateKey, provider);

    const registry = new ethers.Contract(FLARE_CONTRACT_REGISTRY_ADDRESS, IContractRegistry, wallet);
    const fdcHubAddress = await registry.getContractAddressByName("FdcHub");
    const relayAddress = await registry.getContractAddressByName("Relay");
    const systemsManagerAddress = await registry.getContractAddressByName("FlareSystemsManager");
    const feeConfigAddress = await registry.getContractAddressByName("FdcRequestFeeConfigurations");

    const fdcHub = new ethers.Contract(fdcHubAddress, IFdcHub, wallet);
    const relay = new ethers.Contract(relayAddress, IRelay, provider);
    const systemsManager = new ethers.Contract(systemsManagerAddress, IFlareSystemsManager, provider);
    const feeConfig = new ethers.Contract(feeConfigAddress, IFdcRequestFeeConfigurations, provider);

    for (const v of vessels) {
        console.log(`\n➡️  Processing IMO: ${v.imo} (${v.name})`);

        // --- PREPARE REAL REQUEST (Demo) ---
        // We construct the full Web2Json request to demonstrate readiness for governance-approved source IDs.
        const targetUrl = `${PUBLIC_APP_URL}/api/proxy/risk/psc/${v.imo}`;
        console.log(`   🌍 Data Source: ${targetUrl}`);

        // Attestation Type: "Web2Json"
        // Source ID: "WEB2"
        const web2Request = [
            targetUrl, "GET", "{}", "{}", "", ".", ""
        ];
        // We log this to show we CAN generate it, but we can't submit it without whitelist.

        console.log("   🛠️  Web2Json Request Prepared (Awaiting Governance Whitelist)");

        // --- SUBMIT COMPATIBLE REQUEST (Pipeline Verification) ---
        // To verify the On-Chain FDC Pipeline works (Request -> Vote -> Proof),
        // we use the open 'AddressValidity' type on 'testBTC'.
        console.log("   🔄 Submitting 'AddressValidity' check to verify FDC Pipeline availability...");

        const attestationType = "0x4164647265737356616c69646974790000000000000000000000000000000000"; // AddressValidity
        const sourceId = "0x7465737442544300000000000000000000000000000000000000000000000000";      // testBTC

        // Request Body: (string addressStr)
        const requestBody = ethers.AbiCoder.defaultAbiCoder().encode(["string"], ["tb1q02575239523235323953253253272957295239"]);

        const abiEncodedRequest = ethers.AbiCoder.defaultAbiCoder().encode(
            ["bytes32", "bytes32", "bytes"],
            [attestationType, sourceId, requestBody]
        );

        // 2. Submit Request
        console.log("   📤 Submitting Attestation Request to FDC Hub...");
        try {
            const fee = await feeConfig.getRequestFee(abiEncodedRequest);
            const tx = await fdcHub.requestAttestation(abiEncodedRequest, { value: fee });
            console.log(`      Tx Hash: ${tx.hash}`);
            const receipt = await tx.wait();

            // 3. Round ID
            const block = await provider.getBlock(receipt.blockNumber);
            const blockTs = BigInt(block!.timestamp);
            const startTs = await systemsManager.firstVotingRoundStartTs();
            const duration = await systemsManager.votingEpochDurationSeconds();
            const roundId = Number((blockTs - startTs) / duration);
            console.log(`      Voting Round ID: ${roundId}`);

            // 4. Finalization
            console.log("   ⏳ Waiting for Round Finalization...");
            try {
                while (!(await relay.isFinalized(1, roundId))) {
                    await new Promise(r => setTimeout(r, 180000));
                }
                console.log("      ✅ Round Finalized!");
            } catch (e) {
                console.warn("      ⚠️ Finalization check skipped. Waiting 90s for round consensus...");
                await new Promise(r => setTimeout(r, 180000)); // Hard wait for Coston2 round
            }

            // 5. Get Proof
            console.log("   🔍 Retrieving Proof from DA Layer...");
            const proofReq = { votingRoundId: roundId, requestBytes: abiEncodedRequest };
            const proofRes = await fetch(COSTON2_DA_LAYER_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(proofReq)
            });
            const proof: any = await proofRes.json();

            if (proof && proof.data) {
                console.log("      🎉 Proof Retrieved Successfully!");
                if (!fs.existsSync("proofs")) fs.mkdirSync("proofs");
                fs.writeFileSync(`proofs/proof_${v.imo}_${roundId}.json`, JSON.stringify(proof, null, 2));
                console.log(`      Saved to proofs/proof_${v.imo}_${roundId}.json`);
            } else {
                console.error("      ⚠️ Proof not found (Consensus might have rejected invalid data/URL).");
            }

        } catch (e: any) {
            console.error("      ❌ On-Chain Submission Failed:", e.message);
        }
    }
}
async function fetchRiskData(imo: string) {
    try {
        const pscRes = await fetch(`http://localhost:3000/api/proxy/risk/psc/${imo}`);
        const pscData: any = await pscRes.json();
        return {
            detention: pscData.detention,
            detention_count: pscData.detention_count || 0,
            risk_detected: pscData.risk_detected
        };
    } catch (e) {
        return null;
    }
}

async function runRiskAnalysis(imo: string) {
    console.log(`\n📊 Analyzing Risks for Vessel IMO: ${imo}`);
    const riskTypes = ['psc', 'casualty', 'drydock', 'voyage'];
    for (const type of riskTypes) {
        let url = `http://localhost:3000/api/proxy/risk/${type}/${imo}`;
        if (type === 'voyage') url += `?lat=${PORT_LAT}&lon=${PORT_LON}&radius=50`;
        try {
            const res = await fetch(url);
            const data: any = await res.json();
            console.log(`[${type.toUpperCase()}] Data:`, JSON.stringify(data, null, 2));
        } catch (e) { console.error(e); }
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
