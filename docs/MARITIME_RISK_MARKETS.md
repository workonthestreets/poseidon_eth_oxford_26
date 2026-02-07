# Maritime Risk Prediction Markets - Deep Research

## Risk Factors Overview

| Risk | Description | Data Availability | Market Feasibility |
|------|-------------|-------------------|-------------------|
| **1. Demurrage** | Charge for delayed loading/discharge | ✅ HIGH (Terminal49, AIS) | ✅ READY |
| **2. Leakage/VEF** | Cargo quantity discrepancy | ⚠️ LIMITED (Navarik - enterprise) | ⚠️ COMPLEX |
| **3. Ship Sinking** | Vessel casualty/total loss | ✅ HIGH (Datalastic, VesselLink) | ✅ READY |
| **4. ~~Geopolitical~~** | War/seizure risk | EXCLUDED | - |
| **5. ~~Commodities~~** | Oil/gold hedging | FUTURE | - |

---

## WINNER: Ship Casualty/Sinking Markets

### Why This Risk Factor?

**Datalastic Ship Casualty API** provides:
- ✅ Instant API access (€9 first month)
- ✅ Global coverage of maritime accidents
- ✅ Weekly data updates
- ✅ Historical casualty database
- ✅ Severity classifications
- ✅ Vessel identification (IMO, name)

**This is the ONLY risk factor with affordable, instant API access.**

---

## Datalastic Ship Casualty API

### Sign Up (5 Minutes)

1. Go to: https://datalastic.com/pricing
2. Click "Get Your API Key"
3. Choose Starter plan (€9 first month, €199/mo after)
4. Pay with credit card
5. **API key delivered instantly**

### Pricing

| Plan | First Month | Then | Credits |
|------|-------------|------|---------|
| Starter | €9 | €199/mo | 20,000 |
| Experimenter | €19 | €569/mo | 80,000 |
| Developer Pro+ | €45 | €679/mo | Unlimited |

**Ship Casualty Data specifically:** €29 first week → €399/mo

### API Endpoints

```bash
# Get casualty by IMO
curl "https://api.datalastic.com/api/v0/ship_casualty?api-key=YOUR_KEY&imo=9811000"

# Get casualties by date range
curl "https://api.datalastic.com/api/v0/ship_casualty?api-key=YOUR_KEY&date_from=2024-01-01&date_to=2024-12-31"
```

### Data Fields

| Field | Description | Use for Markets |
|-------|-------------|-----------------|
| `casualty_date` | When incident occurred | Settlement timestamp |
| `casualty_type` | Collision, Fire, Sinking, etc. | Market type |
| `severity` | Very Serious, Serious, Minor | Payout tiers |
| `vessel_imo` | Unique vessel ID | Market identifier |
| `vessel_name` | Ship name | Display |
| `location` | Where it happened | Route-based markets |

---

## VesselLink Marine Casualty API (Alternative)

### Features

- **Source:** IMO GISIS (official database)
- **Coverage:** Global
- **Update:** Monthly
- **Format:** JSON

### API Endpoint

```bash
# Spatial search (by location)
curl "https://api.vessellink.com/v1/marineCasualties?lat=35.43&long=134.23&radius=100"

# Annual search (by year)
curl "https://api.vessellink.com/v1/marineCasualties/annual?year=2024"
```

### Casualty Types for Markets

| Type | SubType | Market Example |
|------|---------|----------------|
| Collision | with other ship | "Will vessel X have collision on route Y?" |
| Stranding/Grounding | under power | "Grounding incident in Suez Canal?" |
| Fire/Explosion | fire | "Fire incident on tanker route?" |
| Foundering/Flooding | - | "Ship sinking on Pacific route?" |
| Capsize/listing | - | "Cargo shift incident?" |
| Damage to Ship | loss of propulsion | "Engine failure requiring rescue?" |

### Severity Levels (for Market Tiers)

| Severity | Description | Typical Payout |
|----------|-------------|----------------|
| Very Serious | Total loss, death, severe pollution | 100% |
| Serious | Significant damage, injury | 75% |
| Less Serious | Minor damage | 50% |
| Marine Incident | Near-miss, no damage | 25% |

---

## Market Design: Ship Casualty Prediction

### Market Type 1: Route-Based Casualty

```
MARKET: "Will a Very Serious casualty occur on Shanghai-Rotterdam route this month?"

PARAMETERS:
- Route: CNSHA → NLRTM
- Timeframe: 30 days
- Severity: Very Serious only
- Vessel types: All commercial

SETTLEMENT:
- Check Datalastic API for casualties
- Filter by lat/long bounding box of route
- Filter by severity = "Very Serious"
- YES wins if count > 0
```

### Market Type 2: Vessel-Specific

```
MARKET: "Will MSC Oscar complete voyage without incident?"

PARAMETERS:
- Vessel IMO: 9703318
- Voyage: Current active voyage
- Incident types: Any casualty

SETTLEMENT:
- Monitor vessel via AIS (AISStream)
- Check casualty API on voyage completion
- YES wins if no incidents recorded
```

### Market Type 3: Fleet/Route Risk Index

```
MARKET: "Casualty rate on Strait of Hormuz > 0.5% this quarter?"

PARAMETERS:
- Location: Strait of Hormuz bounding box
- Timeframe: 90 days
- Metric: (casualties / transits) × 100

SETTLEMENT:
- Count casualties from API
- Count transits from AIS data
- Calculate rate
- YES wins if rate > 0.5%
```

---

## Other Risk Factors (Detailed Analysis)

### 2. Leakage / VEF (Vessel Experience Factor)

**What is VEF?**
- Measures cargo quantity discrepancy between ship and shore
- Calculated from minimum 5 voyages
- Industry standard per API MPMS 17.9
- Used for tankers (oil, chemicals)

