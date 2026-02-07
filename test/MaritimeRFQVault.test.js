import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;

describe("MaritimeRFQVault", function () {
  let vault;
  let owner, operator, oracle, alice, bob;
  
  beforeEach(async function () {
    [owner, operator, oracle, alice, bob] = await ethers.getSigners();
    
    const RFQVault = await ethers.getContractFactory("MaritimeRFQVault");
    vault = await RFQVault.deploy();
    await vault.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set owner correctly", async function () {
      expect(await vault.owner()).to.equal(owner.address);
    });

    it("Should set operator to owner initially", async function () {
      expect(await vault.operator()).to.equal(owner.address);
    });

    it("Should set oracle to owner initially", async function () {
      expect(await vault.oracle()).to.equal(owner.address);
    });
  });

  describe("Deposits", function () {
    it("Should accept FLR deposits", async function () {
      const depositAmount = ethers.parseEther("10");
      await vault.connect(alice).deposit({ value: depositAmount });
      
      expect(await vault.deposits(alice.address)).to.equal(depositAmount);
    });

    it("Should allow withdrawals", async function () {
      const depositAmount = ethers.parseEther("10");
      await vault.connect(alice).deposit({ value: depositAmount });
      
      const withdrawAmount = ethers.parseEther("5");
      await vault.connect(alice).withdraw(withdrawAmount);
      
      expect(await vault.deposits(alice.address)).to.equal(ethers.parseEther("5"));
    });
  });

  describe("Market Creation", function () {
    it("Should create markets", async function () {
      const marketUUID = ethers.id("test-market-1");
      const expiresAt = Math.floor(Date.now() / 1000) + 86400;
      
      await vault.createMarket(
        marketUUID,
        "9525338",
        "Will vessel be detained?",
        expiresAt
      );
      
      const market = await vault.getMarket(0);
      expect(market.vesselIMO).to.equal("9525338");
      expect(market.settled).to.equal(false);
    });

    it("Should increment market count", async function () {
      const marketUUID1 = ethers.id("test-market-1");
      const marketUUID2 = ethers.id("test-market-2");
      const expiresAt = Math.floor(Date.now() / 1000) + 86400;
      
      await vault.createMarket(marketUUID1, "9525338", "Test", expiresAt);
      await vault.createMarket(marketUUID2, "9525339", "Test 2", expiresAt);
      
      expect(await vault.marketCount()).to.equal(2);
    });
  });

  describe("Share Emission", function () {
    let marketId;
    const shares = 100n;
    const yesPrice = 60n;
    const noPrice = 40n;
    
    beforeEach(async function () {
      // Create market
      const marketUUID = ethers.id("test-market");
      const expiresAt = Math.floor(Date.now() / 1000) + 86400;
      await vault.createMarket(marketUUID, "9525338", "Test", expiresAt);
      marketId = 0n;
      
      // Set a mock FLR price (skip FTSO on local network)
      // We'll use the setTestPrice function if available, or skip price-dependent tests
      
      // Deposits with enough for share emission
      // At default $0.02/FLR: 100 shares × $0.60/YES = $60 = 3000 FLR for Alice
      //                       100 shares × $0.40/NO  = $40 = 2000 FLR for Bob
      await vault.connect(alice).deposit({ value: ethers.parseEther("4000") });
      await vault.connect(bob).deposit({ value: ethers.parseEther("3000") });
    });

    it("Should emit shares with valid signature", async function () {
      const nonce = 1n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

      // Get EIP-712 domain
      const domain = {
        name: "MaritimeRFQVault",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await vault.getAddress()
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

      const value = {
        marketId: marketId,
        yesUser: alice.address,
        noUser: bob.address,
        quantity: shares,
        yesPrice: yesPrice,
        noPrice: noPrice,
        nonce: nonce,
        deadline: deadline
      };

      // Sign with operator (owner in this case)
      const signature = await owner.signTypedData(domain, types, value);

      // Emit shares
      await vault.emitShares(
        marketId,
        alice.address,
        bob.address,
        shares,
        yesPrice,
        noPrice,
        nonce,
        deadline,
        signature
      );

      // Check positions
      const alicePos = await vault.getPosition(marketId, alice.address);
      const bobPos = await vault.getPosition(marketId, bob.address);

      expect(alicePos.yesShares).to.equal(shares);
      expect(alicePos.noShares).to.equal(0);
      expect(bobPos.yesShares).to.equal(0);
      expect(bobPos.noShares).to.equal(shares);
    });

    it("Should reject invalid price sum", async function () {
      const nonce = 1n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const invalidYesPrice = 60n;
      const invalidNoPrice = 50n; // 60 + 50 = 110 != 100

      const domain = {
        name: "MaritimeRFQVault",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await vault.getAddress()
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

      const value = {
        marketId: marketId,
        yesUser: alice.address,
        noUser: bob.address,
        quantity: shares,
        yesPrice: invalidYesPrice,
        noPrice: invalidNoPrice,
        nonce: nonce,
        deadline: deadline
      };

      const signature = await owner.signTypedData(domain, types, value);

      await expect(
        vault.emitShares(
          marketId,
          alice.address,
          bob.address,
          shares,
          invalidYesPrice,
          invalidNoPrice,
          nonce,
          deadline,
          signature
        )
      ).to.be.revertedWith("Prices must sum to 100");
    });
  });

  describe("Settlement", function () {
    let marketId;
    let user1, user2; // Fresh users for settlement tests
    
    beforeEach(async function () {
      // Get fresh signers that haven't been depleted by previous tests
      const signers = await ethers.getSigners();
      user1 = signers[5]; // Use different accounts
      user2 = signers[6];
      
      const marketUUID = ethers.id("settlement-test-market");
      const expiresAt = Math.floor(Date.now() / 1000) + 86400;
      await vault.createMarket(marketUUID, "9525338", "Test", expiresAt);
      marketId = 0n;
      
      // Smaller deposits - accounts are reused in beforeEach
      await vault.connect(user1).deposit({ value: ethers.parseEther("500") });
      await vault.connect(user2).deposit({ value: ethers.parseEther("500") });

      const nonce = 1n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

      const domain = {
        name: "MaritimeRFQVault",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await vault.getAddress()
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

      // Use smaller quantity for tests (10 shares instead of 100)
      const testQty = 10n;
      const value = {
        marketId: marketId,
        yesUser: user1.address,
        noUser: user2.address,
        quantity: testQty,
        yesPrice: 60n,
        noPrice: 40n,
        nonce: nonce,
        deadline: deadline
      };

      const signature = await owner.signTypedData(domain, types, value);
      await vault.emitShares(marketId, user1.address, user2.address, testQty, 60n, 40n, nonce, deadline, signature);
    });

    it("Should settle market (YES wins)", async function () {
      await vault.settle(marketId, true);
      
      const market = await vault.getMarket(marketId);
      expect(market.settled).to.equal(true);
      expect(market.outcome).to.equal(true);
    });

    it("Should allow winner to claim", async function () {
      await vault.settle(marketId, true); // YES wins
      
      // Get market info to calculate expected payout
      const market = await vault.getMarket(marketId);
      const position = await vault.getPosition(marketId, user1.address);
      
      console.log("      Market total collateral:", ethers.formatEther(market.totalCollateral), "FLR");
      console.log("      Market total shares:", market.totalShares.toString());
      console.log("      User1 YES shares:", position.yesShares.toString());
      
      const depositBefore = await vault.deposits(user1.address);
      console.log("      Deposit before claim:", ethers.formatEther(depositBefore), "FLR");
      
      await vault.connect(user1).claim(marketId);
      
      const depositAfter = await vault.deposits(user1.address);
      console.log("      Deposit after claim:", ethers.formatEther(depositAfter), "FLR");
      
      const payout = depositAfter - depositBefore;
      console.log("      Payout received:", ethers.formatEther(payout), "FLR");
      
      // user1 should receive the market collateral minus 2% fee
      expect(depositAfter).to.be.gt(depositBefore);
      expect(payout).to.be.gt(0);
    });

    it("Should verify loser's collateral went to winner", async function () {
      // Get full picture BEFORE settlement
      const market = await vault.getMarket(marketId);
      const user1Pos = await vault.getPosition(marketId, user1.address);
      const user2Pos = await vault.getPosition(marketId, user2.address);
      const user1DepositBefore = await vault.deposits(user1.address);
      const user2DepositBefore = await vault.deposits(user2.address);
      
      console.log("\n      === BEFORE SETTLEMENT ===");
      console.log("      Market total collateral:", ethers.formatEther(market.totalCollateral), "FLR");
      console.log("      User1 (YES holder): deposit=" + ethers.formatEther(user1DepositBefore) + " FLR, shares=" + user1Pos.yesShares);
      console.log("      User2 (NO holder): deposit=" + ethers.formatEther(user2DepositBefore) + " FLR, shares=" + user2Pos.noShares);
      
      // Settle - YES wins
      await vault.settle(marketId, true);
      
      // Winner claims
      await vault.connect(user1).claim(marketId);
      
      const user1DepositAfter = await vault.deposits(user1.address);
      const user2DepositAfter = await vault.deposits(user2.address);
      
      console.log("\n      === AFTER SETTLEMENT (YES wins) ===");
      console.log("      User1 (WINNER) deposit:", ethers.formatEther(user1DepositAfter), "FLR");
      console.log("      User2 (LOSER) deposit:", ethers.formatEther(user2DepositAfter), "FLR");
      
      const user1Gain = user1DepositAfter - user1DepositBefore;
      console.log("\n      User1 gained:", ethers.formatEther(user1Gain), "FLR (from market collateral - 2% fee)");
      console.log("      User2 lost: their collateral is trapped in market, NO shares worthless");
      
      // VERIFY: Winner got the collateral (minus fee)
      // Market had 500 FLR, winner gets 500 - 2% = 490 FLR
      expect(user1Gain).to.equal(ethers.parseEther("490"));
      
      // VERIFY: Loser cannot claim anything
      await expect(
        vault.connect(user2).claim(marketId)
      ).to.be.revertedWith("No winning shares");
      
      // Loser's deposit is what's LEFT after their collateral was locked
      // They deposited 500 FLR, ~200 FLR was locked as collateral for NO shares
      // The remaining 300 FLR is still theirs, but the 200 FLR collateral is GONE
    });
  });
});
