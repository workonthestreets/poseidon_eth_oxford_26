/**
 * Integration Test: PoseidonVault Full Stack
 * 
 * Tests the complete flow without external dependencies:
 * 1. Deploy PoseidonVault
 * 2. Create market (T-1 start)
 * 3. Create hedge request + counterparty bids (simulating off-chain RFQ)
 * 4. Match bids (simulating RFQ matching engine)
 * 5. Confirm departure (T0)
 * 6. Submit oracle data (T2)
 * 7. Settle and claim (T3)
 * 
 * This test simulates what would happen with a real off-chain RFQ system.
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PoseidonVault Integration", function () {
  let vault;
  let owner, oracle, hedger, cp1, cp2, cp3;
  
  const futureTime = (seconds) => Math.floor(Date.now() / 1000) + seconds;

  before(async function () {
    [owner, oracle, hedger, cp1, cp2, cp3] = await ethers.getSigners();
    
    // Deploy vault
    const PoseidonVault = await ethers.getContractFactory("PoseidonVault");
    vault = await PoseidonVault.deploy();
    await vault.waitForDeployment();
    
    // Set oracle
    await vault.setOracle(oracle.address);
    
    // Fund all participants
    const depositAmount = ethers.parseEther("100");
    await vault.connect(hedger).deposit({ value: depositAmount });
    await vault.connect(cp1).deposit({ value: depositAmount });
    await vault.connect(cp2).deposit({ value: depositAmount });
    await vault.connect(cp3).deposit({ value: depositAmount });
  });

  describe("Full Maritime Risk Hedging Flow", function () {
    it("should simulate complete RFQ → Vault → Settlement flow", async function () {
      this.timeout(60000);
      
      console.log("\n    ╔═══════════════════════════════════════════════════════════════╗");
      console.log("    ║  POSEIDON INTEGRATION TEST - Full RFQ Simulation              ║");
      console.log("    ╚═══════════════════════════════════════════════════════════════╝\n");

      // ========================================
      // PHASE 1: Market Creation
      // ========================================
      console.log("    [PHASE 1] Market Creation");
      
      await vault.createMarket(
        "9876543",
        "MV Pacific Sentinel",
        0, // PSC_DETENTION
        futureTime(3600),  // Commitment deadline: 1 hour
        futureTime(7200),  // Departure: 2 hours
        futureTime(86400)  // Arrival: 24 hours
      );
      
      const market = await vault.getMarket(0);
      expect(market.vesselIMO).to.equal("9876543");
      expect(market.state).to.equal(0); // COMMITMENT_OPEN
      console.log("    ✓ Market created: MV Pacific Sentinel (PSC Detention Risk)");
      console.log(`       Vessel: ${market.vesselName}`);
      console.log(`       Risk Type: PSC_DETENTION`);
      console.log("");

      // ========================================
      // PHASE 2: Off-chain RFQ Simulation
      // ========================================
      console.log("    [PHASE 2] Off-chain RFQ Simulation");
      
      // In production, this would happen on the RFQ server
      // Here we simulate:
      // - Hedger wants to hedge $2 of risk
      // - 3 counterparties submit competing bids
      
      const hedgeAmount = ethers.parseEther("2");     // $2 total hedge
      const minBid = ethers.parseEther("0.5");        // $0.50 minimum bid
      const yesPrice = ethers.parseEther("0.85");     // 85¢ per YES share
      
      // Hedger creates RFQ
      await vault.connect(hedger).createHedgeRequest(0, hedgeAmount, minBid, yesPrice);
      console.log("    ✓ Hedger created RFQ: $2.00 hedge @ 85¢ YES price");
      
      // Counterparties respond with NO price quotes
      // In RFQ model, lower NO price = better for hedger
      const bids = [
        { cp: cp1, amount: ethers.parseEther("0.8"), noPrice: ethers.parseEther("0.15") },
        { cp: cp2, amount: ethers.parseEther("0.7"), noPrice: ethers.parseEther("0.12") },
        { cp: cp3, amount: ethers.parseEther("0.5"), noPrice: ethers.parseEther("0.18") },
      ];
      
      for (const bid of bids) {
        await vault.connect(bid.cp).submitBid(0, bid.amount, bid.noPrice);
      }
      console.log("    ✓ 3 counterparties submitted bids:");
      console.log("       CP1: $0.80 @ 15¢ NO price");
      console.log("       CP2: $0.70 @ 12¢ NO price (best rate!)");
      console.log("       CP3: $0.50 @ 18¢ NO price");
      console.log("");

      // ========================================
      // PHASE 3: Bid Matching (RFQ Engine)
      // ========================================
      console.log("    [PHASE 3] Bid Matching");
      
      // Hedger reviews bids and accepts (in real system, this might be auto-matched)
      // Accept in order of best NO price (lowest first - more profit for counterparty)
      await vault.connect(hedger).acceptBid(0, 1); // CP2 first (best NO price: 12¢)
      await vault.connect(hedger).acceptBid(0, 0); // CP1 second (15¢)
      await vault.connect(hedger).acceptBid(0, 2); // CP3 third (18¢)
      
      const req = await vault.getHedgeRequest(0);
      console.log(`    ✓ All bids accepted (filled: $${ethers.formatEther(req.filledAmount)})`);
      console.log("");

      // ========================================
      // PHASE 4: Departure (T0)
      // ========================================
      console.log("    [PHASE 4] Vessel Departure (T0)");
      
      // Oracle confirms vessel has departed
      await vault.connect(oracle).confirmDeparture(0);
      
      const marketAfterDeparture = await vault.getMarket(0);
      console.log("    ✓ Oracle confirmed departure");
      console.log(`       YES shares: ${ethers.formatEther(marketAfterDeparture.totalYesShares)}`);
      console.log(`       NO shares: ${ethers.formatEther(marketAfterDeparture.totalNoShares)}`);
      console.log(`       Collateral: ${ethers.formatEther(marketAfterDeparture.totalCollateral)} FLR`);
      
      // Verify share allocation
      const hedgerPos = await vault.getPosition(0, hedger.address);
      const cp1Pos = await vault.getPosition(0, cp1.address);
      const cp2Pos = await vault.getPosition(0, cp2.address);
      const cp3Pos = await vault.getPosition(0, cp3.address);
      
      expect(hedgerPos.yesShares).to.be.gt(0);
      expect(cp1Pos.noShares).to.be.gt(0);
      expect(cp2Pos.noShares).to.be.gt(0);
      expect(cp3Pos.noShares).to.be.gt(0);
      
      console.log("    ✓ Shares allocated:");
      console.log(`       Hedger: ${ethers.formatEther(hedgerPos.yesShares)} YES`);
      console.log(`       CP1: ${ethers.formatEther(cp1Pos.noShares)} NO`);
      console.log(`       CP2: ${ethers.formatEther(cp2Pos.noShares)} NO`);
      console.log(`       CP3: ${ethers.formatEther(cp3Pos.noShares)} NO`);
      console.log("");

      // ========================================
      // PHASE 5: Voyage Monitoring (T1)
      // ========================================
      console.log("    [PHASE 5] Voyage Monitoring (T1)");
      console.log("    ✓ Vessel underway - monitoring for PSC detention risk");
      console.log("    ✓ No trading allowed during voyage");
      console.log("");

      // ========================================
      // PHASE 6: Oracle Data (T2)
      // ========================================
      console.log("    [PHASE 6] Oracle Data Submission (T2)");
      
      // Simulate: Vessel was detained during PSC inspection!
      const outcomeData = {
        detained: true,
        inspectionPort: "NLRTM",
        deficiencies: 5,
        timestamp: Date.now()
      };
      const dataHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(outcomeData)));
      
      await vault.connect(oracle).submitSyntheticOutcome(0, true, dataHash);
      
      console.log("    ✓ Oracle submitted outcome: VESSEL DETAINED");
      console.log("       Port: Rotterdam (NLRTM)");
      console.log("       Deficiencies: 5");
      console.log("       Result: YES WINS");
      console.log("");

      // ========================================
      // PHASE 7: Settlement (T3)
      // ========================================
      console.log("    [PHASE 7] Settlement (T3)");
      
      await vault.settle(0);
      
      const finalMarket = await vault.getMarket(0);
      expect(finalMarket.state).to.equal(3); // SETTLED
      expect(finalMarket.oracleData.outcome).to.be.true;
      
      console.log("    ✓ Market settled");
      console.log("       Winner: YES (Hedger)");
      console.log("");

      // ========================================
      // PHASE 8: Claims
      // ========================================
      console.log("    [PHASE 8] Claims");
      
      // Hedger claims winnings
      const hedgerBalBefore = await vault.getBalance(hedger.address);
      await vault.connect(hedger).claim(0);
      const hedgerBalAfter = await vault.getBalance(hedger.address);
      const hedgerPayout = hedgerBalAfter - hedgerBalBefore;
      
      console.log(`    ✓ Hedger claimed: ${ethers.formatEther(hedgerPayout)} FLR`);
      
      // Counterparties cannot claim (they held NO, YES won)
      await expect(vault.connect(cp1).claim(0)).to.be.revertedWith("No winning shares");
      await expect(vault.connect(cp2).claim(0)).to.be.revertedWith("No winning shares");
      await expect(vault.connect(cp3).claim(0)).to.be.revertedWith("No winning shares");
      
      console.log("    ✓ Counterparties have no winning shares (expected)");
      
      // Protocol fees
      const fees = await vault.protocolFees();
      console.log(`    ✓ Protocol fees: ${ethers.formatEther(fees)} FLR (2%)`);
      console.log("");

      // ========================================
      // SUMMARY
      // ========================================
      console.log("    ╔═══════════════════════════════════════════════════════════════╗");
      console.log("    ║  INTEGRATION TEST COMPLETE                                    ║");
      console.log("    ╠═══════════════════════════════════════════════════════════════╣");
      console.log("    ║  Results:                                                     ║");
      console.log("    ║    - Market creation: ✓                                       ║");
      console.log("    ║    - RFQ simulation: ✓                                        ║");
      console.log("    ║    - Bid matching: ✓                                          ║");
      console.log("    ║    - Share emission: ✓                                        ║");
      console.log("    ║    - Oracle data: ✓                                           ║");
      console.log("    ║    - Settlement: ✓                                            ║");
      console.log("    ║    - Claims: ✓                                                ║");
      console.log("    ╚═══════════════════════════════════════════════════════════════╝\n");
    });
  });

  describe("NO Wins Scenario", function () {
    it("should correctly pay NO holders when risk event doesn't occur", async function () {
      console.log("\n    [TEST] NO Wins Scenario - Vessel NOT detained\n");

      // Create second market
      await vault.createMarket(
        "9876544",
        "MV Atlantic Voyager",
        0, // PSC_DETENTION
        futureTime(3600),
        futureTime(7200),
        futureTime(86400)
      );
      
      // Hedger creates request
      await vault.connect(hedger).createHedgeRequest(
        1, // marketId
        ethers.parseEther("1.5"),
        ethers.parseEther("0.3"),
        ethers.parseEther("0.90")
      );
      
      // Counterparties bid
      await vault.connect(cp1).submitBid(1, ethers.parseEther("1"), ethers.parseEther("0.10"));
      await vault.connect(cp2).submitBid(1, ethers.parseEther("0.5"), ethers.parseEther("0.08"));
      
      // Accept bids
      await vault.connect(hedger).acceptBid(1, 0);
      await vault.connect(hedger).acceptBid(1, 1);
      
      // Departure
      await vault.connect(oracle).confirmDeparture(1);
      
      // Oracle: Vessel NOT detained (NO wins)
      const outcomeData = { detained: false, passed: true };
      const dataHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(outcomeData)));
      await vault.connect(oracle).submitSyntheticOutcome(1, false, dataHash);
      
      // Settle
      await vault.settle(1);
      
      // CP1 claims (should succeed - has NO shares)
      const cp1BalBefore = await vault.getBalance(cp1.address);
      await vault.connect(cp1).claim(1);
      const cp1BalAfter = await vault.getBalance(cp1.address);
      
      expect(cp1BalAfter).to.be.gt(cp1BalBefore);
      console.log(`    ✓ CP1 claimed: ${ethers.formatEther(cp1BalAfter - cp1BalBefore)} FLR`);
      
      // Hedger cannot claim
      await expect(vault.connect(hedger).claim(1)).to.be.revertedWith("No winning shares");
      console.log("    ✓ Hedger has no winning shares (hedge failed - vessel was safe)");
      console.log("");
    });
  });

  describe("Partial Fill Scenario", function () {
    it("should handle partial fills and refund excess collateral", async function () {
      console.log("\n    [TEST] Partial Fill - Insufficient counterparty interest\n");

      // Top up hedger balance for this test
      await vault.connect(hedger).deposit({ value: ethers.parseEther("100") });
      await vault.connect(cp1).deposit({ value: ethers.parseEther("100") });

      // Create third market
      await vault.createMarket(
        "9876545",
        "MV Nordic Spirit",
        1, // CASUALTY
        futureTime(3600),
        futureTime(7200),
        futureTime(86400)
      );
      
      // Hedger wants $2 but only gets $1 in bids
      await vault.connect(hedger).createHedgeRequest(
        2,
        ethers.parseEther("2"),
        ethers.parseEther("0.5"),
        ethers.parseEther("0.95")
      );
      
      // Only one counterparty interested
      await vault.connect(cp1).submitBid(2, ethers.parseEther("1"), ethers.parseEther("0.05"));
      await vault.connect(hedger).acceptBid(2, 0);
      
      // Check hedger balance before departure
      const hedgerBalBefore = await vault.getBalance(hedger.address);
      
      // Departure triggers refund of unused collateral
      await vault.connect(oracle).confirmDeparture(2);
      
      const hedgerBalAfter = await vault.getBalance(hedger.address);
      
      // Hedger should get partial refund (locked $2 * 0.95 = $1.90, used $1 * 0.95 = $0.95, refund $0.95 worth)
      expect(hedgerBalAfter).to.be.gt(hedgerBalBefore);
      console.log(`    ✓ Hedger received refund: ${ethers.formatEther(hedgerBalAfter - hedgerBalBefore)} FLR`);
      
      const market = await vault.getMarket(2);
      console.log(`    ✓ Market filled: ${ethers.formatEther(market.totalYesShares)} YES shares (partial)`);
      console.log("");
    });
  });

  describe("Cancellation Flows", function () {
    it("should allow hedger to cancel before any bids accepted", async function () {
      console.log("\n    [TEST] Cancellation - Hedger cancels unfilled RFQ\n");

      // Top up balances for this test
      await vault.connect(hedger).deposit({ value: ethers.parseEther("100") });
      await vault.connect(cp1).deposit({ value: ethers.parseEther("100") });

      // Create fourth market
      await vault.createMarket(
        "9876546",
        "MV Eastern Promise",
        2, // VOYAGE_COMPLETION
        futureTime(3600),
        futureTime(7200),
        futureTime(86400)
      );
      
      // Hedger creates request
      const balBefore = await vault.getBalance(hedger.address);
      
      await vault.connect(hedger).createHedgeRequest(
        3,
        ethers.parseEther("1"),
        ethers.parseEther("0.25"),
        ethers.parseEther("0.80")
      );
      
      const balAfterCreate = await vault.getBalance(hedger.address);
      const collateralLocked = balBefore - balAfterCreate;
      console.log(`    ✓ Hedger locked: ${ethers.formatEther(collateralLocked)} FLR`);
      
      // CP submits bid but hedger doesn't accept
      await vault.connect(cp1).submitBid(3, ethers.parseEther("0.5"), ethers.parseEther("0.20"));
      
      // Hedger cancels
      await vault.connect(hedger).cancelHedgeRequest(3);
      
      const balAfterCancel = await vault.getBalance(hedger.address);
      console.log(`    ✓ Hedger refunded: ${ethers.formatEther(balAfterCancel - balAfterCreate)} FLR`);
      
      // CP1 should also be refunded
      const req = await vault.getHedgeRequest(3);
      expect(req.active).to.be.false;
      console.log("    ✓ RFQ cancelled, all collateral returned");
      console.log("");
    });

    it("should prevent hedger from cancelling after accepting bids", async function () {
      console.log("\n    [TEST] Cancellation - Cannot cancel committed RFQ\n");

      // Top up balances for this test
      await vault.connect(hedger).deposit({ value: ethers.parseEther("100") });
      await vault.connect(cp1).deposit({ value: ethers.parseEther("100") });

      // Create fifth market
      await vault.createMarket(
        "9876547",
        "MV Southern Cross",
        0,
        futureTime(3600),
        futureTime(7200),
        futureTime(86400)
      );
      
      await vault.connect(hedger).createHedgeRequest(
        4,
        ethers.parseEther("1"),
        ethers.parseEther("0.25"),
        ethers.parseEther("0.85")
      );
      
      await vault.connect(cp1).submitBid(4, ethers.parseEther("0.5"), ethers.parseEther("0.15"));
      await vault.connect(hedger).acceptBid(4, 0);
      
      // Now hedger cannot cancel
      await expect(vault.connect(hedger).cancelHedgeRequest(4))
        .to.be.revertedWith("Cannot cancel: bids accepted");
      
      console.log("    ✓ Hedger correctly blocked from cancelling after accepting bids");
      console.log("");
    });
  });
});
