#!/usr/bin/env node

/**
 * Poseidon Simulation CLI Tool
 * 
 * Simulates the full T-1 → T0 → T1 → T2 → T3 lifecycle for maritime risk prediction markets.
 * 
 * Commands:
 *   init      - Deploy contract and create 10 markets in COMMITMENT_OPEN state
 *   commit    - Submit hedger + counterparty commitments (T-1)
 *   match     - Accept bids, lock counterparties
 *   depart    - Confirm departure, emit shares (T0)
 *   oracle    - Submit synthetic outcomes (T2)
 *   settle    - Execute settlement for all markets (T3)
 *   claim     - Process claims for winners
 *   status    - Show all market states
 *   run-all   - Execute full T-1 → T3 pipeline
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "simulation-data.json");
const STATE_FILE = path.join(__dirname, "simulation-state.json");

// Load simulation data
function loadData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

// Load/save state
function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  }
  return { phase: "INIT", contractAddress: null, markets: [] };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// Get contract instance
async function getContract(state) {
  if (!state.contractAddress) {
    throw new Error("Contract not deployed. Run 'init' first.");
  }
  const PoseidonVault = await ethers.getContractFactory("PoseidonVault");
  return PoseidonVault.attach(state.contractAddress);
}

// Format big numbers for display
function formatUSD(bn) {
  return `$${ethers.formatUnits(bn, 18)}`;
}

function formatFLR(bn) {
  return `${ethers.formatEther(bn)} FLR`;
}

// ============================================================
// COMMANDS
// ============================================================

async function cmdInit() {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  POSEIDON SIMULATION - INIT");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const data = loadData();
  const state = loadState();

  // Get signers
  const [deployer, ...accounts] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Available accounts: ${accounts.length + 1}`);

  // Deploy contract
  console.log("\n[1/2] Deploying PoseidonVault...");
  const PoseidonVault = await ethers.getContractFactory("PoseidonVault");
  const vault = await PoseidonVault.deploy();
  await vault.waitForDeployment();
  
  const contractAddress = await vault.getAddress();
  console.log(`    Contract deployed at: ${contractAddress}`);

  // Create markets
  console.log("\n[2/2] Creating 10 markets...");
  const marketStates = [];
  
  // Use relative timestamps from now
  const now = Math.floor(Date.now() / 1000);
  
  for (const vessel of data.vessels) {
    // Relative timestamps: T-1 in 1 hour, T0 in 2 hours, T2 in 3 hours
    const offset = (vessel.id - 1) * 600; // Stagger by 10 min
    const commitmentDeadline = now + 3600 + offset;  // +1 hour
    const departureTime = now + 7200 + offset;       // +2 hours
    const arrivalTime = now + 10800 + offset;        // +3 hours
    
    const tx = await vault.createMarket(
      vessel.imo,
      vessel.name,
      vessel.riskType,
      commitmentDeadline,
      departureTime,
      arrivalTime
    );
    await tx.wait();

    marketStates.push({
      id: vessel.id - 1, // 0-indexed
      imo: vessel.imo,
      name: vessel.name,
      state: "COMMITMENT_OPEN",
      yesWins: vessel.syntheticOutcome.yesWins
    });

    console.log(`    ✓ Market ${vessel.id}: ${vessel.name} (${vessel.riskTypeName})`);
  }

  // Save state
  state.phase = "COMMITMENT_OPEN";
  state.contractAddress = contractAddress;
  state.markets = marketStates;
  state.lastRun = new Date().toISOString();
  saveState(state);

  console.log("\n✅ Init complete. 10 markets created in COMMITMENT_OPEN state.");
  console.log(`   Contract: ${contractAddress}`);
}

async function cmdCommit() {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  POSEIDON SIMULATION - COMMIT (T-1 Phase)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const data = loadData();
  const state = loadState();
  const vault = await getContract(state);

  const [deployer, ...accounts] = await ethers.getSigners();
  
  // Fund accounts and create deposits
  console.log("[1/3] Funding accounts...");
  const uniqueAddresses = new Set();
  
  for (const vessel of data.vessels) {
    uniqueAddresses.add(vessel.hedger.address.toLowerCase());
    for (const cp of vessel.counterparties) {
      uniqueAddresses.add(cp.address.toLowerCase());
    }
  }

  // For simulation, use what's available (Hardhat gives ~10k ETH)
  const depositAmount = ethers.parseEther("8000"); // 8000 FLR
  
  console.log(`    Depositing ${formatFLR(depositAmount)} for simulation...`);
  const depositTx = await vault.deposit({ value: depositAmount.toString() });
  await depositTx.wait();
  console.log(`    ✓ Deployer deposit complete (${formatFLR(depositAmount)})`);

  // Create hedge requests for each market
  // Scale down to simulation amounts: ~$10 per market
  console.log("\n[2/3] Creating hedge requests...");
  
  const SCALE_FACTOR = 5000n; // Divide by 5000 to get ~$10 amounts
  
  for (const vessel of data.vessels) {
    const marketId = vessel.id - 1;
    const h = vessel.hedger;
    
    // Scale down amounts
    const amountToHedge = BigInt(h.amountToHedge) / SCALE_FACTOR;
    const minBidSize = BigInt(h.minBidSize) / SCALE_FACTOR;
    
    try {
      const tx = await vault.createHedgeRequest(
        marketId,
        amountToHedge,
        minBidSize,
        h.yesPrice
      );
      await tx.wait();
      console.log(`    ✓ Market ${vessel.id}: Hedge request created (${formatUSD(amountToHedge)})`);
    } catch (err) {
      console.log(`    ✗ Market ${vessel.id}: ${err.message}`);
    }
  }

  // Submit counterparty bids (scaled down)
  console.log("\n[3/3] Submitting counterparty bids...");
  
  for (const vessel of data.vessels) {
    const marketId = vessel.id - 1;
    
    for (let i = 0; i < vessel.counterparties.length; i++) {
      const cp = vessel.counterparties[i];
      const bidAmount = BigInt(cp.bidAmount) / SCALE_FACTOR;
      
      try {
        const tx = await vault.submitBid(
          marketId,
          bidAmount,
          cp.noPrice
        );
        await tx.wait();
        console.log(`    ✓ Market ${vessel.id}, Bid ${i + 1}: ${formatUSD(bidAmount)} @ ${ethers.formatUnits(cp.noPrice, 18)} NO price`);
      } catch (err) {
        console.log(`    ✗ Market ${vessel.id}, Bid ${i + 1}: ${err.message}`);
      }
    }
  }

  state.phase = "BIDS_SUBMITTED";
  state.lastRun = new Date().toISOString();
  saveState(state);

  console.log("\n✅ Commit phase complete. Hedge requests and bids submitted.");
}

async function cmdMatch() {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  POSEIDON SIMULATION - MATCH (Accept Bids)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const data = loadData();
  const state = loadState();
  const vault = await getContract(state);

  console.log("Accepting bids for each market...\n");

  for (const vessel of data.vessels) {
    const marketId = vessel.id - 1;
    const bidCount = await vault.getBidCount(marketId);
    
    console.log(`Market ${vessel.id} (${vessel.name}): ${bidCount} bids`);
    
    for (let i = 0; i < Number(bidCount); i++) {
      try {
        const tx = await vault.acceptBid(marketId, i);
        await tx.wait();
        console.log(`    ✓ Bid ${i + 1} accepted`);
      } catch (err) {
        console.log(`    ✗ Bid ${i + 1}: ${err.message}`);
      }
    }
  }

  state.phase = "BIDS_ACCEPTED";
  state.lastRun = new Date().toISOString();
  saveState(state);

  console.log("\n✅ Match phase complete. All eligible bids accepted.");
}

async function cmdDepart() {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  POSEIDON SIMULATION - DEPART (T0 - Emit Shares)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const data = loadData();
  const state = loadState();
  const vault = await getContract(state);

  console.log("Confirming departure and emitting shares...\n");

  for (const vessel of data.vessels) {
    const marketId = vessel.id - 1;
    
    try {
      const tx = await vault.confirmDeparture(marketId);
      await tx.wait();
      
      const market = await vault.getMarket(marketId);
      console.log(`✓ Market ${vessel.id}: ${vessel.name}`);
      console.log(`    YES Shares: ${ethers.formatUnits(market.totalYesShares, 18)}`);
      console.log(`    NO Shares:  ${ethers.formatUnits(market.totalNoShares, 18)}`);
      console.log(`    Collateral: ${formatFLR(market.totalCollateral)}`);
      console.log(`    State: VOYAGE_ACTIVE\n`);
      
      state.markets[marketId].state = "VOYAGE_ACTIVE";
    } catch (err) {
      console.log(`✗ Market ${vessel.id}: ${err.message}\n`);
    }
  }

  state.phase = "VOYAGE_ACTIVE";
  state.lastRun = new Date().toISOString();
  saveState(state);

  console.log("✅ Departure phase complete. Shares emitted to all committed parties.");
}

async function cmdOracle() {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  POSEIDON SIMULATION - ORACLE (T2 - Submit Outcomes)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const data = loadData();
  const state = loadState();
  const vault = await getContract(state);

  console.log("Submitting synthetic outcomes (UNDISPUTABLE)...\n");

  for (const vessel of data.vessels) {
    const marketId = vessel.id - 1;
    const outcome = vessel.syntheticOutcome.yesWins;
    const dataHash = vessel.syntheticOutcome.dataHash;
    
    try {
      const tx = await vault.submitSyntheticOutcome(
        marketId,
        outcome,
        dataHash
      );
      await tx.wait();
      
      const winner = outcome ? "YES" : "NO";
      console.log(`✓ Market ${vessel.id}: ${vessel.name}`);
      console.log(`    Outcome: ${winner} WINS`);
      console.log(`    Data Hash: ${dataHash.slice(0, 18)}...`);
      console.log(`    Source: SYNTHETIC (FINAL)\n`);
      
      state.markets[marketId].state = "PENDING_SETTLEMENT";
    } catch (err) {
      console.log(`✗ Market ${vessel.id}: ${err.message}\n`);
    }
  }

  state.phase = "PENDING_SETTLEMENT";
  state.lastRun = new Date().toISOString();
  saveState(state);

  console.log("✅ Oracle phase complete. Synthetic data is FINAL and UNDISPUTABLE.");
}

async function cmdSettle() {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  POSEIDON SIMULATION - SETTLE (T3)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const data = loadData();
  const state = loadState();
  const vault = await getContract(state);

  console.log("Settling all markets...\n");

  for (const vessel of data.vessels) {
    const marketId = vessel.id - 1;
    
    try {
      const tx = await vault.settle(marketId);
      await tx.wait();
      
      const market = await vault.getMarket(marketId);
      const winner = market.oracleData.outcome ? "YES" : "NO";
      
      console.log(`✓ Market ${vessel.id}: ${vessel.name} → ${winner} WINS`);
      
      state.markets[marketId].state = "SETTLED";
    } catch (err) {
      console.log(`✗ Market ${vessel.id}: ${err.message}`);
    }
  }

  state.phase = "SETTLED";
  state.lastRun = new Date().toISOString();
  saveState(state);

  console.log("\n✅ Settlement complete. Claims are now enabled.");
}

async function cmdClaim() {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  POSEIDON SIMULATION - CLAIM");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const state = loadState();
  const vault = await getContract(state);
  const [deployer] = await ethers.getSigners();

  console.log("Processing claims for deployer...\n");

  let totalClaimed = 0n;

  for (let marketId = 0; marketId < 10; marketId++) {
    try {
      const position = await vault.getPosition(marketId, deployer.address);
      const market = await vault.getMarket(marketId);
      
      const winningShares = market.oracleData.outcome ? position.yesShares : position.noShares;
      
      if (winningShares > 0n && !position.claimed) {
        const balanceBefore = await vault.getBalance(deployer.address);
        
        const tx = await vault.claim(marketId);
        await tx.wait();
        
        const balanceAfter = await vault.getBalance(deployer.address);
        const payout = balanceAfter - balanceBefore;
        totalClaimed += payout;
        
        console.log(`✓ Market ${marketId + 1}: Claimed ${formatFLR(payout)}`);
      }
    } catch (err) {
      // No winning shares or already claimed
    }
  }

  console.log(`\nTotal claimed: ${formatFLR(totalClaimed)}`);
  console.log("\n✅ Claims processed.");
}

async function cmdStatus() {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  POSEIDON SIMULATION - STATUS");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const state = loadState();
  
  if (!state.contractAddress) {
    console.log("Contract not deployed. Run 'init' first.");
    return;
  }

  const vault = await getContract(state);

  console.log(`Contract: ${state.contractAddress}`);
  console.log(`Current Phase: ${state.phase}`);
  console.log(`Last Run: ${state.lastRun}\n`);

  console.log("Markets:");
  console.log("─".repeat(80));
  console.log(`${"ID".padEnd(4)} ${"Vessel".padEnd(25)} ${"State".padEnd(20)} ${"Outcome".padEnd(10)}`);
  console.log("─".repeat(80));

  for (let i = 0; i < 10; i++) {
    const market = await vault.getMarket(i);
    const stateNames = ["COMMITMENT_OPEN", "VOYAGE_ACTIVE", "PENDING_SETTLEMENT", "SETTLED"];
    const stateName = stateNames[Number(market.state)];
    
    let outcome = "—";
    if (market.state === 3n) {
      outcome = market.oracleData.outcome ? "YES" : "NO";
    }

    console.log(
      `${(i + 1).toString().padEnd(4)} ` +
      `${market.vesselName.slice(0, 24).padEnd(25)} ` +
      `${stateName.padEnd(20)} ` +
      `${outcome.padEnd(10)}`
    );
  }

  console.log("─".repeat(80));

  // Protocol fees
  const fees = await vault.protocolFees();
  console.log(`\nProtocol Fees Collected: ${formatFLR(fees)}`);
}

async function cmdRunAll() {
  console.log("\n╔═══════════════════════════════════════════════════════════════╗");
  console.log("║  POSEIDON SIMULATION - FULL PIPELINE                          ║");
  console.log("║  T-1 → T0 → T2 → T3                                           ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝\n");

  await cmdInit();
  console.log("\n" + "═".repeat(65) + "\n");
  
  await cmdCommit();
  console.log("\n" + "═".repeat(65) + "\n");
  
  await cmdMatch();
  console.log("\n" + "═".repeat(65) + "\n");
  
  await cmdDepart();
  console.log("\n" + "═".repeat(65) + "\n");
  
  await cmdOracle();
  console.log("\n" + "═".repeat(65) + "\n");
  
  await cmdSettle();
  console.log("\n" + "═".repeat(65) + "\n");
  
  await cmdClaim();
  console.log("\n" + "═".repeat(65) + "\n");
  
  await cmdStatus();

  console.log("\n╔═══════════════════════════════════════════════════════════════╗");
  console.log("║  SIMULATION COMPLETE                                          ║");
  console.log("╚═══════════════════════════════════════════════════════════════╝\n");
}

// Main entry point
async function main() {
  // Check env var first, then argv (hardhat strips args after --)
  const command = process.env.POSEIDON_CMD || process.argv[2] || "help";

  const commands = {
    "init": cmdInit,
    "commit": cmdCommit,
    "match": cmdMatch,
    "depart": cmdDepart,
    "oracle": cmdOracle,
    "settle": cmdSettle,
    "claim": cmdClaim,
    "status": cmdStatus,
    "run-all": cmdRunAll,
  };

  if (commands[command]) {
    try {
      await commands[command]();
    } catch (err) {
      console.error(`\n❌ Error: ${err.message}`);
      process.exit(1);
    }
  } else {
    console.log(`
Poseidon Simulation CLI

Usage: npx hardhat run scripts/simulation/poseidon-sim.cjs [command]

Commands:
  init      Deploy contract and create 10 markets
  commit    Submit hedger requests and counterparty bids (T-1)
  match     Accept bids, lock counterparties
  depart    Confirm departure, emit shares (T0)
  oracle    Submit synthetic outcomes (T2)
  settle    Execute settlement (T3)
  claim     Process winner claims
  status    Show all market states
  run-all   Execute full simulation pipeline
`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
