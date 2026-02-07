const hre = require("hardhat");

/**
 * Demo script to test the contracts locally or on testnet
 * Run after deployment with: npx hardhat run onchain/scripts/demo.js --network coston2
 */
async function main() {
  // Replace these with your deployed addresses after running deploy.js
  const ORACLE_ADDRESS = process.env.ORACLE_ADDRESS || "0x...";
  const MARKET_ADDRESS = process.env.MARKET_ADDRESS || "0x...";

  const [deployer, user1] = await hre.ethers.getSigners();
  console.log("Running demo with account:", deployer.address);

  // Get contract instances
  const oracle = await hre.ethers.getContractAt("MaritimeRiskOracle", ORACLE_ADDRESS);
  const market = await hre.ethers.getContractAt("MaritimePredictionMarket", MARKET_ADDRESS);

  console.log("\n=== DEMO: Maritime Risk Prediction Market ===\n");

  // 1. Submit mock maritime data to oracle (simulating FDC-verified data)
  console.log("1. Submitting mock PSC inspection data to oracle...");
  await oracle.submitPSCInspectionManual(
    "9703318",           // IMO
    "MSC OSCAR",         // Vessel name
    "2025-02-07",        // Inspection date
    false,               // Detained
    2,                   // Deficiency count
    "Rotterdam",         // Port
    "Paris MOU"          // Authority
  );
  console.log("   PSC inspection recorded (MSC OSCAR - not detained)");

  // 2. Submit casualty data
  console.log("\n2. Submitting mock casualty data...");
  await oracle.submitCasualtyManual(
    "9811000",
    "EVER GIVEN",
    "2025-01-15",
    "Grounding",
    "Vessel ran aground in shallow waters"
  );
  console.log("   Casualty recorded (EVER GIVEN - Grounding)");

  // 3. Create a PSC Detention market
  console.log("\n3. Creating PSC Detention prediction market...");
  const expiresAt = Math.floor(Date.now() / 1000) + 86400; // 24 hours from now
  const tx1 = await market.createPSCDetentionMarket(
    "9703318",
    "MSC OSCAR",
    "Rotterdam",
    expiresAt
  );
  await tx1.wait();
  console.log("   Market #1 created: Will MSC OSCAR be detained at Rotterdam?");

  // 4. Create a Casualty market
  console.log("\n4. Creating Casualty prediction market...");
  const tx2 = await market.createCasualtyMarket(
    "9839430",
    "HMM ALGECIRAS",
    "Collision",
    expiresAt
  );
  await tx2.wait();
  console.log("   Market #2 created: Will HMM ALGECIRAS have a Collision?");

  // 5. Buy shares
  console.log("\n5. Buying shares in markets...");
  const buyAmount = hre.ethers.parseEther("0.01"); // 0.01 C2FLR
  
  await market.buyNoShares(1, { value: buyAmount });
  console.log("   Bought NO shares in Market #1 (betting vessel won't be detained)");
  
  await market.buyYesShares(2, { value: buyAmount });
  console.log("   Bought YES shares in Market #2 (betting on collision)");

  // 6. Check market odds
  console.log("\n6. Market Odds:");
  const [yes1, no1] = await market.getMarketOdds(1);
  const [yes2, no2] = await market.getMarketOdds(2);
  console.log(`   Market #1: YES ${yes1}% / NO ${no1}%`);
  console.log(`   Market #2: YES ${yes2}% / NO ${no2}%`);

  // 7. Query oracle data
  console.log("\n7. Querying oracle data...");
  const inspection = await oracle.getLatestPSCInspection("9703318");
  console.log(`   Latest PSC inspection for 9703318:`);
  console.log(`     - Vessel: ${inspection.vesselName}`);
  console.log(`     - Date: ${inspection.inspectionDate}`);
  console.log(`     - Detained: ${inspection.detained}`);
  console.log(`     - Deficiencies: ${inspection.deficiencyCount}`);

  const casualty = await oracle.getLatestCasualty("9811000");
  console.log(`\n   Latest casualty for 9811000:`);
  console.log(`     - Vessel: ${casualty.vesselName}`);
  console.log(`     - Type: ${casualty.casualtyType}`);
  console.log(`     - Date: ${casualty.casualtyDate}`);

  console.log("\n=== DEMO COMPLETE ===");
  console.log("\nTo settle markets after expiry:");
  console.log("  - Call market.settlePSCDetentionMarket(1)");
  console.log("  - Call market.settleCasualtyMarket(2)");
  console.log("\nWinners can then call market.claimWinnings(marketId)");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
