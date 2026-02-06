"use strict";
/**
 * Initial Price Discovery for Maritime Demurrage Markets
 *
 * The initial implied probability comes from:
 * 1. Historical demurrage rates for similar routes
 * 2. Real-time factors (port congestion, weather, vessel data)
 * 3. Platform seeds liquidity around this probability
 *
 * After launch, the MARKET determines the price through trading
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.priceDiscovery = exports.PriceDiscoveryEngine = void 0;
// Historical demurrage rates by route (would come from real data)
const HISTORICAL_RATES = {
    'Shanghai → Rotterdam': 0.28,
    'Shanghai → Los Angeles': 0.22,
    'Singapore → Rotterdam': 0.18,
    'Felixstowe → Singapore': 0.15,
    'Los Angeles → Tokyo': 0.12,
    'Rotterdam → New York': 0.20,
    'default': 0.20
};
// Port congestion data (would come from MarineTraffic API, etc.)
const PORT_CONGESTION = {
    'Shanghai': 0.65,
    'Rotterdam': 0.45,
    'Los Angeles': 0.70,
    'Singapore': 0.35,
    'Felixstowe': 0.40,
    'Tokyo': 0.30,
    'New York': 0.55,
    'default': 0.40
};
class PriceDiscoveryEngine {
    /**
     * Calculate initial implied probability for a new market
     * This is what sets the "fair" starting price
     */
    calculateInitialProbability(factors) {
        // Base rate from historical data
        let probability = factors.historicalDemurrageRate;
        // Adjust for current port congestion
        // High congestion = higher demurrage probability
        const congestionAdjustment = (factors.portCongestionIndex - 0.4) * 0.15;
        probability += congestionAdjustment;
        // Adjust for weather
        // Bad weather = higher demurrage probability
        const weatherAdjustment = factors.weatherRisk * 0.10;
        probability += weatherAdjustment;
        // Adjust for vessel reliability
        // Unreliable vessels = higher demurrage probability
        const reliabilityAdjustment = (0.5 - factors.vesselReliabilityScore) * 0.08;
        probability += reliabilityAdjustment;
        // Seasonal adjustment
        probability += factors.seasonalAdjustment;
        // Clamp to valid range
        probability = Math.max(0.05, Math.min(0.95, probability));
        // Calculate confidence (how certain we are in this estimate)
        // Lower confidence = wider spread
        const confidence = this.calculateConfidence(factors);
        // Spread based on confidence (200-800 bps)
        const spreadBps = Math.round(800 - (confidence * 600));
        // Seed liquidity based on market size potential
        const seedLiquidityUsd = this.calculateSeedLiquidity(factors);
        return {
            impliedProbability: Math.round(probability * 100), // Convert to cents
            confidence,
            spreadBps,
            seedLiquidityUsd
        };
    }
    /**
     * Calculate confidence in our probability estimate
     */
    calculateConfidence(factors) {
        // More data = higher confidence
        let confidence = 0.5;
        // Historical data availability
        if (HISTORICAL_RATES[factors.route]) {
            confidence += 0.2; // Known route
        }
        // Recent port data
        if (factors.portCongestionIndex > 0) {
            confidence += 0.15;
        }
        // Weather forecast reliability decreases with time
        confidence += 0.1;
        return Math.min(0.95, confidence);
    }
    /**
     * Calculate how much liquidity to seed
     */
    calculateSeedLiquidity(factors) {
        // Base: $5,000
        let liquidity = 5000;
        // Popular routes get more liquidity
        if (['Shanghai → Rotterdam', 'Shanghai → Los Angeles'].includes(factors.route)) {
            liquidity *= 2;
        }
        return liquidity;
    }
    /**
     * Generate initial orderbook from pricing
     * This is what the platform places when market opens
     */
    generateInitialOrderbook(pricing) {
        const midPrice = pricing.impliedProbability;
        const halfSpread = Math.ceil(pricing.spreadBps / 100 / 2);
        const sharesPerLevel = Math.floor(pricing.seedLiquidityUsd / 10); // $10 per level
        const bids = [];
        const asks = [];
        // Create 5 levels on each side
        for (let i = 0; i < 5; i++) {
            const bidPrice = Math.max(1, midPrice - halfSpread - (i * 2));
            const askPrice = Math.min(99, midPrice + halfSpread + (i * 2));
            // More liquidity near the mid
            const quantity = Math.floor(sharesPerLevel * (1 - i * 0.15));
            bids.push({ price: bidPrice, quantity });
            asks.push({ price: askPrice, quantity });
        }
        return { bids, asks };
    }
    /**
     * Quick helper to get factors for common routes
     */
    getRouteFactors(route, destinationPort, weatherRisk = 0.3, vesselAge = 5) {
        return {
            route,
            historicalDemurrageRate: HISTORICAL_RATES[route] || HISTORICAL_RATES['default'],
            portCongestionIndex: PORT_CONGESTION[destinationPort] || PORT_CONGESTION['default'],
            weatherRisk,
            vesselReliabilityScore: Math.max(0.3, 1 - (vesselAge * 0.05)), // Older = less reliable
            seasonalAdjustment: this.getSeasonalAdjustment()
        };
    }
    /**
     * Seasonal adjustment (Q4 = peak shipping, more congestion)
     */
    getSeasonalAdjustment() {
        const month = new Date().getMonth();
        if (month >= 9 && month <= 11)
            return 0.05; // Oct-Dec: peak season
        if (month >= 0 && month <= 1)
            return 0.03; // Jan-Feb: post-holiday
        if (month >= 6 && month <= 8)
            return -0.02; // Summer: slower
        return 0;
    }
}
exports.PriceDiscoveryEngine = PriceDiscoveryEngine;
// Example usage:
/*
const discovery = new PriceDiscoveryEngine();

// New market: MSC Oscar, Shanghai to Rotterdam
const factors = discovery.getRouteFactors('Shanghai → Rotterdam', 'Rotterdam', 0.4, 8);
const pricing = discovery.calculateInitialProbability(factors);

console.log(pricing);
// {
//   impliedProbability: 36,  // 36 cents = 36% chance of demurrage
//   confidence: 0.85,
//   spreadBps: 290,          // 2.9% spread
//   seedLiquidityUsd: 10000
// }

const orderbook = discovery.generateInitialOrderbook(pricing);
// Platform places these orders to seed the market
*/
exports.priceDiscovery = new PriceDiscoveryEngine();
