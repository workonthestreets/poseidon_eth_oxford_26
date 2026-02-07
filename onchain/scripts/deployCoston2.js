const hre = require("hardhat");

/**
 * Deployment script for MaritimeRiskOracle and MaritimePredictionMarket
 * Configured for Flare Coston2 Testnet
 */

// Coston2 FDC Contract Addresses (via ContractRegistry)
const COSTON2_CONTRACTS = {
  FDC_HUB: "0x2cA6571Daa15ce734Bbd0Bf27D5C9D16787fc33f",
  FDC_VERIFICATION: "0xd5C9b6F1E6a1F3C3e4B5bD8C3e8F9A3B2c7D6E5f",
  RELAY: "0xbA35e39D01A3f5710d1e43FC61dbb738B68641c4",
  CONTRACT_REGISTRY: "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019"
};

async function main() {
  console.log("=".repeat(60));
  console.log("🚀 Deploying to Flare Coston2 Testnet");
  console.log("=".repeat(60));

  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  
  console.log("\n📋 Deployment Configuration:");
  console.log(`   Network: ${network.name} (Chain ID: ${network.chainId})`);
  console.log(`   Deployer: ${deployer.address}`);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`   Balance: ${hre.ethers.formatEther(balance)} C2FLR\n`);

  if (balance < hre.ethers.parseEther("0.1")) {
    console.log("⚠️  Warning: Low balance. Get testnet tokens from:");
    console.log("   https://faucet.flare.network/coston2\n");
  }

  console.log("🔗 FDC Contract Addresses:");
  console.log(`   FDC Hub: ${COSTON2_CONTRACTS.FDC_HUB}`);
  console.log(`   FDC Verification: ${COSTON2_CONTRACTS.FDC_VERIFICATION}`);
  console.log(`   Relay: ${COSTON2_CONTRACTS.RELAY}`);
  console.log(`   Contract Registry: ${COSTON2_CONTRACTS.CONTRACT_REGISTRY}\n`);

  // Step 1: Deploy MaritimeRiskOracle
  console.log("━".repeat(60));
  console.log("STEP 1: Deploy MaritimeRiskOracle");
  console.log("━".repeat(60));

  const MaritimeRiskOracle = await hre.ethers.getContractFactory("MaritimeRiskOracle");
  
  console.log("📤 Deploying MaritimeRiskOracle...");
  const oracle = await MaritimeRiskOracle.deploy();
  await oracle.waitForDeployment();
  
  const oracleAddress = await oracle.getAddress();
  console.log(`✅ MaritimeRiskOracle deployed to: ${oracleAddress}\n`);

  // Step 2: Deploy MaritimePredictionMarket
  console.log("━".repeat(60));
  console.log("STEP 2: Deploy MaritimePredictionMarket");
  console.log("━".repeat(60));

  const MaritimePredictionMarket = await hre.ethers.getContractFactory("MaritimePredictionMarket");
  
  console.log("📤 Deploying MaritimePredictionMarket...");
  const market = await MaritimePredictionMarket.deploy(oracleAddress);
  await market.waitForDeployment();
  
  const marketAddress = await market.getAddress();
  console.log(`✅ MaritimePredictionMarket deployed to: ${marketAddress}\n`);

  // Step 3: Verify contracts (if not localhost)
  if (network.chainId === 114n) { // Coston2
    console.log("━".repeat(60));
    console.log("STEP 3: Verify Contracts on Explorer");
    console.log("━".repeat(60));

    console.log("\n⏳ Waiting 30 seconds before verification...");
    await new Promise(resolve => setTimeout(resolve, 30000));

    try {
      console.log("\n📝 Verifying MaritimeRiskOracle...");
      await hre.run("verify:verify", {
        address: oracleAddress,
        constructorArguments: [],
      });
      console.log("✅ MaritimeRiskOracle verified");
    } catch (error) {
      console.log("⚠️  Verification failed (may already be verified):", error.message);
    }

    try {
      console.log("\n📝 Verifying MaritimePredictionMarket...");
      await hre.run("verify:verify", {
        address: marketAddress,
        constructorArguments: [oracleAddress],
      });
      console.log("✅ MaritimePredictionMarket verified");
    } catch (error) {
      console.log("⚠️  Verification failed (may already be verified):", error.message);
    }
  }

  // Step 4: Configure contracts
  console.log("\n" + "━".repeat(60));
  console.log("STEP 4: Configure Contracts");
  console.log("━".repeat(60));

  console.log("\n📝 Setting up authorized submitters...");
  
  // Authorize deployer to submit manual data (for testing)
  const tx1 = await oracle.setAuthorizedSubmitter(deployer.address, true);
  await tx1.wait();
  console.log("✅ Deployer authorized as submitter on oracle");

  // Authorize market contract to interact with oracle if needed
  const tx2 = await oracle.setAuthorizedSubmitter(marketAddress, true);
  await tx2.wait();
  console.log("✅ Market contract authorized on oracle");

  // Step 5: Summary
  console.log("\n" + "=".repeat(60));
  console.log("✅ Deployment Complete!");
  console.log("=".repeat(60));

  console.log("\n📦 Deployed Contracts:");
  console.log(`   MaritimeRiskOracle: ${oracleAddress}`);
  console.log(`   MaritimePredictionMarket: ${marketAddress}`);

  console.log("\n🔗 Explorer Links:");
  console.log(`   Oracle: https://coston2-explorer.flare.network/address/${oracleAddress}`);
  console.log(`   Market: https://coston2-explorer.flare.network/address/${marketAddress}`);

  console.log("\n📝 Add to .env file:");
  console.log(`ORACLE_ADDRESS=${oracleAddress}`);
  console.log(`MARKET_ADDRESS=${marketAddress}`);

  console.log("\n🧪 Next Steps:");
  console.log("   1. Add contract addresses to .env");
  console.log("   2. Run FDC integration test:");
  console.log("      npx ts-node onchain/scripts/fdcIntegration/testPSCInspection.ts");
  console.log("   3. Create test market:");
  console.log("      npx hardhat run onchain/scripts/createTestMarket.js --network coston2");

  // Save deployment info
  const deploymentInfo = {
    network: network.name,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      MaritimeRiskOracle: oracleAddress,
      MaritimePredictionMarket: marketAddress,
    },
    fdcContracts: COSTON2_CONTRACTS,
  };

  const fs = require('fs');
  const path = require('path');
  
  const deploymentsDir = path.join(__dirname, '../../deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const filename = `coston2-${Date.now()}.json`;
  fs.writeFileSync(
    path.join(deploymentsDir, filename),
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log(`\n💾 Deployment info saved to: deployments/${filename}`);
  console.log("\n" + "=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Deployment failed:");
    console.error(error);
    process.exit(1);
  });
