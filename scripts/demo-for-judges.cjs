#!/usr/bin/env node

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  POSEIDON MARITIME RISK PROTOCOL - JUDGE DEMO                             ║
 * ║                                                                            ║
 * ║  This interactive demo walks through the complete lifecycle of a          ║
 * ║  maritime risk prediction market on Flare Network.                        ║
 * ║                                                                            ║
 * ║  Run: npx hardhat run scripts/demo-for-judges.cjs --network hardhat       ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

const { ethers } = require("hardhat");
const readline = require("readline");

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

function printHeader() {
  console.log(`
${c("cyan", "╔═══════════════════════════════════════════════════════════════════════════╗")}
${c("cyan", "║")}  ${c("bright", "🔱 POSEIDON MARITIME RISK PROTOCOL")}                                      ${c("cyan", "║")}
${c("cyan", "║")}                                                                           ${c("cyan", "║")}
${c("cyan", "║")}  ${c("gray", "On-chain Maritime Risk Hedging on Flare Network")}                          ${c("cyan", "║")}
${c("cyan", "║")}  ${c("gray", "ETH Oxford 2026 Hackathon Demo")}                                           ${c("cyan", "║")}
${c("cyan", "╚═══════════════════════════════════════════════════════════════════════════╝")}
`);
}

function printPhase(phase, title, description) {
  console.log(`
${c("yellow", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}
${c("magenta", `  [${phase}]`)} ${c("bright", title)}
${c("gray", `  ${description}`)}
${c("yellow", "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}
`);
}

async function waitForKey(prompt = "Press ENTER to continue...") {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(c("cyan", `\n  → ${prompt}`), () => {
      rl.close();
      resolve();
    });
  });
}

function formatFLR(bn) {
  return `${ethers.formatEther(bn)} FLR`;
}

