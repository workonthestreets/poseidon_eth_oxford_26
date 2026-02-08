const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("\n🔱 Deploying PoseidonAuction to Coston2...\n");
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const PoseidonAuction = await ethers.getContractFactory("PoseidonAuction");
  const auction = await PoseidonAuction.deploy();
  await auction.waitForDeployment();
  
  const addr = await auction.getAddress();
  console.log("✓ PoseidonAuction deployed:", addr);

  const vesselCount = await auction.vesselCount();
  const marketCount = await auction.marketCount();
  console.log("  Vessels:", vesselCount.toString());
  console.log("  Markets:", marketCount.toString());

  const info = {
    address: addr,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    explorer: `https://coston2-explorer.flare.network/address/${addr}`,
  };

  fs.writeFileSync(
    path.join(__dirname, "../deployments/poseidon-auction-latest.json"),
    JSON.stringify(info, null, 2)
  );

  console.log("\n🔗", info.explorer);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
