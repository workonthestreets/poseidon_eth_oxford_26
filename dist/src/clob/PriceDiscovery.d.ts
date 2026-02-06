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
export interface RouteRiskFactors {
    route: string;
    historicalDemurrageRate: number;
    portCongestionIndex: number;
    weatherRisk: number;
    vesselReliabilityScore: number;
    seasonalAdjustment: number;
}
export interface InitialPricing {
    impliedProbability: number;
    confidence: number;
    spreadBps: number;
    seedLiquidityUsd: number;
}
export declare class PriceDiscoveryEngine {
    /**
     * Calculate initial implied probability for a new market
     * This is what sets the "fair" starting price
     */
    calculateInitialProbability(factors: RouteRiskFactors): InitialPricing;
    /**
     * Calculate confidence in our probability estimate
     */
    private calculateConfidence;
    /**
     * Calculate how much liquidity to seed
     */
    private calculateSeedLiquidity;
    /**
     * Generate initial orderbook from pricing
     * This is what the platform places when market opens
     */
    generateInitialOrderbook(pricing: InitialPricing): {
        bids: {
            price: number;
            quantity: number;
        }[];
        asks: {
            price: number;
            quantity: number;
        }[];
    };
    /**
     * Quick helper to get factors for common routes
     */
    getRouteFactors(route: string, destinationPort: string, weatherRisk?: number, vesselAge?: number): RouteRiskFactors;
    /**
     * Seasonal adjustment (Q4 = peak shipping, more congestion)
     */
    private getSeasonalAdjustment;
}
export declare const priceDiscovery: PriceDiscoveryEngine;
