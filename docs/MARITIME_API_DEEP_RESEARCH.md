# Maritime Data API - Deep Research Report

## Executive Summary

After comprehensive research, here are your options for maritime vessel tracking APIs, organized by cost:

| Tier | Provider | Cost | Best For |
|------|----------|------|----------|
| **FREE** | AISStream.io | $0 | Real-time vessel positions via WebSocket |
| **FREE** | AISHub | $0 (requires data sharing) | Global AIS data exchange |
| **FREE** | Global Fishing Watch | $0 | Research/academic use |
| **FREE** | DCSA OpenAPI | $0 (open standard) | Container tracking standard |
| **CHEAP** | Datalastic | €9 first month | Quick start, vessel tracking |
| **CHEAP** | Data Docked | Free trial + pay-per-use | Flexible testing |
| **MID** | JSONCargo | €99/mo | Container + vessel tracking |
| **MID** | Portcast | $325/mo | Predictive ETA, container tracking |
| **ENTERPRISE** | Terminal49 | Contact sales | Full demurrage data (LFD, fees) |

---

## FREE Options (Detailed)

### 1. AISStream.io ⭐ RECOMMENDED FREE OPTION

**Website:** https://aisstream.io  
**Cost:** FREE  
**Sign-up:** Via GitHub OAuth (instant)

**What You Get:**
- Real-time WebSocket streaming of global AIS data
- Vessel positions, speed, course, heading
- Ship static data (name, IMO, MMSI, dimensions)
- Filter by geographic bounding box
- Filter by specific vessel MMSI (up to 50)
- Filter by message type

**API Endpoint:**
```
wss://stream.aisstream.io/v0/stream
```

**Quick Start (Python):**
```python
import asyncio
import websockets
import json

async def connect_ais_stream():
    async with websockets.connect("wss://stream.aisstream.io/v0/stream") as ws:
        # Subscribe to vessels worldwide
        subscribe = {
            "APIKey": "YOUR_API_KEY",  # Get from aisstream.io/apikeys
            "BoundingBoxes": [[[-90, -180], [90, 180]]],  # Entire world
            "FilterMessageTypes": ["PositionReport", "ShipStaticData"]
        }
        await ws.send(json.dumps(subscribe))
        
        async for message in ws:
            data = json.loads(message)
            if data["MessageType"] == "PositionReport":
                pos = data["Message"]["PositionReport"]
                meta = data["MetaData"]
                print(f"Ship: {meta['ShipName']} | Lat: {pos['Latitude']} | Lon: {pos['Longitude']}")

asyncio.run(connect_ais_stream())
```

**Data Available:**
- PositionReport (lat, lon, speed, course, heading)
- ShipStaticData (name, IMO, MMSI, dimensions, destination, ETA)
- BaseStationReport
- AidsToNavigationReport
- StandardClassBPositionReport
- ExtendedClassBPositionReport

**Limitations:**
- Beta service (no SLA/uptime guarantee)
- No browser CORS support (backend only)
- Real-time only (no historical data)
- ~300 messages/second globally

**Best For:** Real-time vessel arrival detection, ETA tracking

---

### 2. AISHub

**Website:** https://www.aishub.net  
**Cost:** FREE (requires data sharing)  
**Sign-up:** Registration + share your AIS data

**What You Get:**
- API access in JSON, XML, or CSV
- Global vessel positions
- Real-time data from community contributors

**API Endpoint:**
```
http://data.aishub.net/ws.php?username=YOUR_USERNAME&format=1&output=json
```

**Example Request:**
```bash
# Get all vessels in bounding box
curl "http://data.aishub.net/ws.php?username=YOUR_USER&format=1&output=json&latmin=25&latmax=26&lonmin=-80&lonmax=-79"

# Get specific vessel by MMSI
curl "http://data.aishub.net/ws.php?username=YOUR_USER&format=1&output=json&mmsi=367596760"
```

**Requirements:**
- Must contribute AIS data (need AIS receiver)
- 90% uptime requirement for your feed
- Coverage of at least 10 vessels

**Limitations:**
- Rate limit: 1 request per minute
- Requires hardware investment for AIS receiver

**Best For:** Organizations with existing AIS infrastructure

---

### 3. Global Fishing Watch

**Website:** https://globalfishingwatch.org/vessel-viewer-tool/  
**Cost:** FREE  
**Sign-up:** Create account

**What You Get:**
- Vessel tracking focused on fishing fleet
- Historical AIS data
- Open datasets for research

**Best For:** Academic/research projects, fishing vessel monitoring

---

### 4. DCSA Track & Trace (Open Standard)

**Website:** https://dcsa.org/standards/track-and-trace  
**GitHub:** https://github.com/dcsaorg/DCSA-OpenAPI  
**Cost:** FREE (open standard, implemented by carriers)

