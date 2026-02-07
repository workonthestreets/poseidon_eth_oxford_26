/**
 * Share Minting System for Maritime Insurance Prediction Market
 * 
 * Core Principle: Every $1 of collateral creates 1 YES + 1 NO share
 * At resolution, winners redeem shares for $1 each
 * 
 * This is a simplified off-chain implementation.
 * Production would use on-chain ERC-1155 tokens (like Polymarket's CTF)
 */

export interface ShareBalance {
  yesShares: number;
  noShares: number;
  collateralLocked: number; // USD locked in minted sets
}

export interface MintRecord {
  id: string;
  userId: string;
  marketId: string;
  amount: number;
  timestamp: number;
}

export class ShareMintingEngine {
  // userId -> marketId -> balances
  private balances: Map<string, Map<string, ShareBalance>> = new Map();
  private mintHistory: MintRecord[] = [];
  
  // Market collateral pools (total USDC locked per market)
  private collateralPools: Map<string, number> = new Map();
  
  // User USDC balances (simulated)
  private userBalances: Map<string, number> = new Map();

  constructor() {}

  /**
   * Deposit USDC to user's account
   */
  deposit(userId: string, amount: number): number {
    const current = this.userBalances.get(userId) || 0;
    this.userBalances.set(userId, current + amount);
    return current + amount;
  }

  /**
   * Get user's USDC balance
   */
  getBalance(userId: string): number {
    return this.userBalances.get(userId) || 0;
  }

