#!/usr/bin/env node

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  POSEIDON MARITIME RISK PROTOCOL - AUTO DEMO                              ║
 * ║                                                                            ║
 * ║  Non-interactive demo that runs automatically.                            ║
 * ║  Run: npx hardhat run scripts/demo-auto.cjs --network hardhat             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

const { ethers } = require("hardhat");

const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

const c = (color, text) => `${COLORS[color]}${text}${COLORS.reset}`;

function formatFLR(bn) {
  return `${ethers.formatEther(bn)} FLR`;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log(`
${c("cyan", "╔═══════════════════════════════════════════════════════════════════════════╗")}
${c("cyan", "║")}  ${c("bright", "🔱 POSEIDON MARITIME RISK PROTOCOL - AUTO DEMO")}                         ${c("cyan", "║")}
${c("cyan", "╚═══════════════════════════════════════════════════════════════════════════╝")}
`);

  const [deployer, hedger, cp1, cp2, oracle] = await ethers.getSigners();
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SETUP
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(c("magenta", "\n[SETUP] Deploying contract and funding accounts...\n"));
  
  const PoseidonVault = await ethers.getContractFactory("PoseidonVault");
  const vault = await PoseidonVault.deploy();
  await vault.waitForDeployment();
  console.log(`  ${c("green", "✓")} Contract deployed: ${await vault.getAddress()}`);
  
  await vault.setOracle(oracle.address);
  
  const deposit = ethers.parseEther("500");
  await vault.connect(hedger).deposit({ value: deposit });
  await vault.connect(cp1).deposit({ value: deposit });
  await vault.connect(cp2).deposit({ value: deposit });
  console.log(`  ${c("green", "✓")} Accounts funded with 500 FLR each`);
  
  await sleep(500);

  // ═══════════════════════════════════════════════════════════════════════════
  // T-1: COMMITMENT PHASE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(c("magenta", "\n[T-1] COMMITMENT PHASE\n"));
  
  const now = Math.floor(Date.now() / 1000);
  await vault.createMarket("9876543", "MV Pacific Sentinel", 0, now + 3600, now + 7200, now + 86400);
  console.log(`  ${c("green", "✓")} Market created: MV Pacific Sentinel (PSC Detention Risk)`);
  
  await vault.connect(hedger).createHedgeRequest(
    0,
    ethers.parseEther("10"),
    ethers.parseEther("2"),
    ethers.parseEther("0.85")
  );
  console.log(`  ${c("green", "✓")} Hedger created RFQ: $10 hedge @ 85¢ YES price`);
  
  await vault.connect(cp1).submitBid(0, ethers.parseEther("5"), ethers.parseEther("0.15"));
  console.log(`  ${c("green", "✓")} CP1 bid: $5 @ 15¢ NO price`);
  
  await vault.connect(cp2).submitBid(0, ethers.parseEther("5"), ethers.parseEther("0.14"));
  console.log(`  ${c("green", "✓")} CP2 bid: $5 @ 14¢ NO price`);
  
  await vault.connect(hedger).acceptBid(0, 0);
  await vault.connect(hedger).acceptBid(0, 1);
  console.log(`  ${c("green", "✓")} Hedger accepted all bids - RFQ filled!`);
  
  await sleep(500);

  // ═══════════════════════════════════════════════════════════════════════════
  // T0: DEPARTURE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(c("magenta", "\n[T0] VESSEL DEPARTURE\n"));
  
  await vault.connect(oracle).confirmDeparture(0);
  
  const market = await vault.getMarket(0);
  console.log(`  ${c("green", "✓")} Departure confirmed - shares emitted!`);
  console.log(`      YES shares: ${ethers.formatEther(market.totalYesShares)}`);
  console.log(`      NO shares:  ${ethers.formatEther(market.totalNoShares)}`);
  console.log(`      Collateral: ${formatFLR(market.totalCollateral)}`);
  
  await sleep(500);

  // ═══════════════════════════════════════════════════════════════════════════
  // T1: VOYAGE ACTIVE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(c("magenta", "\n[T1] VOYAGE ACTIVE\n"));
  console.log(`  ${c("gray", "⚓ Vessel underway Shanghai → Rotterdam")}`);
  console.log(`  ${c("gray", "📡 Monitoring for PSC detention events...")}`);
  
  await sleep(500);

  // ═══════════════════════════════════════════════════════════════════════════
  // T2: ORACLE DATA
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(c("magenta", "\n[T2] ORACLE DATA SUBMISSION\n"));
  
  const yesWins = Math.random() > 0.5;
  const dataHash = ethers.keccak256(ethers.toUtf8Bytes(`detained:${yesWins}`));
  
  await vault.connect(oracle).submitSyntheticOutcome(0, yesWins, dataHash);
  console.log(`  ${c("green", "✓")} Oracle submitted: ${yesWins ? "DETAINED (YES wins)" : "PASSED (NO wins)"}`);
  
  await sleep(500);

  // ═══════════════════════════════════════════════════════════════════════════
  // T3: SETTLEMENT
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(c("magenta", "\n[T3] SETTLEMENT & CLAIMS\n"));
  
  await vault.settle(0);
  console.log(`  ${c("green", "✓")} Market settled`);
  
  if (yesWins) {
    const balBefore = await vault.getBalance(hedger.address);
    await vault.connect(hedger).claim(0);
    const balAfter = await vault.getBalance(hedger.address);
    console.log(`  ${c("green", "✓")} Hedger claimed: ${formatFLR(balAfter - balBefore)}`);
  } else {
    const b1 = await vault.getBalance(cp1.address);
    await vault.connect(cp1).claim(0);
    const a1 = await vault.getBalance(cp1.address);
    
    const b2 = await vault.getBalance(cp2.address);
    await vault.connect(cp2).claim(0);
    const a2 = await vault.getBalance(cp2.address);
    
    console.log(`  ${c("green", "✓")} CP1 claimed: ${formatFLR(a1 - b1)}`);
    console.log(`  ${c("green", "✓")} CP2 claimed: ${formatFLR(a2 - b2)}`);
  }
  
  const fees = await vault.protocolFees();
  console.log(`  ${c("green", "✓")} Protocol fees: ${formatFLR(fees)} (2%)`);

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPLETE
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`
${c("cyan", "╔═══════════════════════════════════════════════════════════════════════════╗")}
${c("cyan", "║")}  ${c("bright", "🎉 DEMO COMPLETE!")}                                                       ${c("cyan", "║")}
${c("cyan", "║")}                                                                           ${c("cyan", "║")}
${c("cyan", "║")}  T-1: Commitment → T0: Departure → T1: Voyage → T2: Oracle → T3: Settle  ${c("cyan", "║")}
${c("cyan", "║")}                                                                           ${c("cyan", "║")}
${c("cyan", "║")}  ${c("green", "✓")} Full lifecycle completed on Hardhat local network                    ${c("cyan", "║")}
${c("cyan", "║")}  ${c("green", "✓")} Ready for deployment to Flare Coston2 testnet                        ${c("cyan", "║")}
${c("cyan", "╚═══════════════════════════════════════════════════════════════════════════╝")}
`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