**Data Providers:**

| Provider | Access | Pricing |
|----------|--------|---------|
| **Navarik** | Enterprise only | Contact sales |
| **Vortexa** | Enterprise API | Contact sales |
| **VesselsValue** | API from £1,500/yr | Quote required |

**Why It's Difficult:**
- VEF data is proprietary (oil majors control it)
- Calculated from confidential inspection reports
- No public API with instant access
- Requires relationships with cargo owners

**Market Potential:**
- Could create markets on "VEF deviation > 0.3%"
- Would need partnership with Navarik or oil company
- High-value but limited accessibility

### 3. Ship Sinking (Total Loss)

**Already covered above with Datalastic API**

Additional data sources:
- Lloyd's List Intelligence (enterprise, contact sales)
- S&P Global Casualty Module (enterprise)
- IMO GISIS (public, no API)

### 4. Demurrage (Already Documented)

See `MARITIME_MARKET_PARAMETERS.md` for full details.

**Best Provider:** Terminal49 (contact sales@terminal49.com)

---

## Recommended Implementation Path

### Phase 1: Ship Casualty Markets (Start Now)

```
Week 1:
├── Sign up for Datalastic (€9)
├── Test Ship Casualty API
├── Design 3 market types
└── Build settlement logic

Week 2:
├── Integrate with CLOB
├── Create demo markets
├── Test end-to-end flow
```

### Phase 2: Demurrage Markets (When Revenue Comes)

```
Month 2:
├── Contact Terminal49
├── Get LFD/demurrage data
├── Build demurrage settlement
```

### Phase 3: VEF/Leakage Markets (Enterprise)

```
Month 6+:
├── Partner with oil company or Navarik
├── Get VEF data access
├── Design cargo discrepancy markets
```

---

## API Comparison Summary

| API | Risk Type | Cost | Instant Access | Best For |
|-----|-----------|------|----------------|----------|
| **Datalastic Casualty** | Ship Sinking | €29/week | ✅ YES | MVP |
| **VesselLink** | Ship Sinking | TBD | ✅ YES | Alternative |
| **AISStream** | Vessel Position | FREE | ✅ YES | Tracking |
| **Terminal49** | Demurrage | Enterprise | ❌ Contact | LFD data |
| **Navarik** | VEF/Leakage | Enterprise | ❌ Contact | Oil cargo |

---

## Quick Start: Ship Casualty Markets

### Step 1: Get API Key

```bash
# Sign up at https://datalastic.com/pricing
# Get API key instantly after payment (€9)
```

### Step 2: Test API

```bash
# Get recent casualties
curl "https://api.datalastic.com/api/v0/ship_casualties?api-key=YOUR_KEY"

# Get casualty for specific vessel
curl "https://api.datalastic.com/api/v0/ship_casualty?api-key=YOUR_KEY&imo=9811000"
```

### Step 3: Create Market

```rust
// In your Rust CLOB, create market
let market = Market::new_casualty(
    vessel_imo: "9703318",
    vessel_name: "MSC Oscar",
    route: "Shanghai → Rotterdam",
    voyage_start: "2024-03-01",
    voyage_end: "2024-03-21",
    casualty_types: vec!["Collision", "Fire", "Foundering"],
);
```

### Step 4: Settlement Logic

```rust
async fn check_settlement(market: &Market) -> MarketOutcome {
    // Fetch casualties from Datalastic
    let casualties = datalastic_api.get_casualties(
        imo: market.vessel_imo,
        from: market.voyage_start,
        to: market.voyage_end,
    ).await;
    
    // Check if any qualifying casualty occurred
    let qualifying = casualties.iter()
        .filter(|c| market.casualty_types.contains(&c.casualty_type))
        .filter(|c| c.severity == "Very Serious" || c.severity == "Serious")
        .count();
    
    if qualifying > 0 {
        MarketOutcome::Yes  // Casualty occurred
    } else {
        MarketOutcome::No   // Safe voyage
    }
}
```

---

## Sample Market Ideas

### High-Risk Route Markets

| Route | Risk Level | Market Question |
|-------|------------|-----------------|
| Strait of Hormuz | HIGH | "Major incident this week?" |
| Suez Canal | MEDIUM | "Grounding incident this month?" |
| South China Sea | HIGH | "Collision incident this quarter?" |
| English Channel | MEDIUM | "Fog-related collision this winter?" |

### Vessel Type Markets

| Vessel Type | Typical Risk | Market Question |
|-------------|--------------|-----------------|
| Container Ships | Collision, Fire | "Fire on mega-containership?" |
| Tankers | Collision, Explosion | "Tanker incident in Gulf?" |
| Bulk Carriers | Foundering, Cargo Shift | "Bulk carrier sinking this year?" |
| Passenger Ships | Fire, Grounding | "Cruise ship incident?" |

### Seasonal Markets

| Season | Risk Factor | Market Question |
|--------|-------------|-----------------|
| Winter (N. Atlantic) | Storms, Foundering | "Storm casualty in North Atlantic?" |
| Monsoon (Indian Ocean) | Collision, Grounding | "Monsoon-related incident?" |
| Fog Season (Various) | Collision | "Fog collision in English Channel?" |

---

## Conclusion

**For instant API access to create prediction markets:**

### ✅ RECOMMENDED: Datalastic Ship Casualty API

- **Cost:** €9 first month
- **Access:** Instant (credit card)
- **Data:** Global ship casualties, weekly updates
- **Use Case:** Ship sinking/accident prediction markets

### Sign Up Now:
https://datalastic.com/pricing

This is the **only risk factor** (excluding demurrage) where you can get instant API access at an affordable price to build real prediction markets today.
