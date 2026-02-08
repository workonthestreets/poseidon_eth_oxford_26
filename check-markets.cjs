const { ethers } = require("ethers");

const CONTRACT_ADDRESS = "0x1B020623663d465f589c36C33F26747bBE40f411";
const RPC_URL = "https://coston2-api.flare.network/ext/C/rpc";

const ABI = [
  "function marketCount() view returns (uint256)",
  "function markets(uint256) view returns (bytes32 uuid, string vesselIMO, string description, uint256 totalCollateral, uint256 totalShares, uint256 expiresAt, bool settled, bool outcome)"
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
  
  const count = await contract.marketCount();
  console.log("Market count:", count.toString());
  
  for (let i = 0; i < count; i++) {
    const market = await contract.markets(i);
    console.log(`\nMarket ${i}:`);
    console.log("  UUID:", market.uuid);
    console.log("  Vessel IMO:", market.vesselIMO);
    console.log("  Description:", market.description);
    console.log("  Total Collateral:", ethers.formatEther(market.totalCollateral), "FLR");
    console.log("  Total Shares:", market.totalShares.toString());
    console.log("  Expires:", new Date(Number(market.expiresAt) * 1000).toISOString());
    console.log("  Settled:", market.settled);
  }
  
  if (count == 0) {
    console.log("\nNo markets exist on-chain yet. Need to populate!");
  }
}

main().catch(console.error);
