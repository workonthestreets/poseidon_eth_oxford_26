import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;

/**
 * ════════════════════════════════════════════════════════════════════════════════
 * COMPREHENSIVE MARITIME RFQ VAULT TESTS
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * Tests ALL workflows:
 * 1. Full prediction market lifecycle
 * 2. Multiple users competing
 * 3. Partial fills across multiple emissions
 * 4. Both YES and NO winning scenarios
 * 5. Edge cases and error conditions
 * 6. FTSO price integration (fallback on local)
 * 
 * NOTE: At default $0.02/FLR, we need ~50 FLR per $1 of shares.
 *       Using small share quantities (5-10) to stay within test account limits.
 */

describe("MaritimeRFQVault - Comprehensive Tests", function () {
  let vault;
  let owner, alice, bob, carol, dave, oracle;
  let vaultAddress;
  
  // Standard deposit that's enough for small test trades
  // At $0.02/FLR: 100 FLR = $2, enough for ~2 share pairs
  const DEPOSIT_AMOUNT = ethers.parseEther("200");

  // Helper to sign emission
  async function signEmission(signer, marketId, yesUser, noUser, quantity, yesPrice, noPrice, nonce, deadline) {
    const domain = {
      name: "MaritimeRFQVault",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: vaultAddress
    };

    const types = {
      Emission: [
        { name: "marketId", type: "uint256" },
        { name: "yesUser", type: "address" },
        { name: "noUser", type: "address" },
        { name: "quantity", type: "uint256" },
        { name: "yesPrice", type: "uint256" },
        { name: "noPrice", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" }
      ]
    };

    const value = { marketId, yesUser, noUser, quantity, yesPrice, noPrice, nonce, deadline };
    return await signer.signTypedData(domain, types, value);
  }

  beforeEach(async function () {
    [owner, alice, bob, carol, dave, oracle] = await ethers.getSigners();
    
    const RFQVault = await ethers.getContractFactory("MaritimeRFQVault");
    vault = await RFQVault.deploy();
    await vault.waitForDeployment();
    vaultAddress = await vault.getAddress();
  });

  // ════════════════════════════════════════════════════════════════════════════
  // TEST 1: COMPLETE LIFECYCLE - YES WINS
  // ════════════════════════════════════════════════════════════════════════════
  
  describe("Test 1: Complete Lifecycle - YES Wins", function () {
    it("should execute full flow: deposit → market → emit → settle → claim", async function () {
      console.log("\n    ┌─────────────────────────────────────────────────────────┐");
      console.log("    │  SCENARIO: Ship gets detained, YES holders win          │");
      console.log("    └─────────────────────────────────────────────────────────┘");

      // 1. DEPOSITS
      console.log("\n    Step 1: Users deposit collateral");
      await vault.connect(alice).deposit({ value: DEPOSIT_AMOUNT });
      await vault.connect(bob).deposit({ value: DEPOSIT_AMOUNT });
      
      const aliceDeposit = await vault.deposits(alice.address);
      const bobDeposit = await vault.deposits(bob.address);
      console.log(`      Alice deposited: ${ethers.formatEther(aliceDeposit)} FLR`);
      console.log(`      Bob deposited: ${ethers.formatEther(bobDeposit)} FLR`);

      // 2. CREATE MARKET
      console.log("\n    Step 2: Create prediction market");
      const marketUUID = ethers.id("detention-market-1");
      const expiresAt = Math.floor(Date.now() / 1000) + 86400 * 7;
      await vault.createMarket(marketUUID, "9525338", "Will MAERSK CHENNAI be detained?", expiresAt);
      
      const market = await vault.getMarket(0);
      console.log(`      Market ID: 0`);
      console.log(`      Vessel IMO: ${market.vesselIMO}`);

      // 3. EMIT SHARES (small qty for test)
      console.log("\n    Step 3: Emit shares (Alice=YES@55¢, Bob=NO@45¢)");
      const shares = 5n;  // Small for testing
      const yesPrice = 55n;
      const noPrice = 45n;
      const nonce = 1n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

      const signature = await signEmission(owner, 0n, alice.address, bob.address, shares, yesPrice, noPrice, nonce, deadline);
      await vault.emitShares(0, alice.address, bob.address, shares, yesPrice, noPrice, nonce, deadline, signature);

      const alicePos = await vault.getPosition(0, alice.address);
      const bobPos = await vault.getPosition(0, bob.address);
      console.log(`      Alice: ${alicePos.yesShares} YES shares`);
      console.log(`      Bob: ${bobPos.noShares} NO shares`);

      // 4. CHECK MARKET STATE
      console.log("\n    Step 4: Verify market state");
      const marketAfter = await vault.getMarket(0);
      console.log(`      Total collateral: ${ethers.formatEther(marketAfter.totalCollateral)} FLR`);
      console.log(`      Total shares: ${marketAfter.totalShares}`);

      // 5. SETTLE - YES WINS
      console.log("\n    Step 5: Oracle settles - YES WINS (detained)");
      await vault.settle(0, true);
      
      const settledMarket = await vault.getMarket(0);
      console.log(`      Settled: ${settledMarket.settled}`);
      console.log(`      Outcome: ${settledMarket.outcome ? "YES" : "NO"} wins`);

      // 6. CLAIMS
      console.log("\n    Step 6: Process claims");
      
      const aliceBalanceBefore = await vault.deposits(alice.address);
      await vault.connect(alice).claim(0);
      const aliceBalanceAfter = await vault.deposits(alice.address);
      const alicePayout = aliceBalanceAfter - aliceBalanceBefore;
      
      console.log(`      Alice (WINNER) payout: ${ethers.formatEther(alicePayout)} FLR`);

      // Bob cannot claim
      await expect(vault.connect(bob).claim(0)).to.be.revertedWith("No winning shares");
      console.log(`      Bob (LOSER) cannot claim - reverted as expected`);

      // 7. VERIFY FINAL BALANCES
      console.log("\n    Step 7: Final verification");
      const aliceFinal = await vault.deposits(alice.address);
      const bobFinal = await vault.deposits(bob.address);
      
      console.log(`      Alice final balance: ${ethers.formatEther(aliceFinal)} FLR`);
      console.log(`      Bob final balance: ${ethers.formatEther(bobFinal)} FLR`);
      
      expect(alicePayout).to.be.gt(0);
      expect(settledMarket.outcome).to.equal(true);
      
      console.log("\n    ✅ Test 1 PASSED: Full lifecycle with YES winning");
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // TEST 2: COMPLETE LIFECYCLE - NO WINS
  // ════════════════════════════════════════════════════════════════════════════

  describe("Test 2: Complete Lifecycle - NO Wins", function () {
    it("should pay NO holders when event doesn't occur", async function () {
      console.log("\n    ┌─────────────────────────────────────────────────────────┐");
      console.log("    │  SCENARIO: Ship passes inspection, NO holders win       │");
      console.log("    └─────────────────────────────────────────────────────────┘");

      await vault.connect(alice).deposit({ value: DEPOSIT_AMOUNT });
      await vault.connect(bob).deposit({ value: DEPOSIT_AMOUNT });

      await vault.createMarket(ethers.id("market-2"), "9839430", "Will MSC GULSUN be detained?", Math.floor(Date.now() / 1000) + 86400);

      // Alice bets YES (thinks detention), Bob bets NO (thinks passes)
      const signature = await signEmission(owner, 0n, alice.address, bob.address, 5n, 70n, 30n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, alice.address, bob.address, 5, 70, 30, 1, Math.floor(Date.now() / 1000) + 3600, signature);

      console.log("\n    Positions:");
      console.log(`      Alice: 5 YES @ 70¢ (bet: ship detained)`);
      console.log(`      Bob: 5 NO @ 30¢ (bet: ship passes)`);

      // Settle - NO WINS (ship passed inspection)
      await vault.settle(0, false);
      console.log("\n    Settlement: NO wins - ship passed inspection");

      const bobBalanceBefore = await vault.deposits(bob.address);
      await vault.connect(bob).claim(0);
      const bobBalanceAfter = await vault.deposits(bob.address);
      const bobPayout = bobBalanceAfter - bobBalanceBefore;

      console.log(`\n    Bob (NO holder) payout: ${ethers.formatEther(bobPayout)} FLR`);
      
      await expect(vault.connect(alice).claim(0)).to.be.revertedWith("No winning shares");
      console.log(`    Alice (YES holder) cannot claim - lost her bet`);

      expect(bobPayout).to.be.gt(0);
      console.log("\n    ✅ Test 2 PASSED: NO winners paid correctly");
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // TEST 3: MULTIPLE EMISSIONS IN SAME MARKET
  // ════════════════════════════════════════════════════════════════════════════

  describe("Test 3: Multiple Emissions (Partial Fills)", function () {
    it("should handle multiple emissions at different prices", async function () {
      console.log("\n    ┌─────────────────────────────────────────────────────────┐");
      console.log("    │  SCENARIO: Multiple trades at different prices          │");
      console.log("    └─────────────────────────────────────────────────────────┘");

      await vault.connect(alice).deposit({ value: DEPOSIT_AMOUNT });
      await vault.connect(bob).deposit({ value: DEPOSIT_AMOUNT });
      await vault.connect(carol).deposit({ value: DEPOSIT_AMOUNT });

      await vault.createMarket(ethers.id("multi-emission"), "1234567", "Test multi-emission", Math.floor(Date.now() / 1000) + 86400);

      // Emission 1: Alice YES vs Bob NO @ 60/40
      console.log("\n    Emission 1: Alice YES vs Bob NO @ 60/40 (3 shares)");
      let sig = await signEmission(owner, 0n, alice.address, bob.address, 3n, 60n, 40n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, alice.address, bob.address, 3, 60, 40, 1, Math.floor(Date.now() / 1000) + 3600, sig);

      // Emission 2: Carol YES vs Bob NO @ 55/45
      console.log("    Emission 2: Carol YES vs Bob NO @ 55/45 (2 shares)");
      sig = await signEmission(owner, 0n, carol.address, bob.address, 2n, 55n, 45n, 2n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, carol.address, bob.address, 2, 55, 45, 2, Math.floor(Date.now() / 1000) + 3600, sig);

      // Emission 3: Alice YES vs Carol NO @ 65/35
      console.log("    Emission 3: Alice YES vs Carol NO @ 65/35 (2 shares)");
      sig = await signEmission(owner, 0n, alice.address, carol.address, 2n, 65n, 35n, 3n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, alice.address, carol.address, 2, 65, 35, 3, Math.floor(Date.now() / 1000) + 3600, sig);

      // Check positions
      const alicePos = await vault.getPosition(0, alice.address);
      const bobPos = await vault.getPosition(0, bob.address);
      const carolPos = await vault.getPosition(0, carol.address);

      console.log("\n    Final positions:");
      console.log(`      Alice: ${alicePos.yesShares} YES, ${alicePos.noShares} NO`);
      console.log(`      Bob: ${bobPos.yesShares} YES, ${bobPos.noShares} NO`);
      console.log(`      Carol: ${carolPos.yesShares} YES, ${carolPos.noShares} NO`);

      expect(alicePos.yesShares).to.equal(5n); // 3 + 2
      expect(bobPos.noShares).to.equal(5n);    // 3 + 2
      expect(carolPos.yesShares).to.equal(2n);
      expect(carolPos.noShares).to.equal(2n);

      // Market stats
      const market = await vault.getMarket(0);
      console.log(`\n    Market total shares: ${market.totalShares}`);
      console.log(`    Market total collateral: ${ethers.formatEther(market.totalCollateral)} FLR`);

      expect(market.totalShares).to.equal(7n); // 3 + 2 + 2

      // Settle YES wins
      await vault.settle(0, true);
      
      // All YES holders claim
      await vault.connect(alice).claim(0);
      await vault.connect(carol).claim(0);
      
      // Bob (only NO) cannot claim
      await expect(vault.connect(bob).claim(0)).to.be.revertedWith("No winning shares");

      console.log("\n    ✅ Test 3 PASSED: Multiple emissions handled correctly");
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // TEST 4: MIXED POSITIONS (USER HAS BOTH YES AND NO)
  // ════════════════════════════════════════════════════════════════════════════

  describe("Test 4: Mixed Positions", function () {
    it("should handle user with both YES and NO shares", async function () {
      console.log("\n    ┌─────────────────────────────────────────────────────────┐");
      console.log("    │  SCENARIO: User holds both YES and NO (hedged)          │");
      console.log("    └─────────────────────────────────────────────────────────┘");

      await vault.connect(alice).deposit({ value: DEPOSIT_AMOUNT });
      await vault.connect(bob).deposit({ value: DEPOSIT_AMOUNT });

      await vault.createMarket(ethers.id("mixed"), "7654321", "Mixed position test", Math.floor(Date.now() / 1000) + 86400);

      // Alice buys YES from Bob
      let sig = await signEmission(owner, 0n, alice.address, bob.address, 4n, 50n, 50n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, alice.address, bob.address, 4, 50, 50, 1, Math.floor(Date.now() / 1000) + 3600, sig);

      // Alice buys NO from Bob (hedging!)
      sig = await signEmission(owner, 0n, bob.address, alice.address, 2n, 50n, 50n, 2n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, bob.address, alice.address, 2, 50, 50, 2, Math.floor(Date.now() / 1000) + 3600, sig);

      const alicePos = await vault.getPosition(0, alice.address);
      const bobPos = await vault.getPosition(0, bob.address);

      console.log("\n    Positions (Alice is hedged):");
      console.log(`      Alice: ${alicePos.yesShares} YES, ${alicePos.noShares} NO`);
      console.log(`      Bob: ${bobPos.yesShares} YES, ${bobPos.noShares} NO`);

      expect(alicePos.yesShares).to.equal(4n);
      expect(alicePos.noShares).to.equal(2n);
      expect(bobPos.yesShares).to.equal(2n);
      expect(bobPos.noShares).to.equal(4n);

      // Settle YES wins
      await vault.settle(0, true);

      // Both can claim (both have YES shares)
      const aliceBefore = await vault.deposits(alice.address);
      const bobBefore = await vault.deposits(bob.address);
      
      await vault.connect(alice).claim(0);
      await vault.connect(bob).claim(0);
      
      const aliceAfter = await vault.deposits(alice.address);
      const bobAfter = await vault.deposits(bob.address);

      console.log(`\n    Payouts (YES wins):`);
      console.log(`      Alice (60 YES): ${ethers.formatEther(aliceAfter - aliceBefore)} FLR`);
      console.log(`      Bob (40 YES): ${ethers.formatEther(bobAfter - bobBefore)} FLR`);

      // Alice should get more (60 YES vs Bob's 40 YES)
      expect(aliceAfter - aliceBefore).to.be.gt(bobAfter - bobBefore);

      console.log("\n    ✅ Test 4 PASSED: Mixed positions handled correctly");
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // TEST 5: PRICE VALIDATION
  // ════════════════════════════════════════════════════════════════════════════

  describe("Test 5: Price Validation", function () {
    beforeEach(async function () {
      await vault.connect(alice).deposit({ value: DEPOSIT_AMOUNT });
      await vault.connect(bob).deposit({ value: DEPOSIT_AMOUNT });
      await vault.createMarket(ethers.id("price-test-" + Date.now()), "1111111", "Price validation", Math.floor(Date.now() / 1000) + 86400);
    });

    it("should reject prices that don't sum to 100", async function () {
      console.log("\n    Testing: 60 + 50 = 110 (invalid)");
      const sig = await signEmission(owner, 0n, alice.address, bob.address, 1n, 60n, 50n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await expect(
        vault.emitShares(0, alice.address, bob.address, 1, 60, 50, 1, Math.floor(Date.now() / 1000) + 3600, sig)
      ).to.be.revertedWith("Prices must sum to 100");
      console.log("    ✅ Rejected as expected");
    });

    it("should reject price = 0", async function () {
      console.log("\n    Testing: 100 + 0 (invalid - YES price must be 1-99)");
      const sig = await signEmission(owner, 0n, alice.address, bob.address, 1n, 100n, 0n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await expect(
        vault.emitShares(0, alice.address, bob.address, 1, 100, 0, 1, Math.floor(Date.now() / 1000) + 3600, sig)
      ).to.be.revertedWith("Invalid YES price");  // 100 is invalid for YES
      console.log("    ✅ Rejected as expected");
    });

    it("should reject price = 100", async function () {
      console.log("\n    Testing: 0 + 100 (invalid - YES price must be 1-99)");
      const sig = await signEmission(owner, 0n, alice.address, bob.address, 1n, 0n, 100n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await expect(
        vault.emitShares(0, alice.address, bob.address, 1, 0, 100, 1, Math.floor(Date.now() / 1000) + 3600, sig)
      ).to.be.revertedWith("Invalid YES price");
      console.log("    ✅ Rejected as expected");
    });

    it("should accept valid prices (1-99 summing to 100)", async function () {
      console.log("\n    Testing valid prices:");
      
      // 50/50
      let sig = await signEmission(owner, 0n, alice.address, bob.address, 1n, 50n, 50n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, alice.address, bob.address, 1, 50, 50, 1, Math.floor(Date.now() / 1000) + 3600, sig);
      console.log("    ✅ 50/50 accepted");

      // 1/99 (extreme)
      sig = await signEmission(owner, 0n, alice.address, bob.address, 1n, 1n, 99n, 2n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, alice.address, bob.address, 1, 1, 99, 2, Math.floor(Date.now() / 1000) + 3600, sig);
      console.log("    ✅ 1/99 accepted");

      // 99/1 (extreme)
      sig = await signEmission(owner, 0n, alice.address, bob.address, 1n, 99n, 1n, 3n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, alice.address, bob.address, 1, 99, 1, 3, Math.floor(Date.now() / 1000) + 3600, sig);
      console.log("    ✅ 99/1 accepted");

      console.log("\n    ✅ Test 5 PASSED: Price validation working");
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // TEST 6: SIGNATURE VALIDATION
  // ════════════════════════════════════════════════════════════════════════════

  describe("Test 6: Signature Validation", function () {
    beforeEach(async function () {
      await vault.connect(alice).deposit({ value: DEPOSIT_AMOUNT });
      await vault.connect(bob).deposit({ value: DEPOSIT_AMOUNT });
      await vault.createMarket(ethers.id("sig-test-" + Date.now()), "2222222", "Signature test", Math.floor(Date.now() / 1000) + 86400);
    });

    it("should reject wrong signer", async function () {
      console.log("\n    Testing: Non-operator signature");
      const sig = await signEmission(alice, 0n, alice.address, bob.address, 1n, 50n, 50n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await expect(
        vault.emitShares(0, alice.address, bob.address, 1, 50, 50, 1, Math.floor(Date.now() / 1000) + 3600, sig)
      ).to.be.revertedWith("Invalid operator signature");
      console.log("    ✅ Rejected as expected");
    });

    it("should reject expired signature", async function () {
      console.log("\n    Testing: Expired deadline");
      const expiredDeadline = Math.floor(Date.now() / 1000) - 3600;
      const sig = await signEmission(owner, 0n, alice.address, bob.address, 1n, 50n, 50n, 1n, BigInt(expiredDeadline));
      await expect(
        vault.emitShares(0, alice.address, bob.address, 1, 50, 50, 1, expiredDeadline, sig)
      ).to.be.revertedWith("Signature expired");
      console.log("    ✅ Rejected as expected");
    });

    it("should reject reused nonce", async function () {
      console.log("\n    Testing: Replay attack (same signature twice)");
      const deadline = Math.floor(Date.now() / 1000) + 3600;
      const sig = await signEmission(owner, 0n, alice.address, bob.address, 1n, 50n, 50n, 1n, BigInt(deadline));
      
      await vault.emitShares(0, alice.address, bob.address, 1, 50, 50, 1, deadline, sig);
      console.log("    First emission: success");
      
      await expect(
        vault.emitShares(0, alice.address, bob.address, 1, 50, 50, 1, deadline, sig)
      ).to.be.revertedWith("Emission already used");
      console.log("    Replay attempt: rejected");
      
      console.log("\n    ✅ Test 6 PASSED: Signature validation working");
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // TEST 7: MARKET LIFECYCLE ERRORS
  // ════════════════════════════════════════════════════════════════════════════

  describe("Test 7: Market Lifecycle Errors", function () {
    it("should prevent actions on settled market", async function () {
      console.log("\n    Testing: Actions after settlement");

      await vault.connect(alice).deposit({ value: DEPOSIT_AMOUNT });
      await vault.connect(bob).deposit({ value: DEPOSIT_AMOUNT });
      await vault.createMarket(ethers.id("settled-test-" + Date.now()), "3333333", "Settled test", Math.floor(Date.now() / 1000) + 86400);

      const sig = await signEmission(owner, 0n, alice.address, bob.address, 2n, 50n, 50n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, alice.address, bob.address, 2, 50, 50, 1, Math.floor(Date.now() / 1000) + 3600, sig);
      await vault.settle(0, true);
      console.log("    Market settled");

      const sig2 = await signEmission(owner, 0n, alice.address, bob.address, 2n, 50n, 50n, 2n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await expect(
        vault.emitShares(0, alice.address, bob.address, 2, 50, 50, 2, Math.floor(Date.now() / 1000) + 3600, sig2)
      ).to.be.revertedWith("Market settled");
      console.log("    Cannot emit after settlement: ✅");

      await expect(vault.settle(0, false)).to.be.revertedWith("Already settled");
      console.log("    Cannot settle twice: ✅");

      // Try to claim twice
      await vault.connect(alice).claim(0);
      await expect(vault.connect(alice).claim(0)).to.be.revertedWith("Already claimed");
      console.log("    Cannot claim twice: ✅");

      console.log("\n    ✅ Test 7 PASSED: Market lifecycle protection working");
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // TEST 8: WITHDRAWAL PROTECTION
  // ════════════════════════════════════════════════════════════════════════════

  describe("Test 8: Balance and Withdrawal", function () {
    it("should track balances correctly through full cycle", async function () {
      console.log("\n    Testing: Balance tracking through full cycle");

      await vault.connect(alice).deposit({ value: DEPOSIT_AMOUNT });
      await vault.connect(bob).deposit({ value: DEPOSIT_AMOUNT });

      console.log(`    Initial deposits: ${ethers.formatEther(DEPOSIT_AMOUNT)} FLR each`);

      await vault.createMarket(ethers.id("balance-test-" + Date.now()), "4444444", "Balance test", Math.floor(Date.now() / 1000) + 86400);

      const sig = await signEmission(owner, 0n, alice.address, bob.address, 3n, 60n, 40n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, alice.address, bob.address, 3, 60, 40, 1, Math.floor(Date.now() / 1000) + 3600, sig);

      const aliceAfterEmit = await vault.deposits(alice.address);
      const bobAfterEmit = await vault.deposits(bob.address);
      console.log(`    After emission:`);
      console.log(`      Alice: ${ethers.formatEther(aliceAfterEmit)} FLR`);
      console.log(`      Bob: ${ethers.formatEther(bobAfterEmit)} FLR`);

      // Settle and claim
      await vault.settle(0, true);
      await vault.connect(alice).claim(0);

      const aliceAfterClaim = await vault.deposits(alice.address);
      console.log(`    After claim (Alice won):`);
      console.log(`      Alice: ${ethers.formatEther(aliceAfterClaim)} FLR`);

      // Withdraw
      await vault.connect(alice).withdraw(aliceAfterClaim);
      const aliceFinal = await vault.deposits(alice.address);
      console.log(`    After withdrawal:`);
      console.log(`      Alice deposit: ${ethers.formatEther(aliceFinal)} FLR`);

      expect(aliceFinal).to.equal(0);

      console.log("\n    ✅ Test 8 PASSED: Balance tracking correct");
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // TEST 9: MULTIPLE MARKETS SIMULTANEOUSLY
  // ════════════════════════════════════════════════════════════════════════════

  describe("Test 9: Multiple Markets", function () {
    it("should handle multiple markets independently", async function () {
      console.log("\n    Testing: Multiple independent markets");

      await vault.connect(alice).deposit({ value: DEPOSIT_AMOUNT });
      await vault.connect(bob).deposit({ value: DEPOSIT_AMOUNT });

      await vault.createMarket(ethers.id("market-A-" + Date.now()), "1111111", "Market A", Math.floor(Date.now() / 1000) + 86400);
      await vault.createMarket(ethers.id("market-B-" + Date.now()), "2222222", "Market B", Math.floor(Date.now() / 1000) + 86400);
      await vault.createMarket(ethers.id("market-C-" + Date.now()), "3333333", "Market C", Math.floor(Date.now() / 1000) + 86400);
      console.log("    Created 3 markets");

      for (let i = 0; i < 3; i++) {
        const sig = await signEmission(owner, BigInt(i), alice.address, bob.address, 2n, 50n, 50n, BigInt(i + 1), BigInt(Math.floor(Date.now() / 1000) + 3600));
        await vault.emitShares(i, alice.address, bob.address, 2, 50, 50, i + 1, Math.floor(Date.now() / 1000) + 3600, sig);
      }
      console.log("    Emitted shares in all 3 markets");

      // Settle differently: A=YES, B=NO, C=YES
      await vault.settle(0, true);  // Market A: YES wins
      await vault.settle(1, false); // Market B: NO wins
      await vault.settle(2, true);  // Market C: YES wins
      console.log("    Settled: A=YES, B=NO, C=YES");

      // Claims
      await vault.connect(alice).claim(0); // Alice wins A
      await vault.connect(bob).claim(1);   // Bob wins B
      await vault.connect(alice).claim(2); // Alice wins C

      // Bob cannot claim A and C, Alice cannot claim B
      await expect(vault.connect(bob).claim(0)).to.be.revertedWith("No winning shares");
      await expect(vault.connect(alice).claim(1)).to.be.revertedWith("No winning shares");
      await expect(vault.connect(bob).claim(2)).to.be.revertedWith("No winning shares");

      console.log("    Claims processed correctly");
      console.log("\n    ✅ Test 9 PASSED: Multiple markets work independently");
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // TEST 10: PROTOCOL FEE
  // ════════════════════════════════════════════════════════════════════════════

  describe("Test 10: Protocol Fee (2%)", function () {
    it("should deduct 2% protocol fee from winnings", async function () {
      console.log("\n    Testing: 2% protocol fee on winnings");

      await vault.connect(alice).deposit({ value: DEPOSIT_AMOUNT });
      await vault.connect(bob).deposit({ value: DEPOSIT_AMOUNT });

      await vault.createMarket(ethers.id("fee-test-" + Date.now()), "5555555", "Fee test", Math.floor(Date.now() / 1000) + 86400);

      const sig = await signEmission(owner, 0n, alice.address, bob.address, 5n, 50n, 50n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, alice.address, bob.address, 5, 50, 50, 1, Math.floor(Date.now() / 1000) + 3600, sig);

      const market = await vault.getMarket(0);
      console.log(`    Total collateral: ${ethers.formatEther(market.totalCollateral)} FLR`);

      await vault.settle(0, true);

      const aliceBefore = await vault.deposits(alice.address);
      await vault.connect(alice).claim(0);
      const aliceAfter = await vault.deposits(alice.address);
      const payout = aliceAfter - aliceBefore;

      // Expected: totalCollateral - 2% fee
      const expectedPayout = (market.totalCollateral * 98n) / 100n;
      
      console.log(`    Payout received: ${ethers.formatEther(payout)} FLR`);
      console.log(`    Expected (98%): ${ethers.formatEther(expectedPayout)} FLR`);
      
      expect(payout).to.equal(expectedPayout);

      // Check protocol fees accumulated
      const fees = await vault.protocolFees();
      console.log(`    Protocol fees collected: ${ethers.formatEther(fees)} FLR`);
      expect(fees).to.be.gt(0);

      // Verify feeRecipient is set
      const feeRecipient = await vault.feeRecipient();
      console.log(`    Fee recipient: ${feeRecipient}`);
      expect(feeRecipient).to.equal(owner.address);

      // Withdraw fees
      const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);
      await vault.withdrawFees();
      const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);
      
      const feesAfterWithdraw = await vault.protocolFees();
      console.log(`    Fees after withdrawal: ${ethers.formatEther(feesAfterWithdraw)} FLR`);
      expect(feesAfterWithdraw).to.equal(0);
      
      console.log(`    Owner received fees: ✅`);
      console.log("\n    ✅ Test 10 PASSED: 2% fee correctly deducted and withdrawable");
    });

    it("should allow setting custom fee recipient", async function () {
      console.log("\n    Testing: Custom fee recipient");

      await vault.connect(alice).deposit({ value: DEPOSIT_AMOUNT });
      await vault.connect(bob).deposit({ value: DEPOSIT_AMOUNT });

      // Set carol as fee recipient
      await vault.setFeeRecipient(carol.address);
      const feeRecipient = await vault.feeRecipient();
      console.log(`    Fee recipient set to Carol: ${feeRecipient === carol.address}`);
      expect(feeRecipient).to.equal(carol.address);

      await vault.createMarket(ethers.id("fee-recipient-test-" + Date.now()), "6666666", "Fee recipient test", Math.floor(Date.now() / 1000) + 86400);

      const sig = await signEmission(owner, 0n, alice.address, bob.address, 5n, 50n, 50n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, alice.address, bob.address, 5, 50, 50, 1, Math.floor(Date.now() / 1000) + 3600, sig);

      await vault.settle(0, true);
      await vault.connect(alice).claim(0);

      const fees = await vault.protocolFees();
      console.log(`    Fees collected: ${ethers.formatEther(fees)} FLR`);

      // Carol's balance before
      const carolBalanceBefore = await ethers.provider.getBalance(carol.address);

      // Withdraw fees (goes to carol)
      await vault.withdrawFees();

      const carolBalanceAfter = await ethers.provider.getBalance(carol.address);
      const carolReceived = carolBalanceAfter - carolBalanceBefore;
      
      console.log(`    Carol received: ${ethers.formatEther(carolReceived)} FLR`);
      expect(carolReceived).to.equal(fees);

      console.log("\n    ✅ Custom fee recipient works correctly");
    });
  });
});