async function main() {
  printHeader();
  
  console.log(c("gray", "  This demo shows the complete lifecycle of a maritime risk prediction market."));
  console.log(c("gray", "  Each phase requires you to press ENTER to proceed.\n"));
  
  await waitForKey("Press ENTER to start the demo...");

  // Get signers
  const [deployer, hedger, cp1, cp2, oracle] = await ethers.getSigners();
  
  console.log(`\n  ${c("green", "✓")} Accounts loaded:`);
  console.log(`    Deployer: ${c("cyan", deployer.address.slice(0, 10))}...`);
  console.log(`    Hedger:   ${c("cyan", hedger.address.slice(0, 10))}...`);
  console.log(`    CP1:      ${c("cyan", cp1.address.slice(0, 10))}...`);
  console.log(`    CP2:      ${c("cyan", cp2.address.slice(0, 10))}...`);
  console.log(`    Oracle:   ${c("cyan", oracle.address.slice(0, 10))}...`);

  // Deploy contract
  printPhase("SETUP", "Deploying PoseidonVault Contract", "Smart contract deployment to Flare Network");
  
  await waitForKey();
  
  const PoseidonVault = await ethers.getContractFactory("PoseidonVault");
  const vault = await PoseidonVault.deploy();
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  
  console.log(`  ${c("green", "✓")} Contract deployed at: ${c("cyan", vaultAddress)}`);
  
  // Setup roles
  await vault.setOracle(oracle.address);
  console.log(`  ${c("green", "✓")} Oracle role assigned`);

  // Fund accounts
  const depositAmount = ethers.parseEther("500");
  await vault.connect(hedger).deposit({ value: depositAmount });
  await vault.connect(cp1).deposit({ value: depositAmount });
  await vault.connect(cp2).deposit({ value: depositAmount });
  console.log(`  ${c("green", "✓")} Accounts funded with ${formatFLR(depositAmount)} each`);

  // ════════════════════════════════════════════════════════════════════════════
  // T-1: COMMITMENT PHASE
  // ════════════════════════════════════════════════════════════════════════════
  
  printPhase("T-1", "COMMITMENT PHASE", "Hedger posts RFQ, counterparties submit bids");
  
  await waitForKey("Press ENTER to create market and hedge request...");

  // Create market
  const now = Math.floor(Date.now() / 1000);
  await vault.createMarket(
    "9876543",
    "MV Pacific Sentinel",
    0, // PSC_DETENTION
    now + 3600,  // Commitment deadline
    now + 7200,  // Departure
    now + 86400  // Arrival
  );
  
  console.log(`
  ${c("green", "✓")} Market Created:
    ${c("gray", "Vessel:")}     MV Pacific Sentinel (IMO: 9876543)
    ${c("gray", "Route:")}      Shanghai → Rotterdam
    ${c("gray", "Risk Type:")}  PSC Detention
    ${c("gray", "Voyage:")}     ~14 days
`);

  // Hedger creates RFQ
  const hedgeAmount = ethers.parseEther("10"); // $10 (scaled for demo)
  const minBid = ethers.parseEther("2");
  const yesPrice = ethers.parseEther("0.85");
  
  await vault.connect(hedger).createHedgeRequest(0, hedgeAmount, minBid, yesPrice);
  
  console.log(`  ${c("green", "✓")} Hedge Request Created:
    ${c("gray", "Amount:")}    $${ethers.formatEther(hedgeAmount)} to hedge
    ${c("gray", "Min Bid:")}   $${ethers.formatEther(minBid)}
    ${c("gray", "YES Price:")} ${Number(ethers.formatEther(yesPrice)) * 100}¢ per share
`);

  await waitForKey("Press ENTER for counterparties to submit bids...");

  // Counterparties bid
  await vault.connect(cp1).submitBid(0, ethers.parseEther("5"), ethers.parseEther("0.15"));
  console.log(`  ${c("green", "✓")} CP1 bid: $5.00 @ 15¢ NO price`);
  
  await vault.connect(cp2).submitBid(0, ethers.parseEther("5"), ethers.parseEther("0.14"));
  console.log(`  ${c("green", "✓")} CP2 bid: $5.00 @ 14¢ NO price`);

  await waitForKey("Press ENTER for hedger to accept bids...");

  // Accept bids
  await vault.connect(hedger).acceptBid(0, 0);
  await vault.connect(hedger).acceptBid(0, 1);
  
  const req = await vault.getHedgeRequest(0);
  console.log(`  ${c("green", "✓")} Bids accepted! Filled: $${ethers.formatEther(req.filledAmount)}`);

  // ════════════════════════════════════════════════════════════════════════════
  // T0: DEPARTURE
  // ════════════════════════════════════════════════════════════════════════════
  
  printPhase("T0", "VESSEL DEPARTURE", "Oracle confirms departure, shares are emitted automatically");
  
  await waitForKey("Press ENTER for oracle to confirm departure...");

  await vault.connect(oracle).confirmDeparture(0);
  
  const market = await vault.getMarket(0);
  const hedgerPos = await vault.getPosition(0, hedger.address);
  const cp1Pos = await vault.getPosition(0, cp1.address);
  const cp2Pos = await vault.getPosition(0, cp2.address);
  
  console.log(`
  ${c("green", "✓")} Departure Confirmed! Shares Emitted:
  
    ${c("bright", "Market State:")}
      Total YES:     ${ethers.formatEther(market.totalYesShares)} shares
      Total NO:      ${ethers.formatEther(market.totalNoShares)} shares
      Collateral:    ${formatFLR(market.totalCollateral)}
    
    ${c("bright", "Positions:")}
      Hedger:  ${ethers.formatEther(hedgerPos.yesShares)} YES shares ${c("gray", "(betting vessel WILL be detained)")}
      CP1:     ${ethers.formatEther(cp1Pos.noShares)} NO shares  ${c("gray", "(betting vessel WON'T be detained)")}
      CP2:     ${ethers.formatEther(cp2Pos.noShares)} NO shares  ${c("gray", "(betting vessel WON'T be detained)")}
`);

  // ════════════════════════════════════════════════════════════════════════════
  // T1: VOYAGE ACTIVE
  // ════════════════════════════════════════════════════════════════════════════
  
  printPhase("T1", "VOYAGE ACTIVE", "Vessel underway, shares locked, no trading allowed");
  
  console.log(`
  ${c("gray", "  ⚓ Vessel is now sailing from Shanghai to Rotterdam...")}
  ${c("gray", "  📡 Monitoring for Port State Control inspection events...")}
  ${c("gray", "  🔒 Shares are locked - no trading during voyage")}
`);
  
  await waitForKey("Press ENTER when vessel arrives at port...");

  // ════════════════════════════════════════════════════════════════════════════
  // T2: ORACLE DATA
  // ════════════════════════════════════════════════════════════════════════════
  
  printPhase("T2", "ORACLE DATA SUBMISSION", "Submit outcome from Datalastic API (synthetic for demo)");
  
  console.log(`
  ${c("gray", "  Checking Datalastic API for PSC inspection results...")}
  ${c("gray", "  Endpoint: /maritime_reports/inspections?imo=9876543")}
`);
  
  await waitForKey("Press ENTER to submit oracle outcome...");

  // For demo, randomly decide outcome
  const yesWins = Math.random() > 0.5;
  const outcomeData = {
    detained: yesWins,
    port: "NLRTM",
    deficiencies: yesWins ? 5 : 0,
    inspector: "Netherlands Shipping Inspectorate",
  };
  const dataHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(outcomeData)));
  
  await vault.connect(oracle).submitSyntheticOutcome(0, yesWins, dataHash);
  
  console.log(`
  ${c("green", "✓")} Oracle Data Submitted (SYNTHETIC - Undisputable):
  
    ${c("bright", "Inspection Result:")}
      Port:         Rotterdam (NLRTM)
      Detained:     ${yesWins ? c("yellow", "YES - DETAINED") : c("green", "NO - PASSED")}
      Deficiencies: ${outcomeData.deficiencies}
    
    ${c("bright", "Market Outcome:")}
      Winner: ${yesWins ? c("yellow", "YES") : c("green", "NO")} - ${yesWins ? "Hedger wins!" : "Counterparties win!"}
`);

  // ════════════════════════════════════════════════════════════════════════════
  // T3: SETTLEMENT
  // ════════════════════════════════════════════════════════════════════════════
  
  printPhase("T3", "SETTLEMENT & CLAIMS", "Market settles, winners claim payouts (minus 2% fee)");
  
  await waitForKey("Press ENTER to settle market...");

  await vault.settle(0);
  console.log(`  ${c("green", "✓")} Market settled!`);

  await waitForKey("Press ENTER for winners to claim...");

  // Claims
  if (yesWins) {
    const balBefore = await vault.getBalance(hedger.address);
    await vault.connect(hedger).claim(0);
    const balAfter = await vault.getBalance(hedger.address);
    const payout = balAfter - balBefore;
    
    console.log(`  ${c("green", "✓")} Hedger claimed: ${formatFLR(payout)}`);
    console.log(`    ${c("gray", "The hedge worked! Hedger was protected from the detention event.")}`);
  } else {
    const bal1Before = await vault.getBalance(cp1.address);
    await vault.connect(cp1).claim(0);
    const bal1After = await vault.getBalance(cp1.address);
    
    const bal2Before = await vault.getBalance(cp2.address);
    await vault.connect(cp2).claim(0);
    const bal2After = await vault.getBalance(cp2.address);
    
    console.log(`  ${c("green", "✓")} CP1 claimed: ${formatFLR(bal1After - bal1Before)}`);
    console.log(`  ${c("green", "✓")} CP2 claimed: ${formatFLR(bal2After - bal2Before)}`);
    console.log(`    ${c("gray", "Counterparties earned premium - vessel was not detained.")}`);
  }

  const fees = await vault.protocolFees();
  console.log(`  ${c("green", "✓")} Protocol fees collected: ${formatFLR(fees)}`);

  // ════════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ════════════════════════════════════════════════════════════════════════════
  
  console.log(`
${c("cyan", "╔═══════════════════════════════════════════════════════════════════════════╗")}
${c("cyan", "║")}  ${c("bright", "🎉 DEMO COMPLETE!")}                                                       ${c("cyan", "║")}
${c("cyan", "╠═══════════════════════════════════════════════════════════════════════════╣")}
${c("cyan", "║")}                                                                           ${c("cyan", "║")}
${c("cyan", "║")}  ${c("green", "✓")} Market creation with vessel-specific risk parameters               ${c("cyan", "║")}
${c("cyan", "║")}  ${c("green", "✓")} RFQ-based hedger/counterparty matching                             ${c("cyan", "║")}
${c("cyan", "║")}  ${c("green", "✓")} Oracle-triggered share emission on departure                       ${c("cyan", "║")}
${c("cyan", "║")}  ${c("green", "✓")} Synthetic data submission (undisputable for demo)                  ${c("cyan", "║")}
${c("cyan", "║")}  ${c("green", "✓")} On-chain settlement with 2% protocol fee                          ${c("cyan", "║")}
${c("cyan", "║")}  ${c("green", "✓")} Winner claims via proportional share allocation                    ${c("cyan", "║")}
${c("cyan", "║")}                                                                           ${c("cyan", "║")}
${c("cyan", "║")}  ${c("gray", "Built on Flare Network with FTSO price feeds")}                          ${c("cyan", "║")}
${c("cyan", "║")}  ${c("gray", "FDC ready for production (Web2Json attestation)")}                       ${c("cyan", "║")}
${c("cyan", "║")}                                                                           ${c("cyan", "║")}
${c("cyan", "╚═══════════════════════════════════════════════════════════════════════════╝")}
`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
