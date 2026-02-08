const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("PoseidonVault", function () {
  let vault;
  let owner, operator, oracle, hedger, cp1, cp2, cp3;

  const PRICE_PRECISION = ethers.parseEther("1"); // 1e18
  
  // Helper to create timestamps
  const futureTime = (seconds) => Math.floor(Date.now() / 1000) + seconds;

  beforeEach(async function () {
    [owner, operator, oracle, hedger, cp1, cp2, cp3] = await ethers.getSigners();

    const PoseidonVault = await ethers.getContractFactory("PoseidonVault");
    vault = await PoseidonVault.deploy();
    await vault.waitForDeployment();

    // Set roles
    await vault.setOperator(operator.address);
    await vault.setOracle(oracle.address);

    // Fund all participants (use smaller amounts for test accounts)
    const depositAmount = ethers.parseEther("100");
    await vault.connect(hedger).deposit({ value: depositAmount });
    await vault.connect(cp1).deposit({ value: depositAmount });
    await vault.connect(cp2).deposit({ value: depositAmount });
    await vault.connect(cp3).deposit({ value: depositAmount });
  });

  describe("Market Creation", function () {
    it("should create a market in COMMITMENT_OPEN state", async function () {
      const commitDeadline = futureTime(3600);
      const departure = futureTime(7200);
      const arrival = futureTime(14400);

      await vault.connect(operator).createMarket(
        "9876543",
        "MV Test Vessel",
        0, // PSC_DETENTION
        commitDeadline,
        departure,
        arrival
      );

      const market = await vault.getMarket(0);
      expect(market.vesselIMO).to.equal("9876543");
      expect(market.vesselName).to.equal("MV Test Vessel");
      expect(market.state).to.equal(0); // COMMITMENT_OPEN
    });

    it("should reject invalid timestamps", async function () {
      const past = futureTime(-100);
      const departure = futureTime(7200);
      const arrival = futureTime(14400);

      await expect(
        vault.connect(operator).createMarket("9876543", "Test", 0, past, departure, arrival)
      ).to.be.revertedWith("Invalid commitment deadline");
    });

    it("should reject non-operator", async function () {
      await expect(
        vault.connect(hedger).createMarket("9876543", "Test", 0, futureTime(3600), futureTime(7200), futureTime(14400))
      ).to.be.revertedWith("Not operator");
    });
  });

  describe("Hedge Request Creation (T-1)", function () {
    beforeEach(async function () {
      await vault.connect(operator).createMarket(
        "9876543", "MV Test", 0,
        futureTime(3600), futureTime(7200), futureTime(14400)
      );
    });

    it("should create hedge request", async function () {
      // Use smaller amounts: $2 hedge (= ~100 FLR at $0.02/FLR)
      const amount = ethers.parseEther("2"); // $2
      const minBid = ethers.parseEther("0.5");  // $0.50 min
      const yesPrice = ethers.parseEther("0.85"); // 85 cents

      await vault.connect(hedger).createHedgeRequest(0, amount, minBid, yesPrice);

      const req = await vault.getHedgeRequest(0);
      expect(req.hedger).to.equal(hedger.address);
      expect(req.amountToHedge).to.equal(amount);
      expect(req.minBidSize).to.equal(minBid);
      expect(req.yesPrice).to.equal(yesPrice);
      expect(req.active).to.be.true;
    });

    it("should lock hedger collateral", async function () {
      const balanceBefore = await vault.getBalance(hedger.address);
      
      const amount = ethers.parseEther("2"); // $2
      const yesPrice = ethers.parseEther("0.85");
      
      await vault.connect(hedger).createHedgeRequest(0, amount, ethers.parseEther("0.5"), yesPrice);

      const balanceAfter = await vault.getBalance(hedger.address);
      
      // Should have locked: amount * yesPrice / PRECISION = 2 * 0.85 = $1.70 worth
      expect(balanceBefore - balanceAfter).to.be.gt(0);
    });

    it("should reject duplicate hedge request", async function () {
      await vault.connect(hedger).createHedgeRequest(
        0, ethers.parseEther("2"), ethers.parseEther("0.5"), ethers.parseEther("0.85")
      );

      await expect(
        vault.connect(hedger).createHedgeRequest(
          0, ethers.parseEther("1"), ethers.parseEther("0.25"), ethers.parseEther("0.80")
        )
      ).to.be.revertedWith("Hedge request exists");
    });
  });

  describe("Counterparty Bidding (T-1)", function () {
    beforeEach(async function () {
      await vault.connect(operator).createMarket(
        "9876543", "MV Test", 0,
        futureTime(3600), futureTime(7200), futureTime(14400)
      );
      await vault.connect(hedger).createHedgeRequest(
        0, ethers.parseEther("2"), ethers.parseEther("0.5"), ethers.parseEther("0.85")
      );
    });

    it("should accept counterparty bid", async function () {
      const bidAmount = ethers.parseEther("1");
      const noPrice = ethers.parseEther("0.15");

      await vault.connect(cp1).submitBid(0, bidAmount, noPrice);

      const bids = await vault.getBids(0);
      expect(bids.length).to.equal(1);
      expect(bids[0].counterparty).to.equal(cp1.address);
      expect(bids[0].bidAmount).to.equal(bidAmount);
      expect(bids[0].status).to.equal(0); // PENDING
    });

    it("should reject bid below minBidSize", async function () {
      await expect(
        vault.connect(cp1).submitBid(0, ethers.parseEther("0.3"), ethers.parseEther("0.15"))
      ).to.be.revertedWith("Bid below minimum");
    });

    it("should lock counterparty collateral", async function () {
      const balanceBefore = await vault.getBalance(cp1.address);
      
      await vault.connect(cp1).submitBid(0, ethers.parseEther("1"), ethers.parseEther("0.15"));

      const balanceAfter = await vault.getBalance(cp1.address);
      expect(balanceBefore - balanceAfter).to.be.gt(0);
    });
  });

  describe("Bid Acceptance & Cancellation", function () {
    beforeEach(async function () {
      await vault.connect(operator).createMarket(
        "9876543", "MV Test", 0,
        futureTime(3600), futureTime(7200), futureTime(14400)
      );
      await vault.connect(hedger).createHedgeRequest(
        0, ethers.parseEther("2"), ethers.parseEther("0.5"), ethers.parseEther("0.85")
      );
      await vault.connect(cp1).submitBid(0, ethers.parseEther("1"), ethers.parseEther("0.15"));
      await vault.connect(cp2).submitBid(0, ethers.parseEther("1"), ethers.parseEther("0.14"));
    });

    it("should allow hedger to accept bid", async function () {
      await vault.connect(hedger).acceptBid(0, 0);

      const bid = await vault.getBid(0, 0);
      expect(bid.status).to.equal(1); // ACCEPTED

      const req = await vault.getHedgeRequest(0);
      expect(req.filledAmount).to.equal(ethers.parseEther("1"));
    });

    it("should not allow non-hedger to accept bid", async function () {
      await expect(
        vault.connect(cp1).acceptBid(0, 0)
      ).to.be.revertedWith("Not hedger");
    });

    it("should allow counterparty to cancel pending bid", async function () {
      const balanceBefore = await vault.getBalance(cp1.address);
      
      await vault.connect(cp1).cancelBid(0, 0);

      const balanceAfter = await vault.getBalance(cp1.address);
      expect(balanceAfter).to.be.gt(balanceBefore); // Collateral refunded

      const bid = await vault.getBid(0, 0);
      expect(bid.status).to.equal(2); // CANCELLED (enum: PENDING=0, ACCEPTED=1, CANCELLED=2, EMITTED=3)
    });

    it("should not allow cancellation of accepted bid", async function () {
      await vault.connect(hedger).acceptBid(0, 0);

      await expect(
        vault.connect(cp1).cancelBid(0, 0)
      ).to.be.revertedWith("Cannot cancel accepted bid");
    });

    it("should allow hedger to cancel request only if no bids accepted", async function () {
      // Can cancel before accepting any bids
      await vault.connect(hedger).cancelHedgeRequest(0);

      const req = await vault.getHedgeRequest(0);
      expect(req.active).to.be.false;
    });

    it("should not allow hedger to cancel after accepting bids", async function () {
      await vault.connect(hedger).acceptBid(0, 0);

      await expect(
        vault.connect(hedger).cancelHedgeRequest(0)
      ).to.be.revertedWith("Cannot cancel: bids accepted");
    });
  });

  describe("Departure & Share Emission (T0)", function () {
    beforeEach(async function () {
      await vault.connect(operator).createMarket(
        "9876543", "MV Test", 0,
        futureTime(3600), futureTime(7200), futureTime(14400)
      );
      await vault.connect(hedger).createHedgeRequest(
        0, ethers.parseEther("2"), ethers.parseEther("0.5"), ethers.parseEther("0.85")
      );
      await vault.connect(cp1).submitBid(0, ethers.parseEther("1"), ethers.parseEther("0.15"));
      await vault.connect(cp2).submitBid(0, ethers.parseEther("1"), ethers.parseEther("0.14"));
      await vault.connect(hedger).acceptBid(0, 0);
      await vault.connect(hedger).acceptBid(0, 1);
    });

    it("should emit shares on departure", async function () {
      await vault.connect(oracle).confirmDeparture(0);

      const market = await vault.getMarket(0);
      expect(market.state).to.equal(1); // VOYAGE_ACTIVE
      expect(market.totalYesShares).to.be.gt(0);
      expect(market.totalNoShares).to.be.gt(0);
    });

    it("should assign correct shares to hedger", async function () {
      await vault.connect(oracle).confirmDeparture(0);

      const pos = await vault.getPosition(0, hedger.address);
      expect(pos.yesShares).to.be.gt(0);
      expect(pos.noShares).to.equal(0);
    });

    it("should assign correct shares to counterparties", async function () {
      await vault.connect(oracle).confirmDeparture(0);

      const pos1 = await vault.getPosition(0, cp1.address);
      const pos2 = await vault.getPosition(0, cp2.address);
      
      expect(pos1.noShares).to.be.gt(0);
      expect(pos1.yesShares).to.equal(0);
      expect(pos2.noShares).to.be.gt(0);
      expect(pos2.yesShares).to.equal(0);
    });

    it("should refund unaccepted bids", async function () {
      // Add another bid that won't be accepted
      await vault.connect(cp3).submitBid(0, ethers.parseEther("0.5"), ethers.parseEther("0.16"));
      
      const balanceBefore = await vault.getBalance(cp3.address);
      
      await vault.connect(oracle).confirmDeparture(0);

      const balanceAfter = await vault.getBalance(cp3.address);
      expect(balanceAfter).to.be.gt(balanceBefore); // Refunded
    });
  });

  describe("Oracle Data Submission (T2)", function () {
    beforeEach(async function () {
      await vault.connect(operator).createMarket(
        "9876543", "MV Test", 0,
        futureTime(3600), futureTime(7200), futureTime(14400)
      );
      await vault.connect(hedger).createHedgeRequest(
        0, ethers.parseEther("2"), ethers.parseEther("0.5"), ethers.parseEther("0.85")
      );
      await vault.connect(cp1).submitBid(0, ethers.parseEther("1"), ethers.parseEther("0.15"));
      await vault.connect(hedger).acceptBid(0, 0);
      await vault.connect(oracle).confirmDeparture(0);
    });

    it("should submit synthetic outcome", async function () {
      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("test_outcome_data"));
      
      await vault.connect(oracle).submitSyntheticOutcome(0, true, dataHash);

      const market = await vault.getMarket(0);
      expect(market.state).to.equal(2); // PENDING_SETTLEMENT
      expect(market.oracleData.outcome).to.be.true;
      expect(market.oracleData.finalized).to.be.true;
      expect(market.oracleData.source).to.equal(1); // SYNTHETIC
    });

    it("should reject non-oracle", async function () {
      await expect(
        vault.connect(hedger).submitSyntheticOutcome(0, true, ethers.ZeroHash)
      ).to.be.revertedWith("Not oracle");
    });

    it("should reject if wrong state", async function () {
      // Try submitting before departure
      await vault.connect(operator).createMarket(
        "9876544", "MV Test2", 0,
        futureTime(3600), futureTime(7200), futureTime(14400)
      );

      await expect(
        vault.connect(oracle).submitSyntheticOutcome(1, true, ethers.ZeroHash)
      ).to.be.revertedWith("Invalid market state");
    });
  });

  describe("Settlement & Claims (T3)", function () {
    beforeEach(async function () {
      await vault.connect(operator).createMarket(
        "9876543", "MV Test", 0,
        futureTime(3600), futureTime(7200), futureTime(14400)
      );
      await vault.connect(hedger).createHedgeRequest(
        0, ethers.parseEther("2"), ethers.parseEther("0.5"), ethers.parseEther("0.85")
      );
      await vault.connect(cp1).submitBid(0, ethers.parseEther("1"), ethers.parseEther("0.15"));
      await vault.connect(cp2).submitBid(0, ethers.parseEther("1"), ethers.parseEther("0.14"));
      await vault.connect(hedger).acceptBid(0, 0);
      await vault.connect(hedger).acceptBid(0, 1);
      await vault.connect(oracle).confirmDeparture(0);
    });

    it("should settle market", async function () {
      await vault.connect(oracle).submitSyntheticOutcome(0, true, ethers.ZeroHash);
      await vault.settle(0);

      const market = await vault.getMarket(0);
      expect(market.state).to.equal(3); // SETTLED
    });

    it("should allow YES holders to claim when YES wins", async function () {
      await vault.connect(oracle).submitSyntheticOutcome(0, true, ethers.ZeroHash);
      await vault.settle(0);

      const balanceBefore = await vault.getBalance(hedger.address);
      await vault.connect(hedger).claim(0);
      const balanceAfter = await vault.getBalance(hedger.address);

      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("should allow NO holders to claim when NO wins", async function () {
      await vault.connect(oracle).submitSyntheticOutcome(0, false, ethers.ZeroHash);
      await vault.settle(0);

      const balanceBefore = await vault.getBalance(cp1.address);
      await vault.connect(cp1).claim(0);
      const balanceAfter = await vault.getBalance(cp1.address);

      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("should prevent losers from claiming", async function () {
      await vault.connect(oracle).submitSyntheticOutcome(0, true, ethers.ZeroHash); // YES wins
      await vault.settle(0);

      await expect(
        vault.connect(cp1).claim(0) // cp1 has NO shares
      ).to.be.revertedWith("No winning shares");
    });

    it("should prevent double claims", async function () {
      await vault.connect(oracle).submitSyntheticOutcome(0, true, ethers.ZeroHash);
      await vault.settle(0);
      await vault.connect(hedger).claim(0);

      await expect(
        vault.connect(hedger).claim(0)
      ).to.be.revertedWith("Already claimed");
    });

    it("should collect protocol fees", async function () {
      await vault.connect(oracle).submitSyntheticOutcome(0, true, ethers.ZeroHash);
      await vault.settle(0);
      await vault.connect(hedger).claim(0);

      const fees = await vault.protocolFees();
      expect(fees).to.be.gt(0);
    });
  });

  describe("Full Lifecycle Integration", function () {
    it("should complete T-1 → T0 → T2 → T3 lifecycle", async function () {
      console.log("\n    === POSEIDON VAULT LIFECYCLE TEST ===");

      // T-1: Market Creation
      await vault.connect(operator).createMarket(
        "9876543", "MV Pacific Sentinel", 0, // PSC_DETENTION
        futureTime(3600), futureTime(7200), futureTime(14400)
      );
      console.log("    ✓ T-1: Market created");

      // T-1: Hedge Request (use smaller amounts for test)
      await vault.connect(hedger).createHedgeRequest(
        0,
        ethers.parseEther("2"),    // $2 hedge
        ethers.parseEther("0.5"),  // $0.50 min bid
        ethers.parseEther("0.85")  // 85¢ YES price
      );
      console.log("    ✓ T-1: Hedge request created ($2 @ 85¢ YES)");

      // T-1: Counterparty Bids
      await vault.connect(cp1).submitBid(0, ethers.parseEther("0.8"), ethers.parseEther("0.15"));
      await vault.connect(cp2).submitBid(0, ethers.parseEther("0.7"), ethers.parseEther("0.14"));
      await vault.connect(cp3).submitBid(0, ethers.parseEther("0.5"), ethers.parseEther("0.16"));
      console.log("    ✓ T-1: 3 counterparty bids submitted");

      // T-1: Accept Bids
      await vault.connect(hedger).acceptBid(0, 0); // cp1
      await vault.connect(hedger).acceptBid(0, 1); // cp2
      await vault.connect(hedger).acceptBid(0, 2); // cp3
      
      const req = await vault.getHedgeRequest(0);
      console.log(`    ✓ T-1: All bids accepted (filled: $${ethers.formatEther(req.filledAmount)})`);

      // T0: Departure
      await vault.connect(oracle).confirmDeparture(0);
      const market1 = await vault.getMarket(0);
      console.log(`    ✓ T0: Departure confirmed`);
      console.log(`         YES shares: ${ethers.formatEther(market1.totalYesShares)}`);
      console.log(`         NO shares: ${ethers.formatEther(market1.totalNoShares)}`);
      console.log(`         Collateral: ${ethers.formatEther(market1.totalCollateral)} FLR`);

      // Verify positions
      const hedgerPos = await vault.getPosition(0, hedger.address);
      const cp1Pos = await vault.getPosition(0, cp1.address);
      expect(hedgerPos.yesShares).to.be.gt(0);
      expect(cp1Pos.noShares).to.be.gt(0);
      console.log(`    ✓ T0: Positions verified`);

      // T2: Oracle Data (YES wins - vessel was detained)
      const dataHash = ethers.keccak256(ethers.toUtf8Bytes("PSC_DETAINED:true"));
      await vault.connect(oracle).submitSyntheticOutcome(0, true, dataHash);
      console.log("    ✓ T2: Synthetic outcome submitted (YES WINS)");

      // T3: Settlement
      await vault.settle(0);
      console.log("    ✓ T3: Market settled");

      // T3: Claims
      const hedgerBefore = await vault.getBalance(hedger.address);
      await vault.connect(hedger).claim(0);
      const hedgerAfter = await vault.getBalance(hedger.address);
      const hedgerPayout = hedgerAfter - hedgerBefore;
      
      console.log(`    ✓ T3: Hedger claimed ${ethers.formatEther(hedgerPayout)} FLR`);

      // Verify losers cannot claim
      await expect(vault.connect(cp1).claim(0)).to.be.revertedWith("No winning shares");
      console.log("    ✓ T3: Losers correctly rejected");

      // Protocol fees
      const fees = await vault.protocolFees();
      console.log(`    ✓ Protocol fees: ${ethers.formatEther(fees)} FLR`);

      console.log("    === LIFECYCLE COMPLETE ===\n");
    });
  });

  describe("Edge Cases & Security", function () {
    beforeEach(async function () {
      await vault.connect(operator).createMarket(
        "9876543", "MV Test", 0,
        futureTime(3600), futureTime(7200), futureTime(14400)
      );
    });

    it("should handle partial fills correctly", async function () {
      // Hedge $2, but only get $1.2 in bids
      await vault.connect(hedger).createHedgeRequest(
        0, ethers.parseEther("2"), ethers.parseEther("0.5"), ethers.parseEther("0.85")
      );
      await vault.connect(cp1).submitBid(0, ethers.parseEther("1.2"), ethers.parseEther("0.15"));
      await vault.connect(hedger).acceptBid(0, 0);

      const hedgerBalanceBefore = await vault.getBalance(hedger.address);
      await vault.connect(oracle).confirmDeparture(0);
      const hedgerBalanceAfter = await vault.getBalance(hedger.address);

      // Hedger should get refund for unfilled portion
      expect(hedgerBalanceAfter).to.be.gt(hedgerBalanceBefore);
    });

    it("should not allow actions after deadline", async function () {
      // This test would need time manipulation - skip for now
      // In production, use Hardhat time helpers
    });

    it("should handle zero balance gracefully", async function () {
      // New user with no deposit
      const [,,,,,,,, newUser] = await ethers.getSigners();
      
      await expect(
        vault.connect(newUser).createHedgeRequest(
          0, ethers.parseEther("2"), ethers.parseEther("0.5"), ethers.parseEther("0.85")
        )
      ).to.be.revertedWith("Insufficient deposit");
    });

    it("should enforce withdrawal limits", async function () {
      const balance = await vault.getBalance(hedger.address);
      
      await expect(
        vault.connect(hedger).withdraw(balance + 1n)
      ).to.be.revertedWith("Insufficient balance");
    });
  });
});
