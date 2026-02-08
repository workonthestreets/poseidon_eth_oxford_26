/**
 * Demo: VoyageAuction — Pre-Voyage Closed Auction for Maritime Risk Protection
 * 
 * Demonstrates the full lifecycle using REAL vessel data from offchain/data/risk_data/
 * loaded directly on-chain (fallback for FDC Web2Json which couldn't be made to work).
 * 
 * Lifecycle:
 *   1. Deploy Oracle + Auction contracts
 *   2. Load real vessel data on-chain from risk_data/*.json
 *   3. Hedger creates a market for a moored vessel (POSIDANA — has collision history)
 *   4. Three bidders submit NO-side bids during auction window
 *   5. Fast-forward time → finalize auction (best bids selected, partial fills)
 *   6. Simulate voyage + settlement (collision detected → YES wins → hedger paid out)
 *   7. Demonstrate NO-wins scenario for a clean vessel
 * 
 * Usage: npx hardhat run onchain/scripts/demoVoyageAuction.js [--network coston2]
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

/**
 * Map navigation_status string to enum value
 * The processed JSON often has "Unknown" but the raw voyage data has the real status.
 * We check raw first, then fall back to processed.
 */
function parseNavStatus(data) {
    // Try raw voyage data first (more accurate)
    let status = data.raw?.voyage?.data?.navigation_status || data.voyage?.navigation_status || "Unknown";
    
    const map = {
        "Unknown": 0,
        "Moored": 1,
        "At Anchor": 2,
        "Under Way": 3,
        "Aground": 4,
        // Common AIS variations
        "Under way using engine": 3,
        "Under way sailing": 3,
        "At anchor": 2,
    };
    return map[status] ?? 0;
}

function scaledCoord(val) {
    return Math.round((val || 0) * 1e6);
}

function fmt(wei) {
    return hre.ethers.formatEther(wei) + " FLR";
}

function divider(title) {
    console.log("\n" + "═".repeat(70));
    console.log(`  ${title}`);
    console.log("═".repeat(70) + "\n");
}

