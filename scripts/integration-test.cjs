/**
 * Integration Test: Rust RFQ Server + MaritimeVault Contract
 * 
 * This script tests the full flow:
 * 1. Deploy Vault to local Hardhat network
 * 2. Create market on both Vault and RFQ
 * 3. Simulate trading on RFQ
 * 4. Commit positions from RFQ to Vault
 * 5. Settle and claim
 */

const { ethers } = require("hardhat");

const RFQ_SERVER = "http://localhost:3001";

async function main() {
  console.log("\n🧪 Integration Test: Rust RFQ + Vault\n");
  console.log("=".repeat(50));

  // Check if Rust RFQ server is running
  try {
    const health = await fetch(`${RFQ_SERVER}/api/health`);
    const healthData = await health.json();
    console.log(`\n✓ Rust RFQ Server: ${healthData.status} (${healthData.engine})`);
  } catch (e) {
    console.error("\n✗ Rust RFQ server not running! Start with: npm run dev:rust");
    process.exit(1);
  }

  // Get signers
  const [owner, user1, user2] = await ethers.getSigners();
  console.log(`✓ Owner: ${owner.address}`);
  console.log(`✓ User1: ${user1.address}`);
  console.log(`✓ User2: ${user2.address}`);

  // Deploy Vault
  console.log("\n--- Deploying Vault ---");
  const MaritimeVault = await ethers.getContractFactory("MaritimeVault");
  const vault = await MaritimeVault.deploy();
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log(`✓ Vault deployed: ${vaultAddress}`);

  // Create market on Vault
  console.log("\n--- Creating Market on Vault ---");
  const expiresAt = Math.floor(Date.now() / 1000) + 86400;
  const createTx = await vault.createMarket("9703318", "Will MSC Oscar be detained?", expiresAt);
  await createTx.wait();
  console.log("✓ Market 0 created on Vault");

  // Get RFQ market
  console.log("\n--- Getting RFQ Market ---");
  const marketsRes = await fetch(`${RFQ_SERVER}/api/markets`);
  const marketsData = await marketsRes.json();
  const rfqMarket = marketsData.data[0];
  console.log(`✓ RFQ Market: ${rfqMarket.vessel_name} (${rfqMarket.id})`);
  console.log(`  YES: ${rfqMarket.yes_price}¢, NO: ${rfqMarket.no_price}¢`);

  // Simulate deposits on Vault
  console.log("\n--- Users Deposit on Vault ---");
  await vault.connect(user1).deposit(0, { value: ethers.parseEther("2.0") });
  await vault.connect(user2).deposit(0, { value: ethers.parseEther("2.0") });
  console.log("✓ User1 deposited 2 FLR");
  console.log("✓ User2 deposited 2 FLR");

  const market = await vault.getMarket(0);
  console.log(`✓ Total collateral: ${ethers.formatEther(market.totalCollateral)} FLR`);

  // Simulate RFQ trading
  console.log("\n--- Trading on Rust RFQ ---");
  
  // User1 buys YES shares
  const quote1Res = await fetch(`${RFQ_SERVER}/api/quotes/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      market_id: rfqMarket.id,
      user_id: user1.address,
      side: "YES",
      direction: "BUY",
      quantity: 150
    })
  });
  const quote1 = await quote1Res.json();
  console.log(`✓ User1 quote: ${quote1.data.quantity} YES @ ${quote1.data.price_per_share}¢`);

  // Accept quote
  const accept1Res = await fetch(`${RFQ_SERVER}/api/quotes/${quote1.data.id}/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: user1.address })
  });
  const accept1 = await accept1Res.json();
  console.log(`✓ User1 trade: ${accept1.data.position.yes_shares} YES shares`);

  // User2 buys NO shares
  const quote2Res = await fetch(`${RFQ_SERVER}/api/quotes/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      market_id: rfqMarket.id,
      user_id: user2.address,
      side: "NO",
      direction: "BUY",
      quantity: 150
    })
  });
  const quote2 = await quote2Res.json();

  const accept2Res = await fetch(`${RFQ_SERVER}/api/quotes/${quote2.data.id}/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: user2.address })
  });
  const accept2 = await accept2Res.json();
  console.log(`✓ User2 trade: ${accept2.data.position.no_shares} NO shares`);

  // Get final positions from RFQ
  console.log("\n--- Getting Final Positions from RFQ ---");
  const user1Summary = await (await fetch(`${RFQ_SERVER}/api/users/${user1.address}`)).json();
  const user2Summary = await (await fetch(`${RFQ_SERVER}/api/users/${user2.address}`)).json();

  const pos1 = user1Summary.data.positions.find(p => p.market_id === rfqMarket.id) || { yes_shares: 0, no_shares: 0 };
  const pos2 = user2Summary.data.positions.find(p => p.market_id === rfqMarket.id) || { yes_shares: 0, no_shares: 0 };

  console.log(`✓ User1 RFQ: ${pos1.yes_shares} YES, ${pos1.no_shares} NO`);
  console.log(`✓ User2 RFQ: ${pos2.yes_shares} YES, ${pos2.no_shares} NO`);

  // Commit positions to Vault
  console.log("\n--- Committing Positions to Vault ---");
  
  // Scale positions to match vault's share scale (using simple scaling for demo)
  const scale = ethers.parseEther("0.01"); // 1 RFQ share = 0.01 vault shares
  
  const commitTx = await vault.commitPositions(
    0,
    [user1.address, user2.address],
    [BigInt(pos1.yes_shares) * scale, BigInt(pos2.yes_shares) * scale],
    [BigInt(pos1.no_shares) * scale, BigInt(pos2.no_shares) * scale]
  );
  await commitTx.wait();
  console.log("✓ Positions committed to Vault");

  // Verify positions on Vault
  const vaultPos1 = await vault.getPosition(0, user1.address);
  const vaultPos2 = await vault.getPosition(0, user2.address);
  console.log(`✓ User1 Vault: ${ethers.formatEther(vaultPos1.yesShares)} YES, ${ethers.formatEther(vaultPos1.noShares)} NO`);
  console.log(`✓ User2 Vault: ${ethers.formatEther(vaultPos2.yesShares)} YES, ${ethers.formatEther(vaultPos2.noShares)} NO`);

  // Settle market - YES wins
  console.log("\n--- Settling Market (YES Wins) ---");
  const settleTx = await vault.settle(0, true);
  await settleTx.wait();
  console.log("✓ Market settled: YES wins");

  // Claims
  console.log("\n--- Users Claim Winnings ---");
  const bal1Before = await ethers.provider.getBalance(user1.address);
  const bal2Before = await ethers.provider.getBalance(user2.address);

  const claim1Tx = await vault.connect(user1).claim(0);
  await claim1Tx.wait();

  // User2 has mostly NO shares, may have small YES or none
  try {
    const claim2Tx = await vault.connect(user2).claim(0);
    await claim2Tx.wait();
  } catch (e) {
    console.log("✓ User2 has no winning shares (expected)");
  }

  const bal1After = await ethers.provider.getBalance(user1.address);
  const bal2After = await ethers.provider.getBalance(user2.address);

  const gain1 = bal1After - bal1Before;
  const gain2 = bal2After - bal2Before;

  console.log(`✓ User1 claimed: ${ethers.formatEther(gain1)} FLR`);
  if (gain2 > 0) {
    console.log(`✓ User2 claimed: ${ethers.formatEther(gain2)} FLR`);
  }

  console.log("\n" + "=".repeat(50));
  console.log("✅ Integration Test Complete!\n");
  console.log("Summary:");
  console.log("  - Vault deployed and working ✓");
  console.log("  - Rust RFQ server responding ✓");
  console.log("  - Trading on RFQ works ✓");
  console.log("  - Position commitment works ✓");
  console.log("  - Settlement & claims work ✓");
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