  /**
   * MINT COMPLETE SET
   * User deposits $X USDC, receives X YES shares + X NO shares
   * 
   * This is how shares enter the system - not from thin air,
   * but backed 1:1 by collateral
   */
  mintCompleteSet(userId: string, marketId: string, amount: number): {
    success: boolean;
    yesShares: number;
    noShares: number;
    error?: string;
  } {
    const balance = this.getBalance(userId);
    
    if (amount <= 0) {
      return { success: false, yesShares: 0, noShares: 0, error: 'Amount must be positive' };
    }
    
    if (balance < amount) {
      return { success: false, yesShares: 0, noShares: 0, error: 'Insufficient USDC balance' };
    }

    // Deduct USDC from user
    this.userBalances.set(userId, balance - amount);
    
    // Add to market's collateral pool
    const poolBalance = this.collateralPools.get(marketId) || 0;
    this.collateralPools.set(marketId, poolBalance + amount);

    // Credit shares to user
    if (!this.balances.has(userId)) {
      this.balances.set(userId, new Map());
    }
    const userMarkets = this.balances.get(userId)!;
    
    if (!userMarkets.has(marketId)) {
      userMarkets.set(marketId, { yesShares: 0, noShares: 0, collateralLocked: 0 });
    }
    
    const pos = userMarkets.get(marketId)!;
    pos.yesShares += amount;
    pos.noShares += amount;
    pos.collateralLocked += amount;

    // Record mint
    this.mintHistory.push({
      id: `mint-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      userId,
      marketId,
      amount,
      timestamp: Date.now()
    });

    return {
      success: true,
      yesShares: amount,
      noShares: amount
    };
  }

  /**
   * REDEEM COMPLETE SET
   * User returns X YES + X NO shares, receives $X USDC back
   * 
   * Useful for market makers who want to exit without price risk
   */
  redeemCompleteSet(userId: string, marketId: string, amount: number): {
    success: boolean;
    usdcReturned: number;
    error?: string;
  } {
    const pos = this.getPosition(userId, marketId);
    
    if (pos.yesShares < amount || pos.noShares < amount) {
      return { 
        success: false, 
        usdcReturned: 0, 
        error: 'Insufficient shares for complete set redemption' 
      };
    }

    // Burn shares
    pos.yesShares -= amount;
    pos.noShares -= amount;
    pos.collateralLocked -= amount;

    // Return collateral from pool
    const poolBalance = this.collateralPools.get(marketId) || 0;
    this.collateralPools.set(marketId, poolBalance - amount);

    // Credit USDC to user
    const userBalance = this.getBalance(userId);
    this.userBalances.set(userId, userBalance + amount);

    return {
      success: true,
      usdcReturned: amount
    };
  }

  /**
   * SETTLE MARKET
   * Called by oracle when outcome is determined
   * Winners can redeem their shares for $1 each
   */
  settleMarket(marketId: string, yesWins: boolean): {
    totalPayout: number;
    winners: { userId: string; payout: number }[];
  } {
    const winners: { userId: string; payout: number }[] = [];
    let totalPayout = 0;

    // Iterate all users with positions in this market
    this.balances.forEach((markets, userId) => {
      const pos = markets.get(marketId);
      if (!pos) return;

      let payout = 0;
      if (yesWins) {
        payout = pos.yesShares; // Each YES share = $1
      } else {
        payout = pos.noShares; // Each NO share = $1
      }

      if (payout > 0) {
        // Credit winnings to user
        const balance = this.getBalance(userId);
        this.userBalances.set(userId, balance + payout);
        
        winners.push({ userId, payout });
        totalPayout += payout;
      }

      // Clear position
      pos.yesShares = 0;
      pos.noShares = 0;
      pos.collateralLocked = 0;
    });

    // Clear collateral pool
    this.collateralPools.set(marketId, 0);

    return { totalPayout, winners };
  }

  /**
   * Get user's position in a market
   */
  getPosition(userId: string, marketId: string): ShareBalance {
    const userMarkets = this.balances.get(userId);
    if (!userMarkets) {
      return { yesShares: 0, noShares: 0, collateralLocked: 0 };
    }
    return userMarkets.get(marketId) || { yesShares: 0, noShares: 0, collateralLocked: 0 };
  }

  /**
   * Transfer shares between users (called by CLOB on trade execution)
   */
  transferShares(
    fromUserId: string,
    toUserId: string,
    marketId: string,
    shareType: 'YES' | 'NO',
    amount: number,
    pricePerShare: number // in cents (0-100)
  ): { success: boolean; error?: string } {
    const fromPos = this.getPosition(fromUserId, marketId);
    const toBalance = this.getBalance(toUserId);
    const cost = (amount * pricePerShare) / 100; // Convert cents to dollars

    // Check seller has shares
    if (shareType === 'YES' && fromPos.yesShares < amount) {
      return { success: false, error: 'Seller has insufficient YES shares' };
    }
    if (shareType === 'NO' && fromPos.noShares < amount) {
      return { success: false, error: 'Seller has insufficient NO shares' };
    }

    // Check buyer has funds
    if (toBalance < cost) {
      return { success: false, error: 'Buyer has insufficient funds' };
    }

    // Execute transfer
    // 1. Move USDC from buyer to seller
    this.userBalances.set(toUserId, toBalance - cost);
    this.userBalances.set(fromUserId, this.getBalance(fromUserId) + cost);

    // 2. Move shares from seller to buyer
    if (!this.balances.has(toUserId)) {
      this.balances.set(toUserId, new Map());
    }
    if (!this.balances.get(toUserId)!.has(marketId)) {
      this.balances.get(toUserId)!.set(marketId, { yesShares: 0, noShares: 0, collateralLocked: 0 });
    }

    const toPos = this.balances.get(toUserId)!.get(marketId)!;

    if (shareType === 'YES') {
      fromPos.yesShares -= amount;
      toPos.yesShares += amount;
    } else {
      fromPos.noShares -= amount;
      toPos.noShares += amount;
    }

    return { success: true };
  }

  /**
   * Get market statistics
   */
  getMarketStats(marketId: string): {
    collateralPool: number;
    totalYesShares: number;
    totalNoShares: number;
  } {
    let totalYes = 0;
    let totalNo = 0;

    this.balances.forEach((markets) => {
      const pos = markets.get(marketId);
      if (pos) {
        totalYes += pos.yesShares;
        totalNo += pos.noShares;
      }
    });

    return {
      collateralPool: this.collateralPools.get(marketId) || 0,
      totalYesShares: totalYes,
      totalNoShares: totalNo
    };
  }
}

// Singleton instance
export const shareMinting = new ShareMintingEngine();
