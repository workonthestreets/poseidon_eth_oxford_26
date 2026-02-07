/**
 * Liquidity Incentive Mechanisms for MaritimeShield
 * 
 * Problem: How do we bootstrap liquidity when we launch?
 * Solution: Multiple incentive layers that attract different participants
 */

export interface LiquidityIncentives {
  // 1. Market Maker Rewards
  makerRewards: {
    description: "Rebates for providing liquidity";
    mechanism: "Negative fees for limit orders that add to book";
    example: "Place limit order → get 0.5% rebate when filled";
    beneficiary: "Professional MMs, trading firms";
  };

  // 2. Taker Fees → LP Pool
  takerFees: {
    description: "Small fee on market orders funds LP rewards";
    mechanism: "0.5-1% fee redistributed to liquidity providers";
    example: "Market buy 100 shares → $0.50 goes to LP pool";
    beneficiary: "Anyone providing two-sided quotes";
  };

  // 3. Insurance Premium Recycling
  premiumRecycling: {
    description: "Traditional insurers seed markets";
    mechanism: "Insurers deposit premium, get YES+NO, sell YES to hedgers";
    example: "Insurer deposits $100K, sells YES at 30¢, keeps NO";
    beneficiary: "Insurers (more efficient than underwriting)";
  };

  // 4. Data Provider Integration
  dataProviders: {
    description: "AIS/port data providers become MMs";
    mechanism: "They have information edge → can price accurately";
    example: "MarineTraffic runs MM bot using their congestion data";
    beneficiary: "Data companies (monetize data via trading)";
  };

  // 5. Shipowner Natural Hedge
  shipownerHedge: {
    description: "Shipowners sell YES (bet against themselves)";
    mechanism: "If vessel is on time, they profit from NO position";
    example: "Shipowner sells YES @ 35¢, vessel arrives on time → keeps 35¢";
    beneficiary: "Shipowners (earn premium for good performance)";
  };
}

/**
 * Why This Creates Liquidity (Unlike Polymarket)
 */
export const liquidityAdvantages = {
  verticalSpecialization: {
    problem: "Polymarket = general purpose, no shipping expertise",
    solution: "MaritimeShield = maritime only, attracts domain experts",
    result: "Natural counterparties find each other"
  },

  informationAsymmetry: {
    problem: "On Polymarket, no one knows shipping",
    solution: "Industry players have private info they can monetize",
    result: "Shipowners, ports, traders all have edge → willing to trade"
  },

  existingMarket: {
    problem: "Creating demand from scratch is hard",
    solution: "Demurrage insurance is $3-5B market already",
    result: "We're not creating demand, we're providing better venue"
  },

  parametricClarity: {
    problem: "Legal demurrage is ambiguous → hard to bet on",
    solution: "AIS-based parametric definition is objective",
    result: "MMs can price accurately → tighter spreads"
  },

  dataIntegration: {
    problem: "Retail can't analyze shipping risk",
    solution: "We integrate AIS, port data → pricing models",
    result: "Even non-experts can see fair value"
  }
};

/**
 * Bootstrap Strategy for MVP Launch
 */
export const bootstrapStrategy = {
  phase1_internal: {
    action: "Platform seeds initial liquidity",
    amount: "$50-100K per market",
    spread: "5-10% initially",
    goal: "Prove market mechanics work"
  },

  phase2_partnerships: {
    action: "Partner with 2-3 trading firms",
    incentive: "Exclusive MM rebates (1%)",
    requirement: "Must quote both sides, max 5% spread",
    goal: "Professional liquidity"
  },

  phase3_insurers: {
    action: "Onboard traditional marine insurers",
    pitch: "More efficient than underwriting individual policies",
    mechanism: "They provide NO liquidity (bet on good outcomes)",
    goal: "Deep institutional liquidity"
  },

  phase4_organic: {
    action: "Open to all participants",
    features: "LP tokens, yield farming on collateral",
    goal: "Self-sustaining liquidity"
  }
};

/**
 * Example: How a $100K Hedge Gets Filled
 */
export const hedgeExample = {
  scenario: "Charterer wants to hedge $100K demurrage exposure on MSC Oscar",
  
  step1: {
    action: "Charterer sees YES @ 35¢ ask (market price)",
    meaning: "Market thinks 35% chance of demurrage",
    cost: "$35,000 for $100K max payout"
  },

  step2: {
    whoProvides: [
      "Trading firm MM: 40% of order (algorithmic)",
      "Shipowner natural hedge: 30% (knows vessel is reliable)",
      "Insurer reinsurance: 20% (recycling premium)",
      "Data-driven MM: 10% (using AIS signals)"
    ]
  },

  step3: {
    outcome_demurrage: {
      charterer: "+$100K payout, -$35K cost = +$65K (offsets real loss)",
      counterparties: "-$100K (but they collected $35K premium)"
    },
    outcome_on_time: {
      charterer: "-$35K (but no demurrage cost)",
      counterparties: "+$35K profit"
    }
  },

  why_it_works: `
    Unlike Polymarket where no one understands shipping:
    - Counterparties have INFORMATION EDGE (they know vessels/ports)
    - Counterparties have NATURAL HEDGE (shipowners, ports)
    - Counterparties have CAPITAL (trading firms, insurers)
    - Counterparties have DATA (AIS providers)
    
    Everyone profits from their expertise, creating deep liquidity.
  `
};
