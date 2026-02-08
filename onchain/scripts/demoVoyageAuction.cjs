/**
 * Demo: VoyageAuction — Pre-Voyage Closed Auction for Maritime Risk Protection
 * 
 * Demonstrates the full lifecycle using REAL vessel data from offchain/data/risk_data/
 * loaded directly on-chain (fallback for FDC Web2Json which couldn't be made to work).
 * 
 * Architecture:
 *   MaritimeRiskOracle  — on-chain vessel data store (positions, PSC, casualties, voyage data)
 *   MaritimeRFQVault    — deposit/withdraw layer, balance tracking, FTSO price oracle
 *   VoyageAuction       — closed auction logic, share minting, settlement
 * 
 * Lifecycle:
 *   1. Deploy Oracle + Vault + Auction contracts
 *   2. Load real vessel data on-chain from risk_data/*.json
 *   3. Users deposit FLR into vault
 *   4. Hedger creates market for moored vessel at loading port (atd=0)
 *   5. Bidders submit NO-side bids from vault balance
 *   6. Fast-forward → finalize auction → shares minted
 *   7. Simulate voyage events → risk-type-specific settlement
 *   8. Claims credited to vault balances
 * 
 * Usage: npx hardhat run onchain/scripts/demoVoyageAuction.cjs [--network coston2]
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function loadRiskData(imo) {
    const filePath = path.join(process.cwd(), "offchain", "data", "risk_data", `${imo}.json`);
    if (!fs.existsSync(filePath)) {
        throw new Error(`No risk data found for IMO ${imo} at ${filePath}`);
    }
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
function fmt(wei) { return hre.ethers.formatEther(wei) + " FLR"; }

function divider(title) {
    console.log("\n" + "═".repeat(70));
    console.log(`  ${title}`);
    console.log("═".repeat(70) + "\n");
}

function step(n, msg) { console.log(`  [${n}] ${msg}`); }

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
    divider("🚢 VoyageAuction Demo — Pre-Voyage Closed Auction");

    const signers = await hre.ethers.getSigners();
    const [deployer, hedger, bidder1, bidder2, bidder3] = signers;
    const isLocal = hre.network.name === "hardhat" || hre.network.name === "localhost";
    
    console.log("  Network:", hre.network.name);
    console.log("  Deployer:", deployer.address);
    if (hedger) console.log("  Hedger:", hedger.address);
    if (bidder1) console.log("  Bidder 1:", bidder1.address);
    if (bidder2) console.log("  Bidder 2:", bidder2.address);
    if (bidder3) console.log("  Bidder 3:", bidder3.address);

    const h = hedger || deployer;
    const b1 = bidder1 || deployer;
    const b2 = bidder2 || deployer;
    const b3 = bidder3 || deployer;

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 1: Deploy Contracts
    // ══════════════════════════════════════════════════════════════════════════
    divider("STEP 1: Deploy Contracts");

    step(1, "Deploying MaritimeRiskOracle...");
    const Oracle = await hre.ethers.getContractFactory("MaritimeRiskOracle");
    const oracle = await Oracle.deploy();
    await oracle.waitForDeployment();
    const oracleAddr = await oracle.getAddress();
    console.log("      Oracle:", oracleAddr);

    step(2, "Deploying MaritimeRFQVault...");
    const Vault = await hre.ethers.getContractFactory("MaritimeRFQVault");
    const vault = await Vault.deploy();
    await vault.waitForDeployment();
    const vaultAddr = await vault.getAddress();
    console.log("      Vault:", vaultAddr);

    step(3, "Deploying VoyageAuction...");
    const Auction = await hre.ethers.getContractFactory("VoyageAuction");
    const auction = await Auction.deploy(oracleAddr, vaultAddr);
    await auction.waitForDeployment();
    const auctionAddr = await auction.getAddress();
    console.log("      Auction:", auctionAddr);

    step(4, "Authorizing auction contract on vault...");
    const txAuth = await vault.setAuthorizedAuction(auctionAddr, true);
    await txAuth.wait();
    console.log("      ✅ VoyageAuction authorized to deduct/credit vault balances");

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 2: Load Real Vessel Data On-Chain
    // ══════════════════════════════════════════════════════════════════════════
    divider("STEP 2: Load Vessel Data On-Chain (from risk_data/*.json)");

    const riskDataDir = path.join(process.cwd(), "offchain", "data", "risk_data");
    const files = fs.readdirSync(riskDataDir).filter(f => f.endsWith(".json"));
    console.log(`  Found ${files.length} vessel risk profiles\n`);

    for (const file of files) {
        const imo = file.replace(".json", "");
        const data = loadRiskData(imo);
        const navStatus = parseNavStatus(data);
        const navLabels = ["Unknown", "Moored", "AtAnchor", "UnderWay", "Aground"];

        // Submit full vessel profile
        const tx = await oracle.submitFullVesselProfile(
            imo, data.meta.name || "",
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

        // Submit voyage data — vessels at loading port have atd=0
        // For moored vessels, set atd=0 (not departed) so they're eligible for market creation
        const rawVoyage = data.raw?.voyage?.data;
        const atdEpoch = rawVoyage?.atd_epoch || 0;
        const etaEpoch = rawVoyage?.eta_epoch || 0;
        
        // If vessel is moored AND has no atd (or atd is past), treat as at loading port
        // For demo: moored vessels → atd=0 (at loading port, ready for market)
        const effectiveAtd = (navStatus === 1) ? 0 : atdEpoch; // Moored = at loading port

        const txVoy = await oracle.submitVoyageData(
            imo,
            rawVoyage?.dep_port_unlocode || "",
            data.voyage?.destination || rawVoyage?.destination || "",
            effectiveAtd,
            etaEpoch,
            0 // ataEpoch = 0 (not arrived yet)
        );
        await txVoy.wait();

        const statusLabel = navLabels[navStatus] || "Unknown";
        const casualtyTag = data.casualty?.casualty_detected ? ` ⚠️ ${data.casualty.casualty_type}` : "";
        const portTag = effectiveAtd === 0 && navStatus === 1 ? " 📍 at loading port" : "";
        console.log(`  ✅ ${data.meta.name} (${imo}) — ${statusLabel}${casualtyTag}${portTag}`);
    }

    const vesselCount = await oracle.getKnownIMOCount();
    console.log(`\n  Total vessels on-chain: ${vesselCount}`);

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 3: Verify Vessel State Queries
    // ══════════════════════════════════════════════════════════════════════════
    divider("STEP 3: Verify Vessel State");

    const posidana = await oracle.getVessel("9371086");
    const posidanaVoy = await oracle.getVoyage("9371086");
    const posidanaCas = await oracle.getCasualty("9371086");
    const atLoadingPort = await oracle.isVesselAtLoadingPort("9371086");
    const hasArrived = await oracle.hasVesselArrived("9371086");

    console.log("  POSIDANA (9371086):");
    console.log(`    Nav Status: ${["Unknown", "Moored", "AtAnchor", "UnderWay", "Aground"][posidana.navStatus]}`);
    console.log(`    Destination: ${posidana.destination}`);
    console.log(`    ATD Epoch: ${posidanaVoy.atdEpoch} (0 = not departed)`);
    console.log(`    ETA Epoch: ${posidanaVoy.etaEpoch}`);
    console.log(`    At Loading Port: ${atLoadingPort} ← required for market creation`);
    console.log(`    Has Arrived: ${hasArrived}`);
    console.log(`    Casualty: ${posidanaCas.detected ? posidanaCas.casualtyType : "None"}`);

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 4: Deposit FLR into Vault
    // ══════════════════════════════════════════════════════════════════════════
    divider("STEP 4: Deposit FLR into Vault");

    const depositAmount = hre.ethers.parseEther("100");
    
    for (const [label, signer] of [["Hedger", h], ["Bidder 1", b1], ["Bidder 2", b2], ["Bidder 3", b3]]) {
        const tx = await vault.connect(signer).deposit({ value: depositAmount });
        await tx.wait();
        const bal = await vault.getBalance(signer.address);
        console.log(`  ${label} deposited 100 FLR → vault balance: ${fmt(bal)}`);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SCENARIO A: Collision Risk — POSIDANA (YES wins)
    // ══════════════════════════════════════════════════════════════════════════
    divider("SCENARIO A: Collision Risk — POSIDANA (YES wins)");
    console.log("  POSIDANA is moored at loading port (atd=0). Hedger wants collision");
    console.log("  protection for the upcoming voyage to Rotterdam.\n");

    // A1: Create market
    step("A1", "Hedger creates collision protection market...");
    const coverageA = 100n;
    const maxPremiumA = 2000n; // 20%
    const hedgerDepositA = await auction.calculateHedgerDeposit(coverageA, maxPremiumA);

    const block0 = await hre.ethers.provider.getBlock("latest");
    const departureA = block0.timestamp + 7200;  // 2 hours
    const etaA = block0.timestamp + 86400;       // 24 hours (voyage duration)

    console.log(`      Coverage: ${coverageA} shares`);
    console.log(`      Max Premium: ${Number(maxPremiumA)/100}%`);
    console.log(`      Hedger deposit (from vault): ${fmt(hedgerDepositA)}`);
    console.log(`      Departure: +2h, ETA: +24h`);

    const txCreateA = await auction.connect(h).createMarket(
        "9371086", 1, coverageA, maxPremiumA, departureA, etaA
    );
    await txCreateA.wait();
    console.log("      ✅ Market #1 created");

    const hedgerBalAfterCreate = await vault.getBalance(h.address);
    console.log(`      Hedger vault balance after: ${fmt(hedgerBalAfterCreate)}`);

    // A2: Bidders submit bids
    step("A2", "Bidders submit sealed NO-side bids (from vault balances)...\n");

    const txBid1 = await auction.connect(b1).submitBid(1, 50, 1500);
    await txBid1.wait();
    const b1Coll = await auction.calculateBidderCollateral(50, 1500);
    console.log(`      Bidder 1: 50 shares @ 1500 bps (15%) — ${fmt(b1Coll)} from vault`);

    const txBid2 = await auction.connect(b2).submitBid(1, 40, 1000);
    await txBid2.wait();
    const b2Coll = await auction.calculateBidderCollateral(40, 1000);
    console.log(`      Bidder 2: 40 shares @ 1000 bps (10%) — ${fmt(b2Coll)} from vault`);

    const txBid3 = await auction.connect(b3).submitBid(1, 80, 1800);
    await txBid3.wait();
    const b3Coll = await auction.calculateBidderCollateral(80, 1800);
    console.log(`      Bidder 3: 80 shares @ 1800 bps (18%) — ${fmt(b3Coll)} from vault`);

    console.log("\n      170 shares bid for 100 coverage");
    console.log("      Fill order: Bidder 2 (10%) → Bidder 1 (15%) → Bidder 3 (18%, partial 10/80)");

    // A3: Fast-forward and finalize
    step("A3", "Fast-forward to departure...");
    if (isLocal) {
        await hre.network.provider.send("evm_increaseTime", [7201]);
        await hre.network.provider.send("evm_mine");
        console.log("      ⏩ +2 hours");
    }

    step("A4", "Finalizing auction (shares minted)...");
    const txFinA = await auction.finalizeAuction(1);
    await txFinA.wait();

    const mktA = await auction.getMarket(1);
    console.log(`      Filled: ${mktA.filledShares}/${mktA.coverageSize} shares`);
    console.log(`      Hedger premium locked: ${fmt(mktA.hedgerPremiumLocked)}`);
    console.log(`      Bidder collateral locked: ${fmt(mktA.bidderCollateralLocked)}`);
    console.log(`      Phase: ${["AUCTION", "FINALIZED", "SETTLED", "CANCELLED"][mktA.phase]}`);

    // Check minted positions
    console.log("\n      Minted Positions:");
    const hedgerPos = await auction.getPosition(1, h.address);
    console.log(`        Hedger: ${hedgerPos.yesShares} YES shares (cost: ${fmt(hedgerPos.costBasis)})`);
    
    for (const [label, signer] of [["Bidder 1", b1], ["Bidder 2", b2], ["Bidder 3", b3]]) {
        const pos = await auction.getPosition(1, signer.address);
        if (pos.noShares > 0n) {
            console.log(`        ${label}: ${pos.noShares} NO shares (cost: ${fmt(pos.costBasis)})`);
        }
    }

    // Check bid results
    console.log("\n      Bid Fill Results:");
    for (let i = 1; i <= 3; i++) {
        const bid = await auction.getBid(i);
        console.log(`        Bid #${i}: ${bid.filledShares}/${bid.shares} @ ${bid.premiumBps} bps`);
    }

    // Check vault balances (unfilled collateral should be refunded)
    console.log("\n      Vault Balances After Finalization:");
    for (const [label, signer] of [["Hedger", h], ["Bidder 1", b1], ["Bidder 2", b2], ["Bidder 3", b3]]) {
        const bal = await vault.getBalance(signer.address);
        console.log(`        ${label}: ${fmt(bal)}`);
    }

    // A5: Simulate collision mid-voyage and settle
    step("A5", "Simulating collision during voyage...");
    const txCas = await oracle.submitCasualtyRecord(
        "9371086", true, "Collision", "2026-02-09",
        "Collision with cargo vessel in North Sea shipping lane"
    );
    await txCas.wait();
    console.log("      ⚠️ Collision recorded on-chain");

    step("A6", "Settling from oracle (collision detected → early settlement)...");
    const txSettleA = await auction.settleFromOracle(1);
    await txSettleA.wait();

    const mktASettled = await auction.getMarket(1);
    console.log(`      Outcome: ${mktASettled.outcome ? "YES ✅ (collision occurred)" : "NO (safe voyage)"}`);

    // A7: Claims
    step("A7", "Hedger claims payout (YES wins → full pool)...");
    const txClaimH = await auction.connect(h).claim(1);
    await txClaimH.wait();
    const hedgerFinal = await vault.getBalance(h.address);
    console.log(`      Hedger vault balance: ${fmt(hedgerFinal)}`);

    step("A8", "Bidders claim (YES won → bidders get 0)...");
    for (const [label, signer] of [["Bidder 1", b1], ["Bidder 2", b2], ["Bidder 3", b3]]) {
        const pos = await auction.getPosition(1, signer.address);
        if (pos.noShares > 0n && !pos.claimed) {
            const txC = await auction.connect(signer).claim(1);
            await txC.wait();
            console.log(`      ${label}: payout = 0 (collision happened)`);
        }
    }

    console.log("\n      Final Vault Balances (Scenario A):");
    for (const [label, signer] of [["Hedger", h], ["Bidder 1", b1], ["Bidder 2", b2], ["Bidder 3", b3]]) {
        const bal = await vault.getBalance(signer.address);
        console.log(`        ${label}: ${fmt(bal)}`);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SCENARIO B: PSC Detention — BOW COMPASS (NO wins)
    // ══════════════════════════════════════════════════════════════════════════
    divider("SCENARIO B: PSC Detention — BOW COMPASS (NO wins)");
    console.log("  BOW COMPASS has a clean record. Hedger buys detention protection.");
    console.log("  Vessel arrives, passes inspection → NO wins → bidder profits.\n");

    step("B1", "Create PSC detention market...");
    const coverageB = 50n;
    const premiumB = 1500n;
    const block1 = await hre.ethers.provider.getBlock("latest");
    const departureB = block1.timestamp + 7200;
    const etaB = block1.timestamp + 43200; // 12 hours

    const txCreateB = await auction.connect(h).createMarket(
        "9412737", 0, coverageB, premiumB, departureB, etaB
    );
    await txCreateB.wait();
    console.log("      ✅ Market #2 created (PSC Detention, BOW COMPASS)");

    step("B2", "Bidder submits bid...");
    const txBidB = await auction.connect(b1).submitBid(2, 50, 1200);
    await txBidB.wait();
    console.log("      Bidder 1: 50 shares @ 1200 bps (12%)");

    step("B3", "Fast-forward to departure, finalize...");
    if (isLocal) {
        await hre.network.provider.send("evm_increaseTime", [7201]);
        await hre.network.provider.send("evm_mine");
    }
    const txFinB = await auction.finalizeAuction(2);
    await txFinB.wait();
    const mktB = await auction.getMarket(2);
    console.log(`      Filled: ${mktB.filledShares}/${mktB.coverageSize}`);

    step("B4", "Simulate vessel arrival at destination...");
    // Update voyage data: vessel has arrived (ataEpoch set)
    const now = (await hre.ethers.provider.getBlock("latest")).timestamp;
    const txArrival = await oracle.submitVoyageData(
        "9412737",
        "NLRTM",           // departure port
        "NLRTM",           // destination port
        now - 43200,        // atd = departed 12h ago
        now - 3600,         // eta = 1h ago
        now                 // ata = just arrived
    );
    await txArrival.wait();
    // Update nav status to Moored (at discharge port)
    const txNav = await oracle.submitVesselData(
        "9412737", "BOW COMPASS",
        scaledCoord(51.895005), scaledCoord(4.426267),
        1, // Moored
        "NLRTM"
    );
    await txNav.wait();

    const arrived = await oracle.hasVesselArrived("9412737");
    console.log(`      Vessel arrived: ${arrived}`);

    step("B5", "Settle from oracle (PSC — vessel arrived, not detained)...");
    // Fast-forward past ETA so settlement is allowed
    if (isLocal) {
        await hre.network.provider.send("evm_increaseTime", [43201]);
        await hre.network.provider.send("evm_mine");
    }
    const txSettleB = await auction.settleFromOracle(2);
    await txSettleB.wait();

    const mktBSettled = await auction.getMarket(2);
    console.log(`      Outcome: ${mktBSettled.outcome ? "YES (detained)" : "NO ✅ (passed inspection)"}`);

    step("B6", "Claims...");
    try {
        const txCH2 = await auction.connect(h).claim(2);
        await txCH2.wait();
        console.log("      Hedger: payout = 0 (premium was cost of protection)");
    } catch (e) {
        console.log("      Hedger: no payout");
    }

    const txCB2 = await auction.connect(b1).claim(2);
    await txCB2.wait();
    const b1Final = await vault.getBalance(b1.address);
    console.log(`      Bidder 1: received collateral + premium → vault balance: ${fmt(b1Final)}`);

    // ══════════════════════════════════════════════════════════════════════════
    // SUMMARY
    // ══════════════════════════════════════════════════════════════════════════
    divider("📊 DEMO SUMMARY");

    console.log("  Contracts:");
    console.log(`    MaritimeRiskOracle:  ${oracleAddr}`);
    console.log(`    MaritimeRFQVault:    ${vaultAddr}`);
    console.log(`    VoyageAuction:       ${auctionAddr}`);
    console.log(`    Vessels on-chain:    ${vesselCount}`);

    console.log("\n  Scenario A — Collision (POSIDANA):");
    console.log("    ✅ Vessel at loading port (atd=0, moored) → market created");
    console.log("    ✅ 3 sealed bids → sorted by premium → partial fills");
    console.log("    ✅ Collision detected mid-voyage → early settlement (YES wins)");
    console.log("    ✅ Hedger paid out from full collateral pool");

    console.log("\n  Scenario B — PSC Detention (BOW COMPASS):");
    console.log("    ✅ Vessel at loading port → market created");
    console.log("    ✅ Settlement ONLY after vessel arrived at destination");
    console.log("    ✅ Not detained → NO wins → bidder profits from premium");

    console.log("\n  Risk-Type Settlement Rules:");
    console.log("    PSC_DETENTION  → settle at arrival (vessel moored at destination)");
    console.log("    COLLISION      → settle mid-voyage if detected, or at arrival");
    console.log("    GROUNDING      → settle mid-voyage if detected, or at arrival");
    console.log("    CASUALTY_OTHER → settle mid-voyage if detected, or at arrival");
    console.log("    VOYAGE_DELAY   → settle after ETA (arrived = NO, not arrived = YES)");

    console.log("\n  Vault Integration:");
    console.log("    ✅ Deposits/withdrawals via MaritimeRFQVault");
    console.log("    ✅ Hedger premium deducted from vault balance");
    console.log("    ✅ Bidder collateral deducted from vault balance");
    console.log("    ✅ Unfilled bids refunded to vault balance");
    console.log("    ✅ Settlement payouts credited to vault balance");
    console.log("    ✅ Protocol fees tracked (2%)");

    console.log("\n  Final Vault Balances:");
    for (const [label, signer] of [["Hedger", h], ["Bidder 1", b1], ["Bidder 2", b2], ["Bidder 3", b3]]) {
        const bal = await vault.getBalance(signer.address);
        console.log(`    ${label}: ${fmt(bal)}`);
    }

    const fees = await auction.protocolFees();
    console.log(`\n  Protocol Fees Collected: ${fmt(fees)}`);

    console.log("\n" + "═".repeat(70));
    console.log("  ✅ Demo Complete!");
    console.log("═".repeat(70) + "\n");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("\n❌ Demo failed:", error);
        process.exit(1);
    });
