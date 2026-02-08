/**
 * Deploy PoseidonDemo to Coston2 Testnet
 * 
 * Run: npx hardhat run scripts/deploy-poseidon-demo.cjs --network coston2
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("\n🔱 Deploying PoseidonDemo to Coston2...\n");

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "C2FLR");

  // Deploy PoseidonDemo
  console.log("\nDeploying PoseidonDemo...");
  const PoseidonDemo = await ethers.getContractFactory("PoseidonDemo");
  const demo = await PoseidonDemo.deploy();
  await demo.waitForDeployment();
  
  const demoAddress = await demo.getAddress();
  console.log("✓ PoseidonDemo deployed:", demoAddress);

  // Check initialized data
  const vesselCount = await demo.vesselCount();
  const marketCount = await demo.marketCount();
  console.log("\nInitialized data:");
  console.log("  Vessels:", vesselCount.toString());
  console.log("  Markets:", marketCount.toString());

  // List vessels
  console.log("\n📦 Pre-defined Vessels:");
  for (let i = 0; i < vesselCount; i++) {
    const vessel = await demo.getVessel(i);
    console.log(`  [${i}] ${vessel.name} (IMO ${vessel.imo}) - ${vessel.route}`);
  }

  // Save deployment info
  const deploymentInfo = {
    network: "coston2",
    chainId: 114,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      PoseidonDemo: demoAddress,
    },
    vesselCount: Number(vesselCount),
    marketCount: Number(marketCount),
    explorer: `https://coston2-explorer.flare.network/address/${demoAddress}`,
  };

  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }

  fs.writeFileSync(
    path.join(deploymentsDir, "poseidon-demo-latest.json"),
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log("\n✅ Deployment saved to: deployments/poseidon-demo-latest.json");
  console.log("\n🔗 View on Explorer:");
  console.log(`   ${deploymentInfo.explorer}`);

  return deploymentInfo;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
