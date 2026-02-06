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
    collateralLocked: number;
}
export interface MintRecord {
    id: string;
    userId: string;
    marketId: string;
    amount: number;
    timestamp: number;
}
export declare class ShareMintingEngine {
    private balances;
    private mintHistory;
    private collateralPools;
    private userBalances;
    constructor();
    /**
     * Deposit USDC to user's account
     */
    deposit(userId: string, amount: number): number;
    /**
     * Get user's USDC balance
     */
    getBalance(userId: string): number;
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
    };
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
    };
    /**
     * SETTLE MARKET
     * Called by oracle when outcome is determined
     * Winners can redeem their shares for $1 each
     */
    settleMarket(marketId: string, yesWins: boolean): {
        totalPayout: number;
        winners: {
            userId: string;
            payout: number;
        }[];
    };
    /**
     * Get user's position in a market
     */
    getPosition(userId: string, marketId: string): ShareBalance;
    /**
     * Transfer shares between users (called by CLOB on trade execution)
     */
    transferShares(fromUserId: string, toUserId: string, marketId: string, shareType: 'YES' | 'NO', amount: number, pricePerShare: number): {
        success: boolean;
        error?: string;
    };
    /**
     * Get market statistics
     */
    getMarketStats(marketId: string): {
        collateralPool: number;
        totalYesShares: number;
        totalNoShares: number;
    };
}
export declare const shareMinting: ShareMintingEngine;
