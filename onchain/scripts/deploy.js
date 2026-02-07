const hre = require("hardhat");

async function main() {
  console.log("Deploying to Flare Coston2 Testnet...\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", hre.ethers.formatEther(balance), "C2FLR\n");

  // Deploy MaritimeRiskOracle first
  console.log("1. Deploying MaritimeRiskOracle...");
  const MaritimeRiskOracle = await hre.ethers.getContractFactory("MaritimeRiskOracle");
  const oracle = await MaritimeRiskOracle.deploy();
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log("   MaritimeRiskOracle deployed to:", oracleAddress);

  // Deploy MaritimePredictionMarket with oracle address
  console.log("\n2. Deploying MaritimePredictionMarket...");
  const MaritimePredictionMarket = await hre.ethers.getContractFactory("MaritimePredictionMarket");
  const market = await MaritimePredictionMarket.deploy(oracleAddress);
  await market.waitForDeployment();
  const marketAddress = await market.getAddress();
  console.log("   MaritimePredictionMarket deployed to:", marketAddress);

  // Authorize the market contract to submit data to oracle (optional but useful)
  console.log("\n3. Setting up permissions...");
  await oracle.setAuthorizedSubmitter(marketAddress, true);
  console.log("   MaritimePredictionMarket authorized as oracle submitter");

  console.log("\n========================================");
  console.log("DEPLOYMENT COMPLETE!");
  console.log("========================================");
  console.log("\nContract Addresses:");
  console.log("  MaritimeRiskOracle:       ", oracleAddress);
  console.log("  MaritimePredictionMarket: ", marketAddress);
  console.log("\nView on Explorer:");
  console.log(`  https://coston2-explorer.flare.network/address/${oracleAddress}`);
  console.log(`  https://coston2-explorer.flare.network/address/${marketAddress}`);
  console.log("\nNext Steps:");
  console.log("  1. Submit maritime data to oracle (with FDC proofs or manually)");
  console.log("  2. Create prediction markets");
  console.log("  3. Users can buy YES/NO shares");
  console.log("  4. Settle markets based on oracle data");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
