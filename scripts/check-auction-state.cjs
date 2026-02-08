const { ethers } = require("hardhat");

async function main() {
  const addr = "0x11b998592f08944d5C1bc6a3746498eBBa630f20";
  const auction = await ethers.getContractAt("PoseidonAuction", addr);
  
  const marketCount = await auction.marketCount();
  console.log("Total markets:", marketCount.toString());
  
  for (let i = 0; i < Math.min(Number(marketCount), 5); i++) {
    const market = await auction.getMarket(i);
    const quote = await auction.getQuoteRequest(i);
    console.log(`\nMarket ${i}:`);
    console.log("  Phase:", ["OPEN", "ACTIVE", "SETTLED"][market.phase]);
    console.log("  Quote active:", quote.active);
    console.log("  Quote filled:", quote.filled);
    if (quote.active) {
      console.log("  Hedger:", quote.hedger);
      console.log("  Amount:", ethers.formatEther(quote.amountUSD), "USD");
    }
  }
}

main().catch(console.error);
