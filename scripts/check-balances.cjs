const { ethers } = require("hardhat");

async function main() {
  const addr = "0x11b998592f08944d5C1bc6a3746498eBBa630f20";
  const auction = await ethers.getContractAt("PoseidonAuction", addr);
  
  const hedger = "0x33f08D0D7A40827cac4699AAf3b59479E5C1E35E";
  const balance = await auction.getBalance(hedger);
  console.log("Hedger balance:", ethers.formatEther(balance), "FLR");
  
  // Check what's needed for $1 hedge at 66%
  const flrPrice = await auction.flrPriceUSD();
  console.log("FLR price:", ethers.formatEther(flrPrice), "USD");
  
  // For $1 hedge at 66% YES:
  // Hedger needs: $1 worth of FLR = 1 / 0.02 = 50 FLR
  // Counterparty needs: $1 worth of FLR = 50 FLR
  console.log("\nFor $1 hedge at 66% YES price:");
  console.log("  Hedger needs: ~50 FLR");
  console.log("  Counterparty needs: ~50 FLR");
}

main().catch(console.error);
