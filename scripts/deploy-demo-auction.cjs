/**
 * Deploy DemoAuction to Coston2 Testnet
 * 
 * Run: npx hardhat run scripts/deploy-demo-auction.cjs --network coston2
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("\n🎯 Deploying DemoAuction to Coston2...\n");

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "C2FLR");
  
  if (balance < ethers.parseEther("0.5")) {
    console.error("\n❌ Insufficient balance! Get C2FLR from faucet:");
    console.error("   https://faucet.flare.network/coston2\n");
    process.exit(1);
  }

  // Deploy DemoAuction
  console.log("\nDeploying DemoAuction...");
  const DemoAuction = await ethers.getContractFactory("DemoAuction");
  const auction = await DemoAuction.deploy();
  await auction.waitForDeployment();
  
  const auctionAddress = await auction.getAddress();
  console.log("✓ DemoAuction deployed:", auctionAddress);

  // Verify deployment
  const owner = await auction.owner();
  const oracle = await auction.oracle();
  
  console.log("\nContract roles:");
  console.log("  Owner:", owner);
  console.log("  Oracle:", oracle);

  // Save deployment info
  const deploymentInfo = {
    network: "coston2",
    chainId: 114,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      DemoAuction: auctionAddress,
    },
    explorer: `https://coston2-explorer.flare.network/address/${auctionAddress}`,
  };

  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }

  fs.writeFileSync(
    path.join(deploymentsDir, "demo-auction-latest.json"),
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log("\n✅ Deployment saved to: deployments/demo-auction-latest.json");
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