**What You Get:**
- Standardized container tracking API specification
- Implemented by 9 major carriers (Maersk, MSC, CMA CGM, etc.)
- Events: pre-shipment, pre-ocean, ocean, post-ocean, post-shipment

**How to Use:**
- Contact individual carriers for API access
- Use standardized endpoints across carriers
- Webhook subscriptions for events

**Best For:** Container tracking, carrier integration

---

### 5. Marine Cadastre (US Government)

**Website:** https://hub.marinecadastre.gov/  
**Cost:** FREE  
**Sign-up:** None required

**What You Get:**
- Historical AIS data (US waters)
- Downloadable datasets
- Analysis tools

**Best For:** Historical analysis, US coastal waters

---

## PAID Options (Instant Purchase)

### 1. Datalastic ⭐ RECOMMENDED QUICK START

**Website:** https://datalastic.com/pricing  
**Cost:** €9 first month → €199/mo (20,000 credits)

**Sign-Up Process:**
1. Go to https://datalastic.com/pricing
2. Click "Get Your API Key"
3. Enter email, create password
4. Choose plan (Starter €9)
5. Pay with credit card
6. **API key delivered instantly**

**API Endpoints:**
```bash
# Find vessel by name
curl "https://api.datalastic.com/api/v0/vessel_find?api-key=KEY&name=Ever%20Given"

# Get vessel position
curl "https://api.datalastic.com/api/v0/vessel_pro?api-key=KEY&imo=9811000"

# Get port traffic
curl "https://api.datalastic.com/api/v0/port_traffic?api-key=KEY&locode=USLAX"

# Historical positions
curl "https://api.datalastic.com/api/v0/vessel_history?api-key=KEY&imo=9811000"
```

**Data Available:**
- Vessel positions (real-time)
- Vessel details (name, IMO, MMSI, type)
- Port traffic
- Historical tracks
- Expected arrivals

---

### 2. Data Docked

**Website:** https://datadocked.com/pricing  
**Cost:** Free trial (10 credits) → Pay-per-use

**Sign-Up Process:**
1. Go to https://datadocked.com
2. Sign up for free trial (no credit card)
3. Get 10 free credits
4. Test API endpoints
5. Upgrade when ready

**Best For:** Testing before committing

---

### 3. JSONCargo

**Website:** https://jsoncargo.com/pricing-plans  
**Cost:** €11 trial (2 weeks) → €99/mo

**Sign-Up Process:**
1. Go to https://jsoncargo.com/pricing-plans
2. Click "Get Started" on Mariner plan
3. 14-day trial for €11
4. API key in dashboard

**Data Available:**
- Container tracking by BL/container number
- Vessel tracking
- Port tracking
- Terminal finder

**API Endpoints:**
```bash
# Track container
curl "https://api.jsoncargo.com/v1/tracking/container/MSCU1234567" \
  -H "Authorization: Bearer YOUR_KEY"

# Track by Bill of Lading
curl "https://api.jsoncargo.com/v1/tracking/bl/MAEU123456789" \
  -H "Authorization: Bearer YOUR_KEY"
```

**Best For:** Container-specific tracking

---

### 4. Portcast

**Website:** https://portcast.io  
**Cost:** $325/mo (100 containers)

**What You Get:**
- Container tracking
- **Predictive ETA** (30% more accurate than carriers)
- Delay predictions with reasons
- Port congestion data

**Sign-Up:**
- Contact via website for trial
- Self-service plans available

**Best For:** ETA predictions, exception management

---

### 5. VesselFinder

**Website:** https://vesselfinder.com/vessel-positions-api  
**Cost:** €330 for 10,000 credits (12-month validity)

**What You Get:**
- Real-time AIS positions
- Voyage data
- Vessel master data

**Credit System:**
- AIS position: 1 credit
- Voyage data: 1 credit
- Master data: 2 credits

**Best For:** Simple position tracking

---

### 6. Searoutes

**Website:** https://searoutes.com/pricing  
**Cost:** €300/mo (5,000 calls)

**What You Get:**
- Clean AIS data
- Predicted ETAs
- Route optimization
- Historical traces

**Best For:** Route planning, ETA predictions

---

## Enterprise Options (Contact Sales)

### Terminal49 ⭐ BEST FOR DEMURRAGE

**Website:** https://terminal49.com  
**Cost:** Contact sales (enterprise pricing)

**Why Terminal49 is Unique:**
- **Only provider with Last Free Day (LFD) data**
- **Direct demurrage fee information**
- Container milestone events
- Terminal availability
- Holds information
- Webhooks for real-time updates

**Data for Demurrage Markets:**
| Data Point | Available | Use For |
|------------|-----------|---------|
| Last Free Day | ✅ | Demurrage threshold |
| Full Out Date | ✅ | Settlement |
| Demurrage Fees | ✅ | Direct settlement |
| Terminal Holds | ✅ | Delay reasons |
| Vessel Arrived | ✅ | Arrival markets |
| Vessel Discharged | ✅ | Discharge markets |