function step(n, msg) {
    console.log(`  [${ n }] ${msg}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
    divider("🚢 VoyageAuction Demo — Pre-Voyage Closed Auction");

    const signers = await hre.ethers.getSigners();
    const [deployer, hedger, bidder1, bidder2, bidder3] = signers;

    // On Hardhat local network we always have 20 signers; on testnet we may have fewer
    const isLocal = hre.network.name === "hardhat" || hre.network.name === "localhost";
    
    console.log("  Network:", hre.network.name);
    console.log("  Deployer:", deployer.address);
    if (hedger) console.log("  Hedger:", hedger.address);
    if (bidder1) console.log("  Bidder 1:", bidder1.address);
    if (bidder2) console.log("  Bidder 2:", bidder2.address);
    if (bidder3) console.log("  Bidder 3:", bidder3.address);

    // If on testnet with only 1 signer, use deployer for all roles
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

    step(2, "Deploying VoyageAuction...");
    const Auction = await hre.ethers.getContractFactory("VoyageAuction");
    const auction = await Auction.deploy(oracleAddr);
    await auction.waitForDeployment();
    const auctionAddr = await auction.getAddress();
    console.log("      Auction:", auctionAddr);

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 2: Load Real Vessel Data On-Chain
    // ══════════════════════════════════════════════════════════════════════════
    divider("STEP 2: Load Vessel Data On-Chain (from risk_data/*.json)");

    // Load all available risk data files
    const riskDataDir = path.join(process.cwd(), "offchain", "data", "risk_data");
    const files = fs.readdirSync(riskDataDir).filter(f => f.endsWith(".json"));
    
    console.log(`  Found ${files.length} vessel risk profiles\n`);

    for (const file of files) {
        const imo = file.replace(".json", "");
        const data = loadRiskData(imo);
        
        const navStatus = parseNavStatus(data);
        const navLabels = ["Unknown", "Moored", "AtAnchor", "UnderWay", "Aground"];

        // Use submitFullVesselProfile to load everything in one tx
        const tx = await oracle.submitFullVesselProfile(
            imo,
            data.meta.name || "",
            scaledCoord(data.voyage?.current_lat || data.raw?.voyage?.data?.lat),
            scaledCoord(data.voyage?.current_lon || data.raw?.voyage?.data?.lon),
            navStatus,
            data.voyage?.destination || data.raw?.voyage?.data?.destination || "",
            // PSC
            data.psc?.detention_count > 0 || data.psc?.detention === "1",
            data.psc?.deficiency_count || 0,
            data.psc?.inspection_port || "",
            data.psc?.inspection_date || "",
            data.psc?.inspection_authority || "",
            // Casualty
            data.casualty?.casualty_detected || false,
            data.casualty?.casualty_type || "",
            data.casualty?.casualty_date || "",
            data.casualty?.casualty_details || "",
            // Dry dock
            data.drydock?.next_due_date || "",
            data.drydock?.is_overdue || false
        );
        await tx.wait();

        const statusLabel = navLabels[navStatus] || "Unknown";
        const casualtyTag = data.casualty?.casualty_detected ? ` ⚠️ ${data.casualty.casualty_type}` : "";
        const pscTag = (data.psc?.detention_count > 0) ? " 🔴 DETAINED" : "";
        
        console.log(`  ✅ ${data.meta.name} (IMO: ${imo}) — ${statusLabel}${casualtyTag}${pscTag}`);
    }

    const vesselCount = await oracle.getKnownIMOCount();
    console.log(`\n  Total vessels on-chain: ${vesselCount}`);

    // ══════════════════════════════════════════════════════════════════════════
    // STEP 3: Verify On-Chain Data
    // ══════════════════════════════════════════════════════════════════════════
    divider("STEP 3: Verify On-Chain Data");

    // Check POSIDANA — has collision history, should be moored
    const posidana = await oracle.getVessel("9371086");
    const posidanaCasualty = await oracle.getCasualty("9371086");
    const posidanaPSC = await oracle.getPSC("9371086");

    console.log("  POSIDANA (9371086):");
    console.log(`    Name: ${posidana.name}`);
    console.log(`    Position: ${Number(posidana.latitude) / 1e6}, ${Number(posidana.longitude) / 1e6}`);
    console.log(`    Nav Status: ${["Unknown", "Moored", "AtAnchor", "UnderWay", "Aground"][posidana.navStatus]}`);
    console.log(`    Destination: ${posidana.destination}`);
    console.log(`    Casualty: ${posidanaCasualty.detected ? posidanaCasualty.casualtyType + " on " + posidanaCasualty.casualtyDate : "None"}`);
    console.log(`    PSC Deficiencies: ${posidanaPSC.deficiencyCount}, Detained: ${posidanaPSC.detained}`);

    const isMoored = await oracle.isVesselMoored("9371086");
    console.log(`    Is Moored (for market creation): ${isMoored}`);

    // ══════════════════════════════════════════════════════════════════════════
    // SCENARIO A: Collision Risk — POSIDANA (YES wins)
    // ══════════════════════════════════════════════════════════════════════════
    divider("SCENARIO A: Collision Risk Auction — POSIDANA");
    console.log("  POSIDANA has a collision history. The hedger (vessel operator) wants");
    console.log("  protection against another collision during the upcoming voyage.\n");

    // Step A1: Hedger creates market
    step("A1", "Hedger creates collision protection market...");

    const coverageSize = 100n;       // 100 units of coverage
    const maxPremiumBps = 2000n;     // 20% max premium (hedger willing to pay up to 20 FLR for 100 FLR coverage)
    
    // Calculate required deposit
    const hedgerDeposit = await auction.calculateHedgerDeposit(coverageSize, maxPremiumBps);
    console.log(`      Coverage: ${coverageSize} shares`);
    console.log(`      Max Premium: ${maxPremiumBps} bps (${Number(maxPremiumBps) / 100}%)`);
    console.log(`      Hedger Deposit: ${fmt(hedgerDeposit)}`);

    // Departure in 2 hours (we'll fast-forward)
    const block0 = await hre.ethers.provider.getBlock("latest");
    const departureTime = block0.timestamp + 7200; // 2 hours

    const txCreate = await auction.connect(h).createMarket(
        "9371086",
        1, // RiskType.COLLISION
        coverageSize,
        maxPremiumBps,
        departureTime,
        { value: hedgerDeposit }
    );
    await txCreate.wait();
    console.log("      ✅ Market #1 created (Collision risk, POSIDANA)");

    const market1 = await auction.getMarket(1);
    console.log(`      Phase: ${["AUCTION", "FINALIZED", "SETTLED", "CANCELLED"][market1.phase]}`);
    console.log(`      Departure: ${new Date(Number(market1.departureTime) * 1000).toISOString()}`);

    // Step A2: Bidders submit NO-side bids
    step("A2", "Bidders submit sealed NO-side bids...\n");

    // Bidder 1: 50 shares at 1500 bps (15% premium) — aggressive
    const b1Collateral = await auction.calculateBidderCollateral(50, 1500);
    const txBid1 = await auction.connect(b1).submitBid(1, 50, 1500, { value: b1Collateral });
    await txBid1.wait();
    console.log(`      Bidder 1: 50 shares @ 1500 bps (15%) — collateral ${fmt(b1Collateral)}`);

    // Bidder 2: 40 shares at 1000 bps (10% premium) — best price for hedger
    const b2Collateral = await auction.calculateBidderCollateral(40, 1000);
    const txBid2 = await auction.connect(b2).submitBid(1, 40, 1000, { value: b2Collateral });
    await txBid2.wait();
    console.log(`      Bidder 2: 40 shares @ 1000 bps (10%) — collateral ${fmt(b2Collateral)}`);

    // Bidder 3: 80 shares at 1800 bps (18% premium) — most expensive
    const b3Collateral = await auction.calculateBidderCollateral(80, 1800);
    const txBid3 = await auction.connect(b3).submitBid(1, 80, 1800, { value: b3Collateral });
    await txBid3.wait();
    console.log(`      Bidder 3: 80 shares @ 1800 bps (18%) — collateral ${fmt(b3Collateral)}`);

    console.log("\n      Auction has 3 bids totalling 170 shares for 100 coverage");
    console.log("      Expected fill order: Bidder 2 (10%) → Bidder 1 (15%) → Bidder 3 (18%, partial)");

    // Step A3: Fast-forward to departure and finalize
    step("A3", "Fast-forwarding to departure time...");
    
    if (isLocal) {
        await hre.network.provider.send("evm_increaseTime", [7201]);
        await hre.network.provider.send("evm_mine");
        console.log("      ⏩ Time advanced by 2 hours");
    } else {
        console.log("      ⏳ On testnet — would need to wait for real departure time");
        console.log("      (Skipping finalization for testnet demo)");
    }

    step("A4", "Finalizing auction...");
    const txFinalize = await auction.finalizeAuction(1);
    const receipt = await txFinalize.wait();
    console.log("      ✅ Auction finalized!");

    const market1After = await auction.getMarket(1);
    console.log(`      Filled Shares: ${market1After.filledShares} / ${market1After.coverageSize}`);
    console.log(`      Total Collateral Locked: ${fmt(market1After.totalCollateral)}`);
    console.log(`      Phase: ${["AUCTION", "FINALIZED", "SETTLED", "CANCELLED"][market1After.phase]}`);

    // Check individual bid fills
    console.log("\n      Bid Results:");
    for (let i = 1; i <= 3; i++) {
        const bid = await auction.getBid(i);
        console.log(`        Bid #${i}: ${bid.filledShares}/${bid.shares} filled @ ${bid.premiumBps} bps — ${bid.cancelled ? "CANCELLED/UNFILLED" : "ACTIVE"}`);
    }

    // Step A5: Simulate mid-voyage casualty and settle
    step("A5", "Simulating collision during voyage...");
    
    // Update oracle: vessel now has a new casualty (collision detected mid-voyage)
    const txCasualty = await oracle.submitCasualtyRecord(
        "9371086",
        true,
        "Collision",
        "2026-02-09",
        "Collision with cargo vessel in North Sea shipping lane"
    );
    await txCasualty.wait();
    console.log("      ⚠️ Collision recorded on-chain for POSIDANA");

    // Settle from oracle — should detect the collision
    step("A6", "Settling market from oracle data...");
    const txSettle = await auction.settleFromOracle(1);
    await txSettle.wait();

    const market1Settled = await auction.getMarket(1);
    console.log(`      Outcome: ${market1Settled.outcome ? "YES (collision occurred)" : "NO (no collision)"}`);
    console.log(`      Phase: ${["AUCTION", "FINALIZED", "SETTLED", "CANCELLED"][market1Settled.phase]}`);

    // Step A7: Claims
    step("A7", "Hedger claims payout (YES wins)...");
    
    const hedgerBalBefore = await hre.ethers.provider.getBalance(h.address);
    const txClaim = await auction.connect(h).claimHedger(1);
    await txClaim.wait();
    const hedgerBalAfter = await hre.ethers.provider.getBalance(h.address);
    const hedgerProfit = hedgerBalAfter - hedgerBalBefore;
    console.log(`      ✅ Hedger received payout!`);
    console.log(`      Net change: ~${fmt(hedgerProfit)} (includes gas costs)`);

    // Bidders try to claim — should get 0 since YES won
    step("A8", "Bidders claim (should get 0 — YES won)...");
    for (let i = 1; i <= 3; i++) {
        const bid = await auction.getBid(i);
        if (bid.filledShares > 0n) {
            try {
                const txBidClaim = await auction.connect(signers[i + 1] || deployer).claimBidder(i);
                await txBidClaim.wait();
                console.log(`      Bidder ${i}: Claimed (payout = 0, collision happened)`);
            } catch (e) {
                console.log(`      Bidder ${i}: ${e.message.includes("No winning") ? "No payout (YES won)" : e.message}`);
            }
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // SCENARIO B: PSC Detention Risk — BOW COMPASS (NO wins — clean vessel)
    // ══════════════════════════════════════════════════════════════════════════
    divider("SCENARIO B: PSC Detention Risk — BOW COMPASS (NO wins)");
    console.log("  BOW COMPASS has a clean record. Hedger buys detention protection,");
    console.log("  but vessel passes inspection → NO wins → bidders profit.\n");

    // Verify BOW COMPASS is moored
    const bowCompass = await oracle.getVessel("9412737");
    console.log(`  BOW COMPASS nav status: ${["Unknown", "Moored", "AtAnchor", "UnderWay", "Aground"][bowCompass.navStatus]}`);

    step("B1", "Hedger creates PSC detention market...");
    const coverage2 = 50n;
    const premium2 = 1500n; // 15%
    const deposit2 = await auction.calculateHedgerDeposit(coverage2, premium2);
    
    const block1 = await hre.ethers.provider.getBlock("latest");
    const departure2 = block1.timestamp + 7200;

    const txCreate2 = await auction.connect(h).createMarket(
        "9412737",
        0, // RiskType.PSC_DETENTION
        coverage2,
        premium2,
        departure2,
        { value: deposit2 }
    );
    await txCreate2.wait();
    console.log(`      ✅ Market #2 created (PSC Detention, BOW COMPASS)`);

    step("B2", "Single bidder submits bid...");
    const b1Collateral2 = await auction.calculateBidderCollateral(50, 1200);
    const txBid4 = await auction.connect(b1).submitBid(2, 50, 1200, { value: b1Collateral2 });
    await txBid4.wait();
    console.log(`      Bidder 1: 50 shares @ 1200 bps (12%)`);

    step("B3", "Fast-forward and finalize...");
    if (isLocal) {
        await hre.network.provider.send("evm_increaseTime", [7201]);
        await hre.network.provider.send("evm_mine");
    }
    const txFin2 = await auction.finalizeAuction(2);
    await txFin2.wait();
    
    const market2After = await auction.getMarket(2);
    console.log(`      Filled: ${market2After.filledShares}/${market2After.coverageSize}`);

    step("B4", "Vessel arrives, no detention → settle as NO...");
    // BOW COMPASS was not detained (clean record in oracle)
    const txSettle2 = await auction.settleFromOracle(2);
    await txSettle2.wait();

    const market2Settled = await auction.getMarket(2);
    console.log(`      Outcome: ${market2Settled.outcome ? "YES (detained)" : "NO (passed inspection)"}`);

    step("B5", "Hedger claims (should get 0)...");
    try {
        const txHClaim2 = await auction.connect(h).claimHedger(2);
        await txHClaim2.wait();
        console.log("      Hedger: Payout = 0 (no detention occurred, premium was cost of protection)");
    } catch (e) {
        console.log("      Hedger: No payout (NO wins)");
    }

    step("B6", "Bidder claims profit...");
    const bidder1BalBefore = await hre.ethers.provider.getBalance(b1.address);
    const txBClaim2 = await auction.connect(b1).claimBidder(4); // bidId 4
    await txBClaim2.wait();
    const bidder1BalAfter = await hre.ethers.provider.getBalance(b1.address);
    const bidderProfit = bidder1BalAfter - bidder1BalBefore;
    console.log(`      ✅ Bidder 1 received collateral + premium!`);
    console.log(`      Net change: ~${fmt(bidderProfit)} (includes gas costs)`);

    // ══════════════════════════════════════════════════════════════════════════
    // SUMMARY
    // ══════════════════════════════════════════════════════════════════════════
    divider("📊 DEMO SUMMARY");

    console.log("  Contracts:");
    console.log(`    MaritimeRiskOracle: ${oracleAddr}`);
    console.log(`    VoyageAuction:      ${auctionAddr}`);
    console.log(`    Vessels on-chain:   ${vesselCount}`);

    console.log("\n  Scenario A — Collision Risk (POSIDANA):");
    console.log("    Market: Collision protection, 100 shares @ max 20% premium");
    console.log("    Auction: 3 bids → best-price-first fill → partial fills");
    console.log("    Outcome: YES (collision occurred) → Hedger paid out");
    console.log("    Anti-toxic-flow: No trading after departure, sealed bids only");

    console.log("\n  Scenario B — PSC Detention (BOW COMPASS):");
    console.log("    Market: Detention protection, 50 shares @ max 15% premium");
    console.log("    Auction: 1 bid → fully filled");
    console.log("    Outcome: NO (vessel passed) → Bidder profits from premium");

    console.log("\n  Key Design Properties:");
    console.log("    ✅ Pre-voyage auction only (no mid-voyage trading)");
    console.log("    ✅ Sealed bids sorted by premium (best price for hedger)");
    console.log("    ✅ Partial fills across multiple bids");
    console.log("    ✅ On-chain vessel data (FDC fallback)");
    console.log("    ✅ Oracle-based settlement (reads on-chain data)");
    console.log("    ✅ Full collateralization (no counterparty risk)");
    console.log("    ✅ 2% protocol fee on settlement payouts\n");

    console.log("═".repeat(70));
    console.log("  ✅ Demo Complete!");
    console.log("═".repeat(70) + "\n");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("\n❌ Demo failed:", error);
        process.exit(1);
    });

