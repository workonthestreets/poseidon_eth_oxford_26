const { ethers } = require("hardhat");

async function main() {
  const addr = "0x11b998592f08944d5C1bc6a3746498eBBa630f20";
  const auction = await ethers.getContractAt("PoseidonAuction", addr);
  
  // Check Market 0 state
  const quote = await auction.getQuoteRequest(0);
  console.log("Market 0 Quote:");
  console.log("  Hedger:", quote.hedger);
  console.log("  Amount USD:", ethers.formatEther(quote.amountUSD));
  console.log("  Active:", quote.active);
  console.log("  Filled:", quote.filled);
  
  // Check hedger balance
  const hedgerBal = await auction.getBalance(quote.hedger);
  console.log("\nHedger balance:", ethers.formatEther(hedgerBal), "FLR");
  
  // Calculate required collateral for $1 at 66% YES price
  const yesPrice = ethers.parseEther("0.66"); // 66%
  const amountUSD = quote.amountUSD; // $1
  const PRICE_DECIMALS = ethers.parseEther("1");
  
  // yesShares = (amountUSD * PRICE_DECIMALS) / yesPrice
  const yesShares = (amountUSD * PRICE_DECIMALS) / yesPrice;
  console.log("\nYES shares:", ethers.formatEther(yesShares));
  
  // hedgerCollateralUSD = (yesShares * yesPrice) / PRICE_DECIMALS
  const hedgerCollateralUSD = (yesShares * yesPrice) / PRICE_DECIMALS;
  console.log("Hedger collateral USD:", ethers.formatEther(hedgerCollateralUSD));
  
  // Convert to FLR (at $0.02/FLR)
  const flrPrice = await auction.flrPriceUSD();
  console.log("FLR price:", ethers.formatEther(flrPrice), "USD");
  
  const hedgerCollateralFLR = (hedgerCollateralUSD * ethers.parseEther("1")) / flrPrice;
  console.log("Hedger needs:", ethers.formatEther(hedgerCollateralFLR), "FLR");
  
  // Check if hedger has enough
  if (hedgerBal < hedgerCollateralFLR) {
    console.log("\n❌ HEDGER INSUFFICIENT! Has", ethers.formatEther(hedgerBal), "needs", ethers.formatEther(hedgerCollateralFLR));
    console.log("\nTo fix: Hedger needs to deposit", ethers.formatEther(hedgerCollateralFLR - hedgerBal), "more FLR");
  } else {
    console.log("\n✓ Hedger has enough");
  }
}

main().catch(console.error);
