/**
 * Deploy PoseidonVault to Coston2 Testnet
 * 
 * Run: npx hardhat run scripts/deploy-poseidon-coston2.cjs --network coston2
 * 
 * Prerequisites:
 * 1. Set PRIVATE_KEY in .env file
 * 2. Get C2FLR from faucet: https://faucet.flare.network/coston2
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("\n🔱 Deploying PoseidonVault to Coston2...\n");

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "C2FLR");
  
  if (balance < ethers.parseEther("1")) {
    console.error("\n❌ Insufficient balance! Get C2FLR from faucet:");
    console.error("   https://faucet.flare.network/coston2\n");
    process.exit(1);
  }

  // Deploy PoseidonVault
  console.log("\nDeploying PoseidonVault...");
  const PoseidonVault = await ethers.getContractFactory("PoseidonVault");
  const vault = await PoseidonVault.deploy();
  await vault.waitForDeployment();
  
  const vaultAddress = await vault.getAddress();
  console.log("✓ PoseidonVault deployed:", vaultAddress);

  // Verify deployment
  const owner = await vault.owner();
  const operator = await vault.operator();
  const oracle = await vault.oracle();
  
  console.log("\nContract roles:");
  console.log("  Owner:", owner);
  console.log("  Operator:", operator);
  console.log("  Oracle:", oracle);

  // Save deployment info
  const deploymentInfo = {
    network: "coston2",
    chainId: 114,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      PoseidonVault: vaultAddress,
    },
    explorer: `https://coston2-explorer.flare.network/address/${vaultAddress}`,
  };

  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir);
  }

  const filename = `poseidon-coston2-${Date.now()}.json`;
  fs.writeFileSync(
    path.join(deploymentsDir, filename),
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log("\n✅ Deployment saved to:", filename);
  console.log("\n🔗 View on Explorer:");
  console.log(`   ${deploymentInfo.explorer}`);
  
  // Also update the latest deployment file
  fs.writeFileSync(
    path.join(deploymentsDir, "poseidon-latest.json"),
    JSON.stringify(deploymentInfo, null, 2)
  );

  console.log("\n📋 Next steps:");
  console.log("   1. Update UI with contract address");
  console.log("   2. Fund the deployer wallet for demo transactions");
  console.log("   3. Run the demo!\n");

  return deploymentInfo;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
