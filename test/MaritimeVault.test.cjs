const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MaritimeVault", function () {
  let vault;
  let owner, operator, user1, user2;

  beforeEach(async function () {
    [owner, operator, user1, user2] = await ethers.getSigners();

    const MaritimeVault = await ethers.getContractFactory("MaritimeVault");
    vault = await MaritimeVault.deploy();
    await vault.waitForDeployment();

    // Set operator
    await vault.setOperator(operator.address);
  });

  describe("Market Creation", function () {
    it("should create a market", async function () {
      const expiresAt = Math.floor(Date.now() / 1000) + 86400; // 1 day from now
      
      await vault.connect(operator).createMarket(
        "9703318",
        "Will MSC Oscar be detained?",
        expiresAt
      );

      const market = await vault.getMarket(0);
      expect(market.vesselIMO).to.equal("9703318");
      expect(market.settled).to.equal(false);
    });

    it("should fail if non-operator creates market", async function () {
      const expiresAt = Math.floor(Date.now() / 1000) + 86400;
      
      await expect(
        vault.connect(user1).createMarket("9703318", "Test", expiresAt)
      ).to.be.revertedWith("Not operator");
    });
  });

  describe("Deposit & Emission", function () {
    beforeEach(async function () {
      const expiresAt = Math.floor(Date.now() / 1000) + 86400;
      await vault.connect(operator).createMarket("9703318", "Test Market", expiresAt);
    });

    it("should deposit FLR and mint YES+NO shares", async function () {
      const depositAmount = ethers.parseEther("1.0");
      
      await vault.connect(user1).deposit(0, { value: depositAmount });

      const position = await vault.getPosition(0, user1.address);
      expect(position.depositedFLR).to.equal(depositAmount);
      expect(position.yesShares).to.be.gt(0);
      expect(position.noShares).to.be.gt(0);
      // YES and NO shares should be equal on deposit
      expect(position.yesShares).to.equal(position.noShares);
    });

    it("should track total collateral", async function () {
      const depositAmount = ethers.parseEther("1.0");
      
      await vault.connect(user1).deposit(0, { value: depositAmount });
      await vault.connect(user2).deposit(0, { value: depositAmount });

      const market = await vault.getMarket(0);
      expect(market.totalCollateral).to.equal(depositAmount * 2n);
    });
  });

  describe("Redeem", function () {
    beforeEach(async function () {
      const expiresAt = Math.floor(Date.now() / 1000) + 86400;
      await vault.connect(operator).createMarket("9703318", "Test Market", expiresAt);
      await vault.connect(user1).deposit(0, { value: ethers.parseEther("1.0") });
    });

    it("should redeem paired shares for FLR", async function () {
      const position = await vault.getPosition(0, user1.address);
      const sharesToRedeem = position.yesShares / 2n; // Redeem half

      const balanceBefore = await ethers.provider.getBalance(user1.address);
      
      const tx = await vault.connect(user1).redeem(0, sharesToRedeem);
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const balanceAfter = await ethers.provider.getBalance(user1.address);
      
      // Balance should increase (minus gas)
      expect(balanceAfter + gasUsed).to.be.gt(balanceBefore);

      // Position should be reduced
      const newPosition = await vault.getPosition(0, user1.address);
      expect(newPosition.yesShares).to.be.lt(position.yesShares);
    });
  });

  describe("Position Commitment", function () {
    beforeEach(async function () {
      const expiresAt = Math.floor(Date.now() / 1000) + 86400;
      await vault.connect(operator).createMarket("9703318", "Test Market", expiresAt);
      await vault.connect(user1).deposit(0, { value: ethers.parseEther("1.0") });
      await vault.connect(user2).deposit(0, { value: ethers.parseEther("1.0") });
    });

    it("should commit positions from RFQ", async function () {
      // Simulate RFQ trading: user1 sold YES to user2
      const user1Yes = ethers.parseEther("0.3"); // 30% YES
      const user1No = ethers.parseEther("0.7");  // 70% NO
      const user2Yes = ethers.parseEther("0.7"); // 70% YES
      const user2No = ethers.parseEther("0.3");  // 30% NO

      await vault.connect(operator).commitPositions(
        0,
        [user1.address, user2.address],
        [user1Yes, user2Yes],
        [user1No, user2No]
      );

      const pos1 = await vault.getPosition(0, user1.address);
      const pos2 = await vault.getPosition(0, user2.address);

      expect(pos1.yesShares).to.equal(user1Yes);
      expect(pos1.noShares).to.equal(user1No);
      expect(pos2.yesShares).to.equal(user2Yes);
      expect(pos2.noShares).to.equal(user2No);
    });
  });

  describe("Settlement & Claims", function () {
    beforeEach(async function () {
      const expiresAt = Math.floor(Date.now() / 1000) + 86400;
      await vault.connect(operator).createMarket("9703318", "Test Market", expiresAt);
      await vault.connect(user1).deposit(0, { value: ethers.parseEther("1.0") });
      await vault.connect(user2).deposit(0, { value: ethers.parseEther("1.0") });

      // Commit positions: user1 has more YES, user2 has more NO
      await vault.connect(operator).commitPositions(
        0,
        [user1.address, user2.address],
        [ethers.parseEther("1.5"), ethers.parseEther("0.5")], // YES
        [ethers.parseEther("0.5"), ethers.parseEther("1.5")]  // NO
      );
    });

    it("should settle market with YES winning", async function () {
      await vault.connect(operator).settle(0, true); // YES wins

      const market = await vault.getMarket(0);
      expect(market.settled).to.equal(true);
      expect(market.outcome).to.equal(true);
    });

    it("should allow winner to claim", async function () {
      await vault.connect(operator).settle(0, true); // YES wins

      const balanceBefore = await ethers.provider.getBalance(user1.address);
      
      const tx = await vault.connect(user1).claim(0);
      await tx.wait();

      const balanceAfter = await ethers.provider.getBalance(user1.address);
      
      // user1 had 1.5 YES out of 2 total YES, should get 75% of pool (minus fee)
      expect(balanceAfter).to.be.gt(balanceBefore);
    });

    it("should not allow double claim", async function () {
      await vault.connect(operator).settle(0, true);
      await vault.connect(user1).claim(0);

      await expect(
        vault.connect(user1).claim(0)
      ).to.be.revertedWith("Already claimed");
    });

    it("should not allow claim before settlement", async function () {
      await expect(
        vault.connect(user1).claim(0)
      ).to.be.revertedWith("Not settled");
    });
  });

  describe("Full Flow Integration", function () {
    it("should handle complete prediction market lifecycle", async function () {
      // 1. Create market
      const expiresAt = Math.floor(Date.now() / 1000) + 86400;
      await vault.connect(operator).createMarket("9703318", "MSC Oscar Detention", expiresAt);
      console.log("    ✓ Market created");

      // 2. Users deposit
      await vault.connect(user1).deposit(0, { value: ethers.parseEther("2.0") });
      await vault.connect(user2).deposit(0, { value: ethers.parseEther("2.0") });
      console.log("    ✓ Users deposited 4 FLR total");

      // 3. Simulate RFQ trading (off-chain would update these)
      // user1 bought YES from user2, user2 bought NO from user1
      await vault.connect(operator).commitPositions(
        0,
        [user1.address, user2.address],
        [ethers.parseEther("3.0"), ethers.parseEther("1.0")], // YES: user1=3, user2=1
        [ethers.parseEther("1.0"), ethers.parseEther("3.0")]  // NO: user1=1, user2=3
      );
      console.log("    ✓ Positions committed from RFQ");

      // 4. Settle - YES wins (vessel was detained)
      await vault.connect(operator).settle(0, true);
      console.log("    ✓ Market settled: YES wins");

      // 5. Claims
      const user1BalanceBefore = await ethers.provider.getBalance(user1.address);
      await vault.connect(user1).claim(0);
      const user1BalanceAfter = await ethers.provider.getBalance(user1.address);
      
      const user2BalanceBefore = await ethers.provider.getBalance(user2.address);
      await vault.connect(user2).claim(0);
      const user2BalanceAfter = await ethers.provider.getBalance(user2.address);

      console.log("    ✓ Users claimed winnings");
      
      // user1 had 3/4 of YES shares, should get ~75% of 4 FLR = ~3 FLR (minus 2% fee)
      const user1Gain = user1BalanceAfter - user1BalanceBefore;
      const user2Gain = user2BalanceAfter - user2BalanceBefore;
      
      console.log(`    ✓ User1 received: ${ethers.formatEther(user1Gain)} FLR`);
      console.log(`    ✓ User2 received: ${ethers.formatEther(user2Gain)} FLR`);

      // Verify user1 got more (they had more YES shares)
      expect(user1Gain).to.be.gt(user2Gain);
    });
  });
});
