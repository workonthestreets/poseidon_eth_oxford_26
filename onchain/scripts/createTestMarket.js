const hre = require("hardhat");

/**
 * Create test prediction market for demonstration
 * Uses MaritimePredictionMarket contract on Coston2
 */

async function main() {
  console.log("=".repeat(60));
  console.log("📊 Creating Test Prediction Market");
  console.log("=".repeat(60));

  const [deployer] = await hre.ethers.getSigners();
  console.log(`\n👤 Using account: ${deployer.address}`);

  const marketAddress = process.env.MARKET_ADDRESS;
  
  if (!marketAddress) {
    console.log("\n❌ MARKET_ADDRESS not found in .env");
    console.log("   Deploy contracts first:");
    console.log("   npx hardhat run onchain/scripts/deployCoston2.js --network coston2");
    return;
  }

  const market = await hre.ethers.getContractAt(
    "MaritimePredictionMarket",
    marketAddress,
    deployer
  );

  console.log(`\n📍 Market Contract: ${marketAddress}\n`);

  // Create PSC Detention Market
  console.log("━".repeat(60));
  console.log("Creating PSC Detention Market");
  console.log("━".repeat(60));

  const vesselIMO = "9703318"; // MSC Oscar
  const vesselName = "MSC OSCAR";
  const targetPort = "SINGAPORE";
  const expiresAt = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // 7 days

  console.log("\n📋 Market Details:");
  console.log(`   Vessel: ${vesselName} (IMO: ${vesselIMO})`);
  console.log(`   Port: ${targetPort}`);
  console.log(`   Question: Will vessel be detained at ${targetPort}?`);
  console.log(`   Expires: ${new Date(expiresAt * 1000).toISOString()}\n`);

  console.log("📤 Creating market...");
  const tx = await market.createPSCDetentionMarket(
    vesselIMO,
    vesselName,
    targetPort,
    expiresAt
  );

  console.log(`   Tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log("✅ Market created!\n");

  // Extract market ID from event
  const event = receipt.logs.find(
    log => log.fragment && log.fragment.name === "MarketCreated"
  );

  let marketId = 1;
  if (event) {
    marketId = event.args[0];
    console.log(`📊 Market ID: ${marketId}`);
  }

  // Fetch market details
  const marketDetails = await market.getMarket(marketId);
  
  console.log("\n📄 Market Information:");
  console.log(`   ID: ${marketDetails.id}`);
  console.log(`   Type: ${["PSC_DETENTION", "CASUALTY", "VOYAGE_COMPLETION", "DRY_DOCK_TIMING", "PORT_CONGESTION"][marketDetails.marketType]}`);
  console.log(`   Status: ${["OPEN", "LOCKED", "SETTLED", "CANCELLED"][marketDetails.status]}`);
  console.log(`   Vessel: ${marketDetails.vesselName} (IMO: ${marketDetails.vesselIMO})`);
  console.log(`   Description: ${marketDetails.description}`);
  console.log(`   Created: ${new Date(Number(marketDetails.createdAt) * 1000).toISOString()}`);
  console.log(`   Expires: ${new Date(Number(marketDetails.expiresAt) * 1000).toISOString()}`);

  console.log("\n💰 Market Pool:");
  console.log(`   YES shares: ${marketDetails.totalYesShares}`);
  console.log(`   NO shares: ${marketDetails.totalNoShares}`);
  console.log(`   Total pool: ${hre.ethers.formatEther(marketDetails.totalPool)} C2FLR`);

  console.log("\n" + "=".repeat(60));
  console.log("✅ Test Market Created Successfully!");
  console.log("=".repeat(60));

  console.log("\n🎯 Next Steps:");
  console.log("   1. Buy shares:");
  console.log(`      market.buyYesShares(${marketId}, { value: ethers.parseEther("1.0") })`);
  console.log(`      market.buyNoShares(${marketId}, { value: ethers.parseEther("1.0") })`);
  console.log("\n   2. Submit FDC attestation:");
  console.log("      npx ts-node onchain/scripts/fdcIntegration/testPSCInspection.ts");
  console.log("\n   3. Settle market after expiry:");
  console.log(`      market.settlePSCDetentionMarket(${marketId})`);

  console.log("\n🔗 View on Explorer:");
  console.log(`   https://coston2-explorer.flare.network/address/${marketAddress}`);
  console.log("\n" + "=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
