/**
 * Unified Deploy Script — Oracle + Vault + Auction + PredictionMarket
 * 
 * Deploys all contracts, wires permissions, and loads vessel data on-chain.
 * 
 * Usage:
 *   Local:    npx hardhat run onchain/scripts/deployAll.cjs
 *   Coston2:  npx hardhat run onchain/scripts/deployAll.cjs --network coston2
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function loadRiskData(imo) {
    const filePath = path.join(process.cwd(), "offchain", "data", "risk_data", `${imo}.json`);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

function parseNavStatus(data) {
    let status = data.raw?.voyage?.data?.navigation_status || data.voyage?.navigation_status || "Unknown";
    const map = {
        "Unknown": 0, "Moored": 1, "At Anchor": 2, "Under Way": 3, "Aground": 4,
        "Under way using engine": 3, "Under way sailing": 3, "At anchor": 2,
    };
    return map[status] ?? 0;
}

function scaledCoord(val) { return Math.round((val || 0) * 1e6); }

function divider(title) {
    console.log("\n" + "═".repeat(70));
    console.log(`  ${title}`);
    console.log("═".repeat(70) + "\n");
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
    divider("🚢 Deploy All — Oracle + Vault + Auction");

    const [deployer] = await hre.ethers.getSigners();
    const network = await hre.ethers.provider.getNetwork();
    const balance = await hre.ethers.provider.getBalance(deployer.address);

    console.log("  Network:", hre.network.name, `(Chain ID: ${network.chainId})`);
    console.log("  Deployer:", deployer.address);
    console.log("  Balance:", hre.ethers.formatEther(balance), hre.network.name === "coston2" ? "C2FLR" : "ETH");

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 1: Deploy Contracts
    // ══════════════════════════════════════════════════════════════════════════
    divider("STEP 1: Deploy Contracts");

    // 1a. MaritimeRiskOracle
    console.log("  📦 Deploying MaritimeRiskOracle...");
    const Oracle = await hre.ethers.getContractFactory("MaritimeRiskOracle");
    const oracle = await Oracle.deploy();
    await oracle.waitForDeployment();
    const oracleAddr = await oracle.getAddress();
    console.log("     ✅ Oracle:", oracleAddr);

    // 1b. MaritimeRFQVault
    console.log("  📦 Deploying MaritimeRFQVault...");
    const Vault = await hre.ethers.getContractFactory("MaritimeRFQVault");
    const vault = await Vault.deploy();
    await vault.waitForDeployment();
    const vaultAddr = await vault.getAddress();
    console.log("     ✅ Vault:", vaultAddr);

    // 1c. VoyageAuction
    console.log("  📦 Deploying VoyageAuction...");
    const Auction = await hre.ethers.getContractFactory("VoyageAuction");
    const auction = await Auction.deploy(oracleAddr, vaultAddr);
    await auction.waitForDeployment();
    const auctionAddr = await auction.getAddress();
    console.log("     ✅ Auction:", auctionAddr);

    // 1d. MaritimePredictionMarket
    console.log("  📦 Deploying MaritimePredictionMarket...");
    const Market = await hre.ethers.getContractFactory("MaritimePredictionMarket");
    const market = await Market.deploy(oracleAddr);
    await market.waitForDeployment();
    const marketAddr = await market.getAddress();
    console.log("     ✅ PredictionMarket:", marketAddr);

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 2: Wire Permissions
    // ══════════════════════════════════════════════════════════════════════════
    divider("STEP 2: Wire Permissions");

    // Vault: authorize auction to deduct/credit balances
    let tx = await vault.setAuthorizedAuction(auctionAddr, true);
    await tx.wait();
    console.log("  ✅ Vault → VoyageAuction authorized for deduct/credit");

    // Oracle: deployer is already authorized (constructor), add market contract
    tx = await oracle.setAuthorizedSubmitter(marketAddr, true);
    await tx.wait();
    console.log("  ✅ Oracle → PredictionMarket authorized as submitter");

    tx = await oracle.setAuthorizedSubmitter(auctionAddr, true);
    await tx.wait();
    console.log("  ✅ Oracle → VoyageAuction authorized as submitter");

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 3: Load Vessel Data On-Chain
    // ══════════════════════════════════════════════════════════════════════════
    divider("STEP 3: Load Vessel Data On-Chain");

    const riskDataDir = path.join(process.cwd(), "offchain", "data", "risk_data");
    const files = fs.existsSync(riskDataDir) 
        ? fs.readdirSync(riskDataDir).filter(f => f.endsWith(".json"))
        : [];

    if (files.length === 0) {
        console.log("  ⚠️  No risk_data/*.json files found. Run fetchVesselRiskProfile.ts first.");
    } else {
        console.log(`  Found ${files.length} vessel risk profiles\n`);

        for (const file of files) {
            const imo = file.replace(".json", "");
            const data = loadRiskData(imo);
            if (!data) continue;

            const navStatus = parseNavStatus(data);
            const navLabels = ["Unknown", "Moored", "AtAnchor", "UnderWay", "Aground"];

            // Submit full vessel profile
            tx = await oracle.submitFullVesselProfile(
                imo, data.meta?.name || "",
                scaledCoord(data.voyage?.current_lat || data.raw?.voyage?.data?.lat),
                scaledCoord(data.voyage?.current_lon || data.raw?.voyage?.data?.lon),
                navStatus,
                data.voyage?.destination || data.raw?.voyage?.data?.destination || "",
                data.psc?.detention_count > 0 || data.psc?.detention === "1",
                data.psc?.deficiency_count || 0,
                data.psc?.inspection_port || "",
                data.psc?.inspection_date || "",
                data.psc?.inspection_authority || "",
                data.casualty?.casualty_detected || false,
                data.casualty?.casualty_type || "",
                data.casualty?.casualty_date || "",
                data.casualty?.casualty_details || "",
                data.drydock?.next_due_date || "",
                data.drydock?.is_overdue || false
            );
            await tx.wait();

            // Submit voyage data
            const rawVoyage = data.raw?.voyage?.data;
            const atdEpoch = rawVoyage?.atd_epoch || 0;
            const etaEpoch = rawVoyage?.eta_epoch || 0;
            const effectiveAtd = (navStatus === 1) ? 0 : atdEpoch;

            tx = await oracle.submitVoyageData(
                imo,
                rawVoyage?.dep_port_unlocode || "",
                data.voyage?.destination || rawVoyage?.destination || "",
                effectiveAtd,
                etaEpoch,
                0
            );
            await tx.wait();

            const statusLabel = navLabels[navStatus] || "Unknown";
            console.log(`  ✅ ${data.meta?.name || imo} (${imo}) — ${statusLabel}`);
        }
    }

    const vesselCount = await oracle.getKnownIMOCount();
    console.log(`\n  Total vessels on-chain: ${vesselCount}`);

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 4: Save Deployment Info
    // ══════════════════════════════════════════════════════════════════════════
    divider("STEP 4: Deployment Summary");

    const deploymentInfo = {
        network: hre.network.name,
        chainId: Number(network.chainId),
        deployer: deployer.address,
        timestamp: new Date().toISOString(),
        contracts: {
            MaritimeRiskOracle: oracleAddr,
            MaritimeRFQVault: vaultAddr,
            VoyageAuction: auctionAddr,
            MaritimePredictionMarket: marketAddr,
        },
        vesselCount: Number(vesselCount),
    };

    // Save to deployments/
    const deploymentsDir = path.join(process.cwd(), "deployments");
    if (!fs.existsSync(deploymentsDir)) {
        fs.mkdirSync(deploymentsDir, { recursive: true });
    }
    const filename = `${hre.network.name}-${Date.now()}.json`;
    fs.writeFileSync(
        path.join(deploymentsDir, filename),
        JSON.stringify(deploymentInfo, null, 2)
    );

    console.log("  Contract Addresses:");
    console.log(`    MaritimeRiskOracle:       ${oracleAddr}`);
    console.log(`    MaritimeRFQVault:         ${vaultAddr}`);
    console.log(`    VoyageAuction:            ${auctionAddr}`);
    console.log(`    MaritimePredictionMarket: ${marketAddr}`);
    console.log(`    Vessels on-chain:         ${vesselCount}`);

    if (hre.network.name === "coston2") {
        console.log("\n  Explorer Links:");
        console.log(`    Oracle:     https://coston2-explorer.flare.network/address/${oracleAddr}`);
        console.log(`    Vault:      https://coston2-explorer.flare.network/address/${vaultAddr}`);
        console.log(`    Auction:    https://coston2-explorer.flare.network/address/${auctionAddr}`);
        console.log(`    Market:     https://coston2-explorer.flare.network/address/${marketAddr}`);
    }

    console.log(`\n  💾 Deployment saved to: deployments/${filename}`);

    console.log("\n  📝 Add to .env:");
    console.log(`    ORACLE_ADDRESS=${oracleAddr}`);
    console.log(`    VAULT_ADDRESS=${vaultAddr}`);
    console.log(`    AUCTION_ADDRESS=${auctionAddr}`);
    console.log(`    MARKET_ADDRESS=${marketAddr}`);

    console.log("\n" + "═".repeat(70));
    console.log("  ✅ All contracts deployed, wired, and data loaded!");
    console.log("═".repeat(70) + "\n");

    return deploymentInfo;
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("\n❌ Deployment failed:", error);
        process.exit(1);
    });