**How to Get Started:**
1. Email: sales@terminal49.com
2. Request demo/trial
3. Typical response: 1-2 business days

---

### MarineTraffic / Kpler

**Website:** https://marinetraffic.com  
**Cost:** $19/mo basic → API contact sales

**What You Get:**
- Comprehensive global coverage
- Container intelligence
- Predictive ETAs (6 weeks ahead)
- Port congestion tracking

**Contact:** sales@kpler.com

---

## Comparison Matrix

| Feature | AISStream (FREE) | Datalastic (€199) | JSONCargo (€99) | Terminal49 |
|---------|------------------|-------------------|-----------------|------------|
| Real-time Position | ✅ | ✅ | ✅ | ✅ |
| Vessel Details | ✅ | ✅ | ✅ | ✅ |
| Historical Data | ❌ | ✅ | ✅ | ✅ |
| Container Tracking | ❌ | ❌ | ✅ | ✅ |
| **Last Free Day** | ❌ | ❌ | ❌ | ✅ |
| **Demurrage Fees** | ❌ | ❌ | ❌ | ✅ |
| Port Calls | ❌ | ✅ | ✅ | ✅ |
| Webhooks | ❌ (WebSocket) | ❌ | ❌ | ✅ |
| Instant Sign-up | ✅ | ✅ | ✅ | ❌ |

---

## Recommended Setup for MaritimeShield

### Option A: Start Free, Scale Later
```
Phase 1 (Now - Free):
├── AISStream.io (FREE)
│   └── Real-time vessel positions
│   └── Arrival detection
│   └── Use for "vessel arrival delay" markets

Phase 2 (When revenue comes):
├── Add Datalastic (€199/mo)
│   └── Historical data
│   └── Port traffic
│   └── Better ETA predictions

Phase 3 (Production):
├── Add Terminal49 (Enterprise)
│   └── Full demurrage data
│   └── LFD for settlement
│   └── Container-level tracking
```

### Option B: Quick Paid Start
```
Immediate (€99/mo):
├── JSONCargo
│   └── Container tracking
│   └── Vessel positions
│   └── Can track by BL number

Later:
├── Terminal49 for demurrage data
```

### Option C: Full Demurrage Focus
```
Contact Terminal49 immediately:
├── Request trial access
├── Only provider with LFD + demurrage fees
├── Required for proper demurrage market settlement
```

---

## Quick Start Commands

### AISStream.io (Free)
```bash
# 1. Sign up at https://aisstream.io/authenticate (use GitHub)
# 2. Get API key at https://aisstream.io/apikeys
# 3. Test with Python script above
```

### Datalastic (€9 first month)
```bash
# 1. Sign up at https://datalastic.com/pricing
# 2. Get API key instantly after payment
# 3. Test:
curl "https://api.datalastic.com/api/v0/vessel_find?api-key=YOUR_KEY&name=Ever%20Given"
```

### JSONCargo (€11 trial)
```bash
# 1. Sign up at https://jsoncargo.com/pricing-plans
# 2. Get API key in dashboard
# 3. Test:
curl "https://api.jsoncargo.com/v1/ping" -H "Authorization: Bearer YOUR_KEY"
```

---

## Demurrage Market Settlement: Data Requirements

For your prediction markets to settle properly, you need:

| Market Type | Required Data | Provider |
|-------------|---------------|----------|
| Vessel Arrival Delay | ETA, ATA | AISStream (free), Datalastic |
| Port Congestion | Berth wait times | Terminal49, MarineTraffic |
| **Demurrage Occurrence** | **LFD, Full Out, Fees** | **Terminal49 ONLY** |
| Container Discharge | Discharge timestamp | Terminal49, JSONCargo |

**Critical Insight:** For true demurrage prediction markets, you MUST eventually use Terminal49 because they are the **only provider** with:
- Last Free Day (LFD) data
- Actual demurrage fee amounts
- Terminal holds that cause delays

**Workaround for MVP:** Use AISStream (free) for vessel arrival markets, then add Terminal49 for container-level demurrage markets when you have revenue.

---

## Contact Information

| Provider | Contact | Response Time |
|----------|---------|---------------|
| AISStream | GitHub Issues | 1-3 days |
| Datalastic | support@datalastic.com | Same day |
| JSONCargo | contact@jsoncargo.com | Same day |
| Terminal49 | sales@terminal49.com | 1-2 days |
| MarineTraffic | sales@kpler.com | 1-2 days |
| Portcast | sales@portcast.io | 1-2 days |

---

## Bottom Line

**If you need to start TODAY for FREE:**
→ Use **AISStream.io** - sign up with GitHub, get API key in 2 minutes

**If you can spend €9-99/month:**
→ Use **Datalastic** (€9) or **JSONCargo** (€99) for better data

**If you need demurrage-specific data:**
→ Contact **Terminal49** - they have the data no one else has (LFD, fees)
