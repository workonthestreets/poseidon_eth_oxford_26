# Maritime Data API Providers

## Quick Purchase Options (Monthly Subscriptions)

### Tier 1: Instant Sign-Up (Credit Card, Start Today)

| Provider | Starting Price | API Calls | Key Features | Sign-Up Link |
|----------|---------------|-----------|--------------|--------------|
| **Datalastic** | €9 first month, then €199/mo | 20,000 credits | Vessel tracking, port data, historical AIS | [datalastic.com/pricing](https://datalastic.com/pricing) |
| **Data Docked** | Free trial (10 credits) | Pay-per-credit | Real-time AIS, vessel positions, port calls | [datadocked.com/pricing](https://datadocked.com/pricing) |
| **JSONCargo** | €11 trial, then €99/mo | 2,000 calls | Container tracking, BL lookup, vessel tracking | [jsoncargo.com/pricing](https://jsoncargo.com/pricing-plans) |
| **Searoutes** | €300/mo | 5,000 calls | AIS data, ETAs, historical traces | [searoutes.com/pricing](https://searoutes.com/pricing) |
| **VesselFinder** | €330 (10K credits) | Credit-based | Real-time positions, voyage data | [vesselfinder.com](https://www.vesselfinder.com/vessel-positions-api) |

### Tier 2: Trial Available (Contact Sales for Full Pricing)

| Provider | Trial | Estimated Monthly | Best For |
|----------|-------|-------------------|----------|
| **Terminal49** | Free trial | Contact sales | Container tracking, terminal data, LFD |
| **MarineTraffic** | 7-day free | $19-$200/mo | Global vessel coverage, predictive ETAs |
| **SeaVantage** | 30-day free | Contact sales | Enterprise fleet tracking |
| **SafeCube** | 30-day free | Contact sales | Container vessel intelligence |

---

## Detailed Provider Comparison

### 1. Datalastic (RECOMMENDED FOR QUICK START)
**Website:** https://datalastic.com

**Pricing:**
- Starter: €199/mo (20,000 credits)
- Experimenter: €569/mo (80,000 credits)
- Developer Pro+: €679/mo (unlimited)
- First month discounted: €9, €19, €45

**API Endpoints:**
- `/vessel-find` - Find vessels by name/IMO/MMSI
- `/vessel-info` - Detailed vessel data
- `/vessel-track` - Real-time AIS position
- `/vessel-history` - Historical positions
- `/port-traffic` - Vessels at port
- `/port-expected` - Expected arrivals

**Best For:** Quick integration, good documentation, reasonable pricing

---

### 2. Data Docked
**Website:** https://datadocked.com

**Pricing:** Credit-based (contact for exact rates)
- Free trial: 10 credits
- Pay-as-you-go or subscription

**API Endpoints:**
- Vessel location (terrestrial + satellite AIS)
- Port calls history
- Vessel particulars
- Real-time tracking

**Best For:** Flexible pay-per-use model

---

### 3. JSONCargo
**Website:** https://jsoncargo.com

**Pricing:**
- Mariner: €99/mo (2,000 calls)
- Navigator: €299/mo (5,000 calls)
- Admiral: €499/mo (10,000 calls)
- 14-day trial for all plans

**API Endpoints:**
- Container tracking by BL/container number
- Vessel tracking
- Port tracking
- Terminal finder

**Best For:** Container-specific tracking (good for demurrage)

---

### 4. Terminal49 (BEST FOR DEMURRAGE DATA)
**Website:** https://terminal49.com

**Pricing:** Contact sales (enterprise-focused)

**API Endpoints:**
- Shipment tracking
- Container milestones (vessel_arrived, vessel_discharged, full_out)
- Last Free Day (LFD)
- Terminal availability
- Holds and fees (including demurrage!)
- Webhooks for real-time updates

**Best For:** Demurrage prediction markets (has LFD, fees, terminal data)

---

### 5. MarineTraffic / Kpler
**Website:** https://www.marinetraffic.com

**Pricing:**
- Standard: $19/mo (50 vessels)
- Professional: $69/mo (1 vessel, advanced)
- Enterprise: $200/mo (unlimited)
- API: Contact sales@kpler.com

**API Endpoints:**
- Vessel positions
- Port calls
- Predictive ETAs (6 weeks ahead)
- Container intelligence
- Terminal congestion

**Best For:** Comprehensive coverage, predictive analytics

---

### 6. VesselFinder
**Website:** https://www.vesselfinder.com

**Pricing:** Credit packages (12-month validity)
- 10,000 credits: €330
- 20,000 credits: €625
- 50,000 credits: €1,470

**Credit Costs:**
- AIS position: 1 credit/record
- Voyage data: 1 credit/record
- Vessel master data: 2 credits/record

**Best For:** Simple position tracking, budget-friendly

---

### 7. Searoutes
**Website:** https://searoutes.com

**Pricing:** Starting €300/mo (5,000 calls)

**API Endpoints:**
- Clean AIS data (terrestrial + satellite)
- Vessel positions
- Predicted ETAs
- Historical traces
- Routing optimization

**Best For:** Route planning, ETA predictions

---

## API Features Comparison Matrix

| Feature | Terminal49 | Datalastic | JSONCargo | MarineTraffic | VesselFinder |
|---------|------------|------------|-----------|---------------|--------------|
| **Vessel Position** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Port Calls** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Container Tracking** | ✅ | ❌ | ✅ | ✅ | ❌ |
| **Last Free Day (LFD)** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Demurrage Fees** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Terminal Data** | ✅ | ❌ | ✅ | ✅ | ❌ |
| **Webhooks** | ✅ | ❌ | ❌ | ✅ | ❌ |
| **Historical Data** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Predictive ETA** | ✅ | ❌ | ❌ | ✅ | ❌ |
| **Instant Sign-Up** | ❌ | ✅ | ✅ | ❌ | ✅ |

---

## Recommended Setup for MaritimeShield

### Option A: Budget-Friendly (Quick Start)
```
Primary: Datalastic (€199/mo)
- Vessel tracking
- Port arrivals
- Historical data

Limitation: No container-level data, no LFD
```

### Option B: Container-Focused
```
Primary: JSONCargo (€99/mo)
- Container tracking
- Bill of lading lookup
- Vessel positions

Limitation: No LFD, no demurrage fees
```

### Option C: Full Demurrage Support (Recommended)
```
Primary: Terminal49 (Contact sales)
- Full container lifecycle
- Last Free Day (critical for demurrage!)
- Terminal holds and fees
- Webhook notifications

This is the ONLY provider with direct demurrage fee data!
```

### Option D: Hybrid Approach
```
Vessel Data: Datalastic (€199/mo)
- Real-time vessel positions
- Port arrivals/departures
- Use for ETA-based markets

Container Data: Terminal49 (Contact sales)
- Container-specific milestones
- LFD for demurrage markets
- Settlement data
```

---

## Quick Start: Sign Up Today

### 1. Datalastic (Fastest)
```bash
# 1. Go to https://datalastic.com/pricing
# 2. Click "Get Your API Key"
# 3. Enter email, create account
# 4. Choose Starter plan (€9 first month)
# 5. Get API key immediately

# Test the API:
curl "https://api.datalastic.com/api/v0/vessel_find?api-key=YOUR_KEY&name=Ever%20Given"
```

### 2. JSONCargo
```bash
# 1. Go to https://jsoncargo.com/pricing-plans
# 2. Click "Get Started" on Mariner plan
# 3. Enter email, create account
# 4. 14-day trial starts (€11)
# 5. Get API key in dashboard

# Test container tracking:
curl "https://api.jsoncargo.com/v1/tracking?container=MSCU1234567" \
  -H "Authorization: Bearer YOUR_KEY"
```

### 3. VesselFinder (Credit-Based)
```bash
# 1. Go to https://www.vesselfinder.com/vessel-positions-api
# 2. Contact via form or purchase credits
# 3. Credits valid for 12 months

# Test vessel position:
curl "https://api.vesselfinder.com/positions?userkey=YOUR_KEY&imo=9811000"
```

---

## Data Mapping for Prediction Markets

| Market Type | Required Data | Best Provider |
|-------------|---------------|---------------|
| Vessel Arrival Delay | ETA, ATA | Datalastic, MarineTraffic |
| Port Congestion | Berth wait times | MarineTraffic, Terminal49 |
| Container Discharge | Discharge timestamp | Terminal49 |
| **Demurrage Occurrence** | **LFD, Full Out, Fees** | **Terminal49 (only option)** |
| Transit Time | Departure, Arrival | Any provider |

---

## Contact Information

| Provider | Sales Contact | Response Time |
|----------|---------------|---------------|
| Terminal49 | sales@terminal49.com | 1-2 days |
| MarineTraffic | sales@kpler.com | 1-2 days |
| Datalastic | support@datalastic.com | Same day |
| JSONCargo | contact@jsoncargo.com | Same day |
| SeaVantage | Website form | 1-2 days |

---

## Summary: What to Buy

**If you need to start TODAY:**
→ **Datalastic** (€9 first month, instant API key)

**If you need container tracking:**
→ **JSONCargo** (€11 trial, container + BL tracking)

**If you need demurrage data (LFD, fees):**
→ **Terminal49** (contact sales, only provider with this data)

**If you need predictive ETAs:**
→ **MarineTraffic** ($19/mo basic, or API via sales)
