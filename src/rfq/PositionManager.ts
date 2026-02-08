import { Position, UserBalance, Trade, ShareSide, Direction } from './types.js';

const INITIAL_BALANCE_USD = 100000; // $1000 in cents for demo

export class PositionManager {
  private users: Map<string, UserBalance> = new Map();

  // Get or create user
  getOrCreateUser(userId: string): UserBalance {
    let user = this.users.get(userId);
    if (!user) {
      user = {
        odId: userId,
        visitorId: userId,
        balanceUSD: INITIAL_BALANCE_USD,
        positions: new Map()
      };
      this.users.set(userId, user);
    }
    return user;
  }

  // Get user balance
  getBalance(userId: string): number {
    const user = this.users.get(userId);
    return user?.balanceUSD ?? INITIAL_BALANCE_USD;
  }

  // Get user position for a market
  getPosition(userId: string, marketId: string): Position | null {
    const user = this.users.get(userId);
    if (!user) return null;
    return user.positions.get(marketId) || null;
  }

  // Get all positions for a user
  getAllPositions(userId: string): Position[] {
    const user = this.users.get(userId);
    if (!user) return [];
    return Array.from(user.positions.values());
  }

  // Check if user can afford a trade
  canAfford(userId: string, costCents: number): boolean {
    const balance = this.getBalance(userId);
    return balance >= costCents;
  }

  // Execute a trade - update balances and positions
  executeTrade(trade: Trade): { success: boolean; error?: string } {
    const user = this.getOrCreateUser(trade.odId || trade.visitorId);

    if (trade.direction === 'BUY') {
      // Check balance for buys
      if (user.balanceUSD < trade.totalCost) {
        return { success: false, error: 'Insufficient balance' };
      }

      // Deduct cost
      user.balanceUSD -= trade.totalCost;

      // Add shares
      let position = user.positions.get(trade.marketId);
      if (!position) {
        position = {
          odId: user.odId || user.visitorId,
          visitorId: user.visitorId,
          marketId: trade.marketId,
          yesShares: 0,
          noShares: 0,
          avgYesCost: 0,
          avgNoCost: 0
        };
        user.positions.set(trade.marketId, position);
      }

      if (trade.side === 'YES') {
        // Update average cost
        const totalCost = position.avgYesCost * position.yesShares + trade.totalCost;
        const totalShares = position.yesShares + trade.quantity;
        position.avgYesCost = totalShares > 0 ? totalCost / totalShares : 0;
        position.yesShares += trade.quantity;
      } else {
        const totalCost = position.avgNoCost * position.noShares + trade.totalCost;
        const totalShares = position.noShares + trade.quantity;
        position.avgNoCost = totalShares > 0 ? totalCost / totalShares : 0;
        position.noShares += trade.quantity;
      }

    } else {
      // SELL - check shares owned
      let position = user.positions.get(trade.marketId);
      if (!position) {
        return { success: false, error: 'No position to sell' };
      }

      if (trade.side === 'YES') {
        if (position.yesShares < trade.quantity) {
          return { success: false, error: 'Insufficient YES shares' };
        }
        position.yesShares -= trade.quantity;
      } else {
        if (position.noShares < trade.quantity) {
          return { success: false, error: 'Insufficient NO shares' };
        }
        position.noShares -= trade.quantity;
      }

      // Add proceeds to balance
      user.balanceUSD += trade.totalCost;
    }

    return { success: true };
  }

  // Settle positions for a market
  settleMarket(marketId: string, outcome: boolean): Map<string, number> {
    const payouts = new Map<string, number>();

    for (const [userId, user] of this.users) {
      const position = user.positions.get(marketId);
      if (!position) continue;

      let payout = 0;
      if (outcome) {
        // YES wins - YES shares worth 100 cents each
        payout = position.yesShares * 100;
      } else {
        // NO wins - NO shares worth 100 cents each
        payout = position.noShares * 100;
      }

      if (payout > 0) {
        user.balanceUSD += payout;
        payouts.set(userId, payout);
      }

      // Clear the position
      user.positions.delete(marketId);
    }

    return payouts;
  }

  // Get leaderboard
  getLeaderboard(limit: number = 10): Array<{ odId: string; visitorId: string; balanceUSD: number; totalPositionValue: number }> {
    const leaderboard: Array<{ odId: string; visitorId: string; balanceUSD: number; totalPositionValue: number }> = [];

    for (const [_userId, user] of this.users) {
      let positionValue = 0;
      for (const position of user.positions.values()) {
        // Estimate position value at 50 cents per share (simplified)
        positionValue += (position.yesShares + position.noShares) * 50;
      }

      leaderboard.push({
        odId: user.odId,
        visitorId: user.visitorId,
        balanceUSD: user.balanceUSD,
        totalPositionValue: user.balanceUSD + positionValue
      });
    }

    return leaderboard
      .sort((a, b) => b.totalPositionValue - a.totalPositionValue)
      .slice(0, limit);
  }

  // Add funds to user (for demo/testing)
  addFunds(userId: string, amountCents: number): number {
    const user = this.getOrCreateUser(userId);
    user.balanceUSD += amountCents;
    return user.balanceUSD;
  }

  // Get user summary
  getUserSummary(userId: string): {
    balanceUSD: number;
    positions: Array<Position & { marketId: string }>;
    totalPositionValue: number;
  } {
    const user = this.getOrCreateUser(userId);
    const positions: Array<Position & { marketId: string }> = [];
    let totalPositionValue = 0;

    for (const [marketId, position] of user.positions) {
      positions.push({ ...position, marketId });
      totalPositionValue += (position.yesShares + position.noShares) * 50;
    }

    return {
      balanceUSD: user.balanceUSD,
      positions,
      totalPositionValue: user.balanceUSD + totalPositionValue
    };
  }
}

// Singleton instance
export const positionManager = new PositionManager();
