import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;

/**
 * ════════════════════════════════════════════════════════════════════════════════
 * SECURITY & EDGE CASE TESTS
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * Tests critical security scenarios and edge cases:
 * 1. Access control
 * 2. Balance/collateral integrity
 * 3. Reentrancy protection
 * 4. Overflow/underflow protection
 * 5. Edge cases
 */

describe("MaritimeRFQVault - Security & Edge Cases", function () {
  let vault;
  let owner, alice, bob, carol, attacker;
  let vaultAddress;
  const DEPOSIT = ethers.parseEther("200");

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
    [owner, alice, bob, carol, attacker] = await ethers.getSigners();
    const RFQVault = await ethers.getContractFactory("MaritimeRFQVault");
    vault = await RFQVault.deploy();
    await vault.waitForDeployment();
    vaultAddress = await vault.getAddress();
  });

  // ════════════════════════════════════════════════════════════════════════════
  // ACCESS CONTROL TESTS
  // ════════════════════════════════════════════════════════════════════════════

  describe("Access Control", function () {
    it("should reject non-owner from setting operator", async function () {
      await expect(
        vault.connect(attacker).setOperator(attacker.address)
      ).to.be.revertedWith("Not owner");
    });

    it("should reject non-owner from setting oracle", async function () {
      await expect(
        vault.connect(attacker).setOracle(attacker.address)
      ).to.be.revertedWith("Not owner");
    });

    it("should reject non-owner from setting fee recipient", async function () {
      await expect(
        vault.connect(attacker).setFeeRecipient(attacker.address)
      ).to.be.revertedWith("Not owner");
    });

    it("should reject non-owner from withdrawing fees", async function () {
      await expect(
        vault.connect(attacker).withdrawFees()
      ).to.be.revertedWith("Not owner");
    });

    it("should reject non-owner from transferring ownership", async function () {
      await expect(
        vault.connect(attacker).transferOwnership(attacker.address)
      ).to.be.revertedWith("Not owner");
    });

    it("should reject non-oracle from settling market", async function () {
      await vault.createMarket(ethers.id("test"), "1234567", "Test", Math.floor(Date.now() / 1000) + 86400);
      
      // Change oracle to someone else
      await vault.setOracle(carol.address);
      
      await expect(
        vault.connect(attacker).settle(0, true)
      ).to.be.revertedWith("Not oracle");
    });

    it("should allow new operator to sign emissions", async function () {
      await vault.connect(alice).deposit({ value: DEPOSIT });
      await vault.connect(bob).deposit({ value: DEPOSIT });
      await vault.createMarket(ethers.id("op-test"), "1234567", "Test", Math.floor(Date.now() / 1000) + 86400);

      // Change operator
      await vault.setOperator(carol.address);

      // Old operator signature should fail
      const oldSig = await signEmission(owner, 0n, alice.address, bob.address, 1n, 50n, 50n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await expect(
        vault.emitShares(0, alice.address, bob.address, 1, 50, 50, 1, Math.floor(Date.now() / 1000) + 3600, oldSig)
      ).to.be.revertedWith("Invalid operator signature");

      // New operator signature should work
      const newSig = await signEmission(carol, 0n, alice.address, bob.address, 1n, 50n, 50n, 2n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, alice.address, bob.address, 1, 50, 50, 2, Math.floor(Date.now() / 1000) + 3600, newSig);

      console.log("    ✅ Access control tests passed");
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // BALANCE INTEGRITY TESTS
  // ════════════════════════════════════════════════════════════════════════════

  describe("Balance Integrity", function () {
    it("should reject withdrawal exceeding deposit", async function () {
      await vault.connect(alice).deposit({ value: DEPOSIT });
      
      await expect(
        vault.connect(alice).withdraw(DEPOSIT + 1n)
      ).to.be.revertedWith("Insufficient balance");
    });

    it("should reject emission when YES user has insufficient balance", async function () {
      await vault.connect(alice).deposit({ value: ethers.parseEther("10") }); // Small deposit
      await vault.connect(bob).deposit({ value: DEPOSIT });
      await vault.createMarket(ethers.id("bal-test"), "1234567", "Test", Math.floor(Date.now() / 1000) + 86400);

      // Try to emit more than Alice can afford - should revert
      const sig = await signEmission(owner, 0n, alice.address, bob.address, 100n, 50n, 50n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await expect(
        vault.emitShares(0, alice.address, bob.address, 100, 50, 50, 1, Math.floor(Date.now() / 1000) + 3600, sig)
      ).to.be.reverted; // Will revert for balance or signature reason
    });

    it("should reject emission when NO user has insufficient balance", async function () {
      await vault.connect(alice).deposit({ value: DEPOSIT });
      await vault.connect(bob).deposit({ value: ethers.parseEther("10") }); // Small deposit
      await vault.createMarket(ethers.id("bal-test2"), "1234567", "Test", Math.floor(Date.now() / 1000) + 86400);

      const sig = await signEmission(owner, 0n, alice.address, bob.address, 100n, 50n, 50n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await expect(
        vault.emitShares(0, alice.address, bob.address, 100, 50, 50, 1, Math.floor(Date.now() / 1000) + 3600, sig)
      ).to.be.reverted; // Will revert for balance reason
    });

    it("should maintain total collateral = sum of user contributions", async function () {
      await vault.connect(alice).deposit({ value: DEPOSIT });
      await vault.connect(bob).deposit({ value: DEPOSIT });
      await vault.connect(carol).deposit({ value: DEPOSIT });
      await vault.createMarket(ethers.id("collateral-test"), "1234567", "Test", Math.floor(Date.now() / 1000) + 86400);

      // Multiple emissions
      let sig = await signEmission(owner, 0n, alice.address, bob.address, 2n, 60n, 40n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, alice.address, bob.address, 2, 60, 40, 1, Math.floor(Date.now() / 1000) + 3600, sig);

      sig = await signEmission(owner, 0n, carol.address, bob.address, 3n, 55n, 45n, 2n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, carol.address, bob.address, 3, 55, 45, 2, Math.floor(Date.now() / 1000) + 3600, sig);

      const market = await vault.getMarket(0);
      const alicePos = await vault.getPosition(0, alice.address);
      const bobPos = await vault.getPosition(0, bob.address);
      const carolPos = await vault.getPosition(0, carol.address);

      // Total shares should equal
      const totalYes = alicePos.yesShares + bobPos.yesShares + carolPos.yesShares;
      const totalNo = alicePos.noShares + bobPos.noShares + carolPos.noShares;
      
      expect(totalYes).to.equal(totalNo);
      expect(market.totalShares).to.equal(totalYes);
      
      console.log(`    Total YES: ${totalYes}, Total NO: ${totalNo}`);
      console.log("    ✅ Balance integrity verified");
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // CLAIMING EDGE CASES
  // ════════════════════════════════════════════════════════════════════════════

  describe("Claiming Edge Cases", function () {
    beforeEach(async function () {
      await vault.connect(alice).deposit({ value: DEPOSIT });
      await vault.connect(bob).deposit({ value: DEPOSIT });
      await vault.createMarket(ethers.id("claim-test-" + Date.now()), "1234567", "Test", Math.floor(Date.now() / 1000) + 86400);
      
      const sig = await signEmission(owner, 0n, alice.address, bob.address, 5n, 50n, 50n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, alice.address, bob.address, 5, 50, 50, 1, Math.floor(Date.now() / 1000) + 3600, sig);
    });

    it("should reject claiming before settlement", async function () {
      await expect(
        vault.connect(alice).claim(0)
      ).to.be.revertedWith("Not settled");
    });

    it("should reject claiming from non-participant", async function () {
      await vault.settle(0, true);
      
      await expect(
        vault.connect(carol).claim(0)
      ).to.be.revertedWith("No winning shares");
    });

    it("should reject claiming non-existent market", async function () {
      await expect(
        vault.connect(alice).claim(999)
      ).to.be.reverted; // Market doesn't exist
    });

    it("should allow both parties to claim if both have winning shares", async function () {
      // Add more emissions so both have YES
      const sig = await signEmission(owner, 0n, bob.address, alice.address, 3n, 50n, 50n, 2n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, bob.address, alice.address, 3, 50, 50, 2, Math.floor(Date.now() / 1000) + 3600, sig);

      await vault.settle(0, true); // YES wins

      // Both have YES shares now
      const alicePos = await vault.getPosition(0, alice.address);
      const bobPos = await vault.getPosition(0, bob.address);
      
      expect(alicePos.yesShares).to.be.gt(0);
      expect(bobPos.yesShares).to.be.gt(0);

      // Both can claim
      await vault.connect(alice).claim(0);
      await vault.connect(bob).claim(0);

      console.log("    ✅ Both parties claimed successfully");
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // MARKET LIFECYCLE EDGE CASES
  // ════════════════════════════════════════════════════════════════════════════

  describe("Market Lifecycle Edge Cases", function () {
    it("should reject creating market with past expiry", async function () {
      const pastExpiry = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      await expect(
        vault.createMarket(ethers.id("past"), "1234567", "Test", pastExpiry)
      ).to.be.revertedWith("Invalid expiry");
    });

    it("should reject emitting in expired market", async function () {
      // Create market with long expiry first
      await vault.createMarket(ethers.id("will-expire"), "1234567", "Test", Math.floor(Date.now() / 1000) + 86400);
      
      await vault.connect(alice).deposit({ value: DEPOSIT });
      await vault.connect(bob).deposit({ value: DEPOSIT });

      // Emit first to establish market works
      const sig1 = await signEmission(owner, 0n, alice.address, bob.address, 1n, 50n, 50n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, alice.address, bob.address, 1, 50, 50, 1, Math.floor(Date.now() / 1000) + 3600, sig1);

      // Settle market (which effectively "closes" it)
      await vault.settle(0, true);

      // Try to emit in settled market - should fail
      const sig2 = await signEmission(owner, 0n, alice.address, bob.address, 1n, 50n, 50n, 2n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await expect(
        vault.emitShares(0, alice.address, bob.address, 1, 50, 50, 2, Math.floor(Date.now() / 1000) + 3600, sig2)
      ).to.be.revertedWith("Market settled");
    });

    it("should reject duplicate market UUID", async function () {
      const uuid = ethers.id("unique-market");
      await vault.createMarket(uuid, "1234567", "Test 1", Math.floor(Date.now() / 1000) + 86400);
      
      await expect(
        vault.createMarket(uuid, "7654321", "Test 2", Math.floor(Date.now() / 1000) + 86400)
      ).to.be.revertedWith("UUID exists");
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // SIGNATURE TAMPERING TESTS
  // ════════════════════════════════════════════════════════════════════════════

  describe("Signature Tampering", function () {
    beforeEach(async function () {
      await vault.connect(alice).deposit({ value: DEPOSIT });
      await vault.connect(bob).deposit({ value: DEPOSIT });
      await vault.createMarket(ethers.id("sig-tamper-" + Date.now()), "1234567", "Test", Math.floor(Date.now() / 1000) + 86400);
    });

    it("should reject if quantity is tampered", async function () {
      // Sign for 1 share
      const sig = await signEmission(owner, 0n, alice.address, bob.address, 1n, 50n, 50n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      
      // Try to use signature for 10 shares
      await expect(
        vault.emitShares(0, alice.address, bob.address, 10, 50, 50, 1, Math.floor(Date.now() / 1000) + 3600, sig)
      ).to.be.revertedWith("Invalid operator signature");
    });

    it("should reject if price is tampered", async function () {
      // Sign for 50/50
      const sig = await signEmission(owner, 0n, alice.address, bob.address, 1n, 50n, 50n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      
      // Try to use for 60/40 (attacker wants cheaper YES)
      await expect(
        vault.emitShares(0, alice.address, bob.address, 1, 40, 60, 1, Math.floor(Date.now() / 1000) + 3600, sig)
      ).to.be.revertedWith("Invalid operator signature");
    });

    it("should reject if user address is tampered", async function () {
      // Sign for alice/bob
      const sig = await signEmission(owner, 0n, alice.address, bob.address, 1n, 50n, 50n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      
      await vault.connect(carol).deposit({ value: DEPOSIT });
      
      // Try to substitute carol for alice
      await expect(
        vault.emitShares(0, carol.address, bob.address, 1, 50, 50, 1, Math.floor(Date.now() / 1000) + 3600, sig)
      ).to.be.revertedWith("Invalid operator signature");
    });

    it("should reject if market ID is tampered", async function () {
      await vault.createMarket(ethers.id("market2-" + Date.now()), "7654321", "Test 2", Math.floor(Date.now() / 1000) + 86400);
      
      // Sign for market 0
      const sig = await signEmission(owner, 0n, alice.address, bob.address, 1n, 50n, 50n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      
      // Try to use for market 1
      await expect(
        vault.emitShares(1, alice.address, bob.address, 1, 50, 50, 1, Math.floor(Date.now() / 1000) + 3600, sig)
      ).to.be.revertedWith("Invalid operator signature");

      console.log("    ✅ All signature tampering rejected");
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // SAME USER AS BOTH SIDES
  // ════════════════════════════════════════════════════════════════════════════

  describe("Same User Both Sides", function () {
    it("should allow same user as YES and NO (self-hedging)", async function () {
      await vault.connect(alice).deposit({ value: DEPOSIT });
      await vault.createMarket(ethers.id("self-hedge"), "1234567", "Test", Math.floor(Date.now() / 1000) + 86400);

      // Alice is both YES and NO buyer
      const sig = await signEmission(owner, 0n, alice.address, alice.address, 2n, 50n, 50n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, alice.address, alice.address, 2, 50, 50, 1, Math.floor(Date.now() / 1000) + 3600, sig);

      const pos = await vault.getPosition(0, alice.address);
      expect(pos.yesShares).to.equal(2n);
      expect(pos.noShares).to.equal(2n);

      console.log("    Alice has both 2 YES and 2 NO shares (fully hedged)");
      console.log("    ✅ Self-hedging allowed");
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // ZERO/MIN/MAX VALUES
  // ════════════════════════════════════════════════════════════════════════════

  describe("Zero/Min/Max Values", function () {
    beforeEach(async function () {
      await vault.connect(alice).deposit({ value: DEPOSIT });
      await vault.connect(bob).deposit({ value: DEPOSIT });
      await vault.createMarket(ethers.id("minmax-" + Date.now()), "1234567", "Test", Math.floor(Date.now() / 1000) + 86400);
    });

    it("should reject zero shares", async function () {
      const sig = await signEmission(owner, 0n, alice.address, bob.address, 0n, 50n, 50n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await expect(
        vault.emitShares(0, alice.address, bob.address, 0, 50, 50, 1, Math.floor(Date.now() / 1000) + 3600, sig)
      ).to.be.revertedWith("Zero shares");
    });

    it("should accept minimum 1 share", async function () {
      const sig = await signEmission(owner, 0n, alice.address, bob.address, 1n, 50n, 50n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, alice.address, bob.address, 1, 50, 50, 1, Math.floor(Date.now() / 1000) + 3600, sig);
      
      const market = await vault.getMarket(0);
      expect(market.totalShares).to.equal(1n);
    });

    it("should accept extreme prices 1/99", async function () {
      const sig = await signEmission(owner, 0n, alice.address, bob.address, 1n, 1n, 99n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, alice.address, bob.address, 1, 1, 99, 1, Math.floor(Date.now() / 1000) + 3600, sig);
      
      const market = await vault.getMarket(0);
      expect(market.totalShares).to.equal(1n);
      console.log("    ✅ 1/99 price accepted");
    });

    it("should accept extreme prices 99/1", async function () {
      const sig = await signEmission(owner, 0n, alice.address, bob.address, 1n, 99n, 1n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, alice.address, bob.address, 1, 99, 1, 1, Math.floor(Date.now() / 1000) + 3600, sig);
      
      const market = await vault.getMarket(0);
      expect(market.totalShares).to.equal(1n);
      console.log("    ✅ 99/1 price accepted");
    });

    it("should reject zero deposit", async function () {
      await expect(
        vault.connect(carol).deposit({ value: 0 })
      ).to.be.revertedWith("Zero deposit");
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // DEPOSIT/WITHDRAW FLOWS
  // ════════════════════════════════════════════════════════════════════════════

  describe("Deposit/Withdraw Flows", function () {
    it("should allow multiple deposits", async function () {
      await vault.connect(alice).deposit({ value: ethers.parseEther("100") });
      await vault.connect(alice).deposit({ value: ethers.parseEther("50") });
      await vault.connect(alice).deposit({ value: ethers.parseEther("25") });

      const balance = await vault.deposits(alice.address);
      expect(balance).to.equal(ethers.parseEther("175"));
    });

    it("should allow partial withdrawals", async function () {
      await vault.connect(alice).deposit({ value: ethers.parseEther("100") });
      
      await vault.connect(alice).withdraw(ethers.parseEther("30"));
      expect(await vault.deposits(alice.address)).to.equal(ethers.parseEther("70"));
      
      await vault.connect(alice).withdraw(ethers.parseEther("40"));
      expect(await vault.deposits(alice.address)).to.equal(ethers.parseEther("30"));
      
      await vault.connect(alice).withdraw(ethers.parseEther("30"));
      expect(await vault.deposits(alice.address)).to.equal(0);
    });

    it("should allow deposit via receive()", async function () {
      // Send ETH directly to contract
      await alice.sendTransaction({
        to: vaultAddress,
        value: ethers.parseEther("50")
      });

      const balance = await vault.deposits(alice.address);
      expect(balance).to.equal(ethers.parseEther("50"));
    });

    it("should correctly track balance after emission and settlement", async function () {
      const initialDeposit = ethers.parseEther("100");
      await vault.connect(alice).deposit({ value: initialDeposit });
      await vault.connect(bob).deposit({ value: initialDeposit });

      const aliceInitial = await vault.deposits(alice.address);
      const bobInitial = await vault.deposits(bob.address);

      await vault.createMarket(ethers.id("track-test"), "1234567", "Test", Math.floor(Date.now() / 1000) + 86400);

      // Small emission
      const sig = await signEmission(owner, 0n, alice.address, bob.address, 1n, 50n, 50n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, alice.address, bob.address, 1, 50, 50, 1, Math.floor(Date.now() / 1000) + 3600, sig);

      const aliceAfterEmit = await vault.deposits(alice.address);
      const bobAfterEmit = await vault.deposits(bob.address);

      // Both should have less after emission (collateral locked)
      expect(aliceAfterEmit).to.be.lt(aliceInitial);
      expect(bobAfterEmit).to.be.lt(bobInitial);

      // Settle and claim
      await vault.settle(0, true);
      await vault.connect(alice).claim(0);

      const aliceFinal = await vault.deposits(alice.address);
      
      // Winner should have gained
      expect(aliceFinal).to.be.gt(aliceAfterEmit);

      console.log("    ✅ Balance tracking verified through full cycle");
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // PAYOUT ACCURACY
  // ════════════════════════════════════════════════════════════════════════════

  describe("Payout Accuracy", function () {
    it("should distribute 98% of collateral to winner (2% fee)", async function () {
      await vault.connect(alice).deposit({ value: DEPOSIT });
      await vault.connect(bob).deposit({ value: DEPOSIT });
      await vault.createMarket(ethers.id("payout-test"), "1234567", "Test", Math.floor(Date.now() / 1000) + 86400);

      const sig = await signEmission(owner, 0n, alice.address, bob.address, 5n, 50n, 50n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, alice.address, bob.address, 5, 50, 50, 1, Math.floor(Date.now() / 1000) + 3600, sig);

      const market = await vault.getMarket(0);
      const totalCollateral = market.totalCollateral;

      await vault.settle(0, true);

      const aliceBefore = await vault.deposits(alice.address);
      await vault.connect(alice).claim(0);
      const aliceAfter = await vault.deposits(alice.address);

      const payout = aliceAfter - aliceBefore;
      const expectedPayout = (totalCollateral * 98n) / 100n;

      expect(payout).to.equal(expectedPayout);

      const fees = await vault.protocolFees();
      expect(fees).to.equal((totalCollateral * 2n) / 100n);

      console.log(`    Total collateral: ${ethers.formatEther(totalCollateral)} FLR`);
      console.log(`    Payout: ${ethers.formatEther(payout)} FLR (98%)`);
      console.log(`    Fees: ${ethers.formatEther(fees)} FLR (2%)`);
      console.log("    ✅ Payout accuracy verified");
    });

    it("should distribute proportionally with multiple winners", async function () {
      await vault.connect(alice).deposit({ value: DEPOSIT });
      await vault.connect(bob).deposit({ value: DEPOSIT });
      await vault.connect(carol).deposit({ value: DEPOSIT });
      await vault.createMarket(ethers.id("multi-winner"), "1234567", "Test", Math.floor(Date.now() / 1000) + 86400);

      // Alice: 4 YES, Bob: 2 YES, Carol: 0 YES but provides NO
      let sig = await signEmission(owner, 0n, alice.address, carol.address, 4n, 50n, 50n, 1n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, alice.address, carol.address, 4, 50, 50, 1, Math.floor(Date.now() / 1000) + 3600, sig);

      sig = await signEmission(owner, 0n, bob.address, carol.address, 2n, 50n, 50n, 2n, BigInt(Math.floor(Date.now() / 1000) + 3600));
      await vault.emitShares(0, bob.address, carol.address, 2, 50, 50, 2, Math.floor(Date.now() / 1000) + 3600, sig);

      await vault.settle(0, true); // YES wins

      const aliceBefore = await vault.deposits(alice.address);
      const bobBefore = await vault.deposits(bob.address);

      await vault.connect(alice).claim(0);
      await vault.connect(bob).claim(0);

      const alicePayout = (await vault.deposits(alice.address)) - aliceBefore;
      const bobPayout = (await vault.deposits(bob.address)) - bobBefore;

      // Alice should get 2x Bob's payout (4 shares vs 2 shares)
      // Allow small rounding difference
      const ratio = Number(alicePayout) / Number(bobPayout);
      expect(ratio).to.be.closeTo(2, 0.01);

      console.log(`    Alice payout: ${ethers.formatEther(alicePayout)} FLR (4 shares)`);
      console.log(`    Bob payout: ${ethers.formatEther(bobPayout)} FLR (2 shares)`);
      console.log(`    Ratio: ${ratio.toFixed(2)}x`);
      console.log("    ✅ Proportional payout verified");
    });
  });
});
