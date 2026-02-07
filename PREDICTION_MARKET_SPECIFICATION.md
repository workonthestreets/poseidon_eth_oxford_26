# Maritime Risk Prediction Markets - Professional Specification

## Document Purpose
This specification defines the **emission rules** (market creation criteria), **settlement rules** (resolution criteria), and **Datalastic API endpoints** required to operate decentralized prediction markets covering five maritime risk categories. This document is prepared to professional Chartering Institute standards.

---

## Executive Summary

| Risk Market | Emission Feasibility | Settlement Feasibility | API Coverage | Overall Rating |
|-------------|---------------------|------------------------|--------------|----------------|
| **1. PSC Detention** | ✅ HIGH | ✅ HIGH | ✅ FULL | **PRODUCTION READY** |
| **2. Dry Dock Timing** | ✅ HIGH | ⚠️ MEDIUM | ✅ FULL | **PRODUCTION READY** |
| **3. Voyage Completion** | ✅ HIGH | ✅ HIGH | ✅ FULL | **PRODUCTION READY** |
| **4. Port Congestion** | ✅ HIGH | ⚠️ MEDIUM | ⚠️ PARTIAL | **MVP READY** |
| **5. Casualty/Sinking** | ✅ HIGH | ✅ HIGH | ✅ FULL | **PRODUCTION READY** |

---

## 1. PORT STATE CONTROL (PSC) DETENTION MARKETS

### 1.1 Risk Overview
Port State Control is the inspection regime under which foreign-flagged vessels are inspected by port authorities to verify compliance with international conventions (SOLAS, MARPOL, MLC, STCW). Vessels with serious deficiencies may be **detained** until rectified.

**Industry Reference:** Paris MOU, Tokyo MOU, US Coast Guard, Indian Ocean MOU

### 1.2 Emission Rules (Market Creation)

#### Market Types

**Type A: Vessel-Specific Detention Market**
```
MARKET QUESTION: "Will vessel [IMO_NUMBER] be detained during PSC inspection 
                  at port [PORT_NAME] on voyage [VOYAGE_ID]?"

EMISSION TRIGGER:
  - Vessel enters port [detected via `vessel` endpoint, navigation_status = "Moored"]
  - OR vessel ETA to port < 72 hours [detected via `vessel` endpoint, eta field]

REQUIRED PARAMETERS:
  - vessel_imo: string [vessel endpoint → imo]
  - vessel_name: string [vessel endpoint → name]  
  - port_locode: string [port_find endpoint → locode]
  - inspection_authority: string ["Paris MOU" | "Tokyo MOU" | "USCG" | etc.]
  - voyage_window_start: timestamp
  - voyage_window_end: timestamp (max 30 days from emission)
```

**Type B: Fleet Detention Rate Market**
```
MARKET QUESTION: "Will detention rate for [FLAG_STATE/OWNER] vessels exceed 
                  [X]% in [REGION] this [MONTH/QUARTER]?"

EMISSION TRIGGER:
  - First day of period (monthly/quarterly)

REQUIRED PARAMETERS:
  - flag_state: string [vessel_find endpoint → flag]
  - or owner_name: string [ownership endpoint → owner]
  - region: string ["Paris MOU" | "Tokyo MOU" | "USCG" | "AMSA"]
  - threshold_percentage: decimal (industry average: 3-5%)
  - period: string ["monthly" | "quarterly"]
```

### 1.3 Settlement Rules (Market Resolution)

#### Primary Settlement Logic

```
SETTLEMENT EVENT: PSC inspection completed

DATA SOURCE: Datalastic Inspections API
ENDPOINT: GET https://api.datalastic.com/api/maritime_reports/inspections
PARAMETERS: imo={vessel_imo}&from={voyage_start}&to={voyage_end}

SETTLEMENT FIELDS:
  - inspection_date: [inspections endpoint → inspection_date]
  - detention: [inspections endpoint → detention] ("TRUE" | "FALSE")
  - ship_deficiencies: [inspections endpoint → ship_deficiencies] (count)
  - deficiency_description: [inspections endpoint → deficiency_description]
  - inspection_authority: [inspections endpoint → inspection_authority]
  - inspection_port: [inspections endpoint → inspection_port]

RESOLUTION LOGIC:
  IF detention == "TRUE" THEN
    outcome = YES (detention occurred)
    payout_to = YES_token_holders
  ELSE IF inspection completed AND detention == "FALSE" THEN
    outcome = NO (no detention)
    payout_to = NO_token_holders
  ELSE IF voyage_window_end reached AND no_inspection_recorded THEN
    outcome = NO (no detention - no inspection occurred)
    payout_to = NO_token_holders
```

#### Settlement Verification Standards

Per **Paris MOU Guidelines (2025)**, detention criteria include:
- Structural deficiencies affecting seaworthiness
- Safety equipment non-compliance
- MARPOL violations (pollution prevention)
- MLC violations (crew welfare)
- ISM/ISPS code non-compliance

**Detainable deficiency threshold:** 
- Per PSCC Instruction 58/2025/17: Deficiency that "clearly hazards" ship/crew/environment safety

### 1.4 API Endpoint Mapping

| Data Point | Datalastic Endpoint | Field | Usage |
|------------|---------------------|-------|-------|
| Vessel identification | `/api/v0/vessel` | `imo`, `name`, `flag` | Market emission |
| Vessel position | `/api/v0/vessel` | `lat`, `lon`, `navigation_status` | Port arrival detection |
| Inspection results | `/api/maritime_reports/inspections` | `detention`, `ship_deficiencies` | **SETTLEMENT** |
| Deficiency details | `/api/maritime_reports/inspections` | `deficiency_description` | Evidence trail |
| Historical inspections | `/api/maritime_reports/inspections` | `from`, `to` params | Risk assessment |

### 1.5 Example API Calls

```bash
# Emission: Check vessel entering port
curl "https://api.datalastic.com/api/v0/vessel?api-key={KEY}&imo=9319569"

# Response includes: navigation_status, destination, eta

# Settlement: Check inspection result
curl "https://api.datalastic.com/api/maritime_reports/inspections?api-key={KEY}&imo=9319569&from=2025-01-01&to=2025-01-31"

# Response includes: detention="TRUE/FALSE", ship_deficiencies, deficiency_description
```

---

## 2. DRY DOCK TIMING MARKETS

### 2.1 Risk Overview
Classification society rules (IACS Unified Requirements) mandate periodic dry-docking for hull inspection. Standard interval: **5 years** with two dry-docks required (2.5-year cycle). Extended Dry-Docking (EDD) scheme permits **7.5-year interval** for qualifying vessels under 15 years old.

**Industry Reference:** IACS UR Z10.2 (Hull Surveys), SOLAS Regulation 7, MGN 672 (UK MCA)

### 2.2 Emission Rules (Market Creation)

**Type A: Dry Dock Completion Market**
```
MARKET QUESTION: "Will vessel [IMO_NUMBER] complete scheduled dry dock 
                  within [±30 DAYS] of planned date [PLANNED_DATE]?"

EMISSION TRIGGER:
  - Planned dry dock date within 180 days [dry_dock_dates endpoint → dry_dock_from]
  - OR vessel age approaching mandatory survey (4.5 years, 9.5 years, 14.5 years)

REQUIRED PARAMETERS:
  - vessel_imo: string [dry_dock_dates endpoint → imo]
  - vessel_name: string
  - planned_dry_dock_date: timestamp [dry_dock_dates endpoint → dry_dock_from]
  - tolerance_days: integer (default: 30)
  - dry_dock_location: string (if known)
```

**Type B: Dry Dock Duration Market**
```
MARKET QUESTION: "Will dry dock period for vessel [IMO_NUMBER] exceed 
                  [X] days?"

EMISSION TRIGGER:
  - Vessel enters dry dock [dry_dock_dates endpoint → dry_dock_from]

REQUIRED PARAMETERS:
  - vessel_imo: string
  - dry_dock_start: timestamp [dry_dock_dates endpoint → dry_dock_from]
  - threshold_days: integer (industry average: 14-21 days)
```

### 2.3 Settlement Rules (Market Resolution)

```
SETTLEMENT EVENT: Dry dock period ends

DATA SOURCE: Datalastic Dry Dock Dates API
ENDPOINT: GET https://api.datalastic.com/api/maritime_reports/dry_dock_dates
PARAMETERS: imo={vessel_imo}

SETTLEMENT FIELDS:
  - dry_dock_from: [dry_dock_dates endpoint → dry_dock_from] (start date)
  - dry_dock_to: [dry_dock_dates endpoint → dry_dock_to] (end date)
  - dry_dock_status: [derived: "planned" | "completed"]

RESOLUTION LOGIC (Type A - Timing):
  actual_date = dry_dock_from
  variance_days = ABS(actual_date - planned_date)
  
  IF variance_days <= tolerance_days THEN
    outcome = YES (on-time completion)
  ELSE
    outcome = NO (delayed/early outside tolerance)

RESOLUTION LOGIC (Type B - Duration):
  duration_days = dry_dock_to - dry_dock_from
  
  IF duration_days > threshold_days THEN
    outcome = YES (exceeded threshold)
  ELSE
    outcome = NO (within threshold)
```

### 2.4 Settlement Verification Standards

Per **IACS Unified Requirements Z10.2 Rev.37**:
- Annual surveys required annually (±3 months window)
- Intermediate survey at 2nd or 3rd annual (no later than 36 months from initial/renewal)
- Special survey every 5 years
- Bottom survey: 2 per 5-year period OR Extended Dry-Docking every 7.5 years

**EDD Eligibility per MGN 672 (UK MCA):**
- Vessel age < 15 years
- Gross tonnage ≥ 500 GT
- Self-propelled, internationally trading
- Two consecutive successful In-Water Surveys completed

### 2.5 API Endpoint Mapping

| Data Point | Datalastic Endpoint | Field | Usage |
|------------|---------------------|-------|-------|
| Planned dry dock | `/api/maritime_reports/dry_dock_dates` | `dry_dock_from` | Market emission + Settlement |
| Completed dry dock | `/api/maritime_reports/dry_dock_dates` | `dry_dock_to` | **SETTLEMENT** |
| Vessel age | `/api/v0/vessel_info` | `year_built` | EDD eligibility |
| Classification | `/api/maritime_reports/classification` | `class_society` | Survey authority |

---

## 3. VOYAGE COMPLETION MARKETS

### 3.1 Risk Overview
Voyage charterparties define laytime (time allowed for loading/discharge) and demurrage (penalty for delay). "Voyage completion" markets cover successful voyage execution within contracted parameters.

**Industry Reference:** BIMCO Voylayrules 1993, BIMCO GENCON 2022, Chartering Institute Guidelines

### 3.2 Emission Rules (Market Creation)

**Type A: Arrival Time Market**
```
MARKET QUESTION: "Will vessel [IMO_NUMBER] arrive at [DESTINATION_PORT] 
                  within [±X HOURS] of ETA [ESTIMATED_ARRIVAL]?"

EMISSION TRIGGER:
  - Vessel departs load port [vessel endpoint → navigation_status = "Under way"]
  - OR voyage booking confirmed (external data)

REQUIRED PARAMETERS:
  - vessel_imo: string [vessel endpoint → imo]
  - origin_port: string [vessel endpoint → last_port]
  - destination_port: string [vessel endpoint → destination]
  - eta: timestamp [vessel endpoint → eta]
  - tolerance_hours: integer (default: 24)
  - voyage_id: string (optional, for tracking)
```

**Type B: Voyage Duration Market**
```
MARKET QUESTION: "Will voyage [ORIGIN] → [DESTINATION] for vessel [IMO] 
                  be completed within [X] days?"

EMISSION TRIGGER:
  - Vessel reports departure from origin [vessel endpoint → navigation_status change]

REQUIRED PARAMETERS:
  - vessel_imo: string
  - origin_port_locode: string
  - destination_port_locode: string  
  - departure_timestamp: timestamp
  - threshold_days: integer
```

**Type C: Route Deviation Market**
```
MARKET QUESTION: "Will vessel [IMO_NUMBER] deviate from standard route 
                  [ROUTE_ID] during voyage?"

EMISSION TRIGGER:
  - Vessel departs on known route

REQUIRED PARAMETERS:
  - vessel_imo: string
  - route_waypoints: array [sea_routes endpoint → waypoints]
  - deviation_threshold_nm: integer (default: 50 NM)
```

### 3.3 Settlement Rules (Market Resolution)

```
SETTLEMENT EVENT: Vessel arrives at destination

DATA SOURCE: Datalastic Vessel Tracking API
ENDPOINT: GET https://api.datalastic.com/api/v0/vessel
PARAMETERS: imo={vessel_imo}

SETTLEMENT FIELDS (Type A - Arrival Time):
  - current_position: [vessel endpoint → lat, lon]
  - navigation_status: [vessel endpoint → navigation_status]
  - destination: [vessel endpoint → destination]
  - eta: [vessel endpoint → eta]
  - ata: timestamp when navigation_status = "Moored" at destination

RESOLUTION LOGIC (Type A):
  arrival_delay_hours = (ata - eta) / 3600
  
  IF ABS(arrival_delay_hours) <= tolerance_hours THEN
    outcome = YES (on-time arrival)
  ELSE
    outcome = NO (delayed/early outside tolerance)

SETTLEMENT FIELDS (Type B - Duration):
  - departure_time: timestamp from emission
  - arrival_time: timestamp when vessel at destination port

RESOLUTION LOGIC (Type B):
  voyage_days = (arrival_time - departure_time) / 86400
  
  IF voyage_days <= threshold_days THEN
    outcome = YES (completed within threshold)
  ELSE
    outcome = NO (exceeded threshold)
```

### 3.4 Settlement Verification Standards

Per **BIMCO Voylayrules 1993 Definitions:**
- **Laytime:** Period agreed for loading/discharging without additional charge
- **Notice of Readiness (NOR):** Written notice vessel ready for cargo operations
- **Demurrage:** Liquidated damages payable for delay beyond laytime
- **Despatch:** Compensation if operations completed before laytime expires

Per **BIMCO GENCON 2022:**
- Laytime commences 6 hours after NOR (if tendered 0600-1800)
- Laytime commences 8 hours after NOR (if tendered 1800-0600)
- Sundays/holidays excluded unless used (SHINC vs SHEX)

### 3.5 API Endpoint Mapping

| Data Point | Datalastic Endpoint | Field | Usage |
|------------|---------------------|-------|-------|
| Vessel position | `/api/v0/vessel` | `lat`, `lon` | Real-time tracking |
| Navigation status | `/api/v0/vessel` | `navigation_status` | Arrival detection |
| ETA | `/api/v0/vessel` | `eta` | Market emission |
| Destination | `/api/v0/vessel` | `destination` | Route verification |
| Historical track | `/api/v0/vessel_history` | `positions[]` | Route deviation check |
| Sea route | `/api/v0/sea_routes` | `waypoints`, `distance` | Expected route |
| Port location | `/api/v0/port_find` | `lat`, `lon`, `locode` | Geofence definition |

### 3.6 Example Settlement Logic

```bash
# Monitor vessel position for arrival
curl "https://api.datalastic.com/api/v0/vessel?api-key={KEY}&imo=9319569"

# Response parsing for settlement:
# IF navigation_status == "Moored" 
#    AND distance_to_port(lat, lon, destination_port) < 5 NM
# THEN arrival_confirmed = TRUE
#    ata = current_timestamp
```

---

## 4. PORT CONGESTION MARKETS

### 4.1 Risk Overview
Port congestion occurs when vessel arrivals exceed terminal handling capacity, causing anchorage queues and berth waiting delays. Major congestion indicators: waiting time > 24-48 hours, yard utilization > 75%.

**Industry Reference:** Kpler Port Congestion Index, Vizion API Performance Metrics, BIMCO Congestion Reports

### 4.2 Emission Rules (Market Creation)

**Type A: Berth Waiting Time Market**
```
MARKET QUESTION: "Will average berth waiting time at port [PORT_LOCODE] 
                  exceed [X] hours during [WEEK/MONTH]?"

EMISSION TRIGGER:
  - First day of measurement period
  - OR significant traffic increase detected [location_traffic endpoint]

REQUIRED PARAMETERS:
  - port_locode: string [port_find endpoint → locode]
  - port_name: string [port_find endpoint → name]
  - threshold_hours: integer (industry standard: 24-48 hours)
  - period_start: timestamp
  - period_end: timestamp
```

**Type B: Vessel-Specific Wait Market**
```
MARKET QUESTION: "Will vessel [IMO_NUMBER] wait more than [X] hours 
                  for berth at [PORT_NAME]?"

EMISSION TRIGGER:
  - Vessel ETA to congested port < 72 hours
  - AND port shows elevated traffic [location_traffic endpoint]

REQUIRED PARAMETERS:
  - vessel_imo: string
  - destination_port_locode: string
  - threshold_hours: integer
```

### 4.3 Settlement Rules (Market Resolution)

```
SETTLEMENT EVENT: Vessel berths (navigation_status changes from "At anchor" to "Moored")

DATA SOURCE: Datalastic Vessel + Location Traffic APIs
ENDPOINTS:
  - GET https://api.datalastic.com/api/v0/vessel?imo={imo}
  - GET https://api.datalastic.com/api/v0/vessel_inradius?lat={port_lat}&lon={port_lon}&radius=20

SETTLEMENT FIELDS (Type B - Vessel-Specific):
  - arrival_at_anchorage: timestamp [vessel_history → first "At anchor" near port]
  - berthing_time: timestamp [vessel → navigation_status = "Moored"]
  - waiting_hours: (berthing_time - arrival_at_anchorage) / 3600

RESOLUTION LOGIC (Type B):
  IF waiting_hours > threshold_hours THEN
    outcome = YES (excessive wait)
  ELSE
    outcome = NO (acceptable wait)

SETTLEMENT FIELDS (Type A - Port Average):
  - vessels_at_anchor: count [vessel_inradius → filter navigation_status = "At anchor"]
  - vessels_berthed: count [vessel_inradius → filter navigation_status = "Moored"]
  - average_wait_hours: calculated from historical vessel movements

RESOLUTION LOGIC (Type A):
  For each vessel arriving during period:
    Calculate individual_wait_hours
  average_wait = SUM(individual_wait_hours) / vessel_count
  
  IF average_wait > threshold_hours THEN
    outcome = YES (congested)
  ELSE
    outcome = NO (not congested)
```

### 4.4 Settlement Verification Standards

Per **industry metrics (Kpler, Vizion 2025):**
- Normal berth wait: 6-12 hours
- Moderate congestion: 24-48 hours
- Severe congestion: > 72 hours
- Yard utilization threshold: 75-80%

**Congestion calculation method:**
```
Berth_Waiting_Time = Time(Berth_Allocation) - Time(Arrival_at_Anchorage)

Port_Congestion_Index = (Vessels_at_Anchor / Berth_Capacity) × Average_Wait_Hours
```

### 4.5 API Endpoint Mapping

| Data Point | Datalastic Endpoint | Field | Usage |
|------------|---------------------|-------|-------|
| Vessels at port | `/api/v0/vessel_inradius` | `mmsi[]`, `navigation_status` | Congestion monitoring |
| Port location | `/api/v0/port_find` | `lat`, `lon` | Geofence center |
| Vessel status | `/api/v0/vessel` | `navigation_status` | "At anchor" vs "Moored" |
| Historical positions | `/api/v0/vessel_history` | `positions[]` | Wait time calculation |
| Port terminals | `/api/v0/terminals` | `terminal_info` | Capacity assessment |

### 4.6 Limitations & Workarounds

**LIMITATION:** Datalastic does not provide direct "berth waiting time" field.

**WORKAROUND:**
1. Track vessel arrival at anchorage (lat/lon within port area + navigation_status = "At anchor")
2. Track vessel berthing (navigation_status change to "Moored")
3. Calculate waiting_hours = berthing_timestamp - anchor_timestamp

```bash
# Step 1: Get vessels at anchorage near port
curl "https://api.datalastic.com/api/v0/vessel_inradius?api-key={KEY}&lat=51.89&lon=4.49&radius=30"

# Step 2: Filter response for navigation_status = "At anchor"

# Step 3: Poll same vessels every 4 hours to detect status change to "Moored"
```

---

## 5. CASUALTY / SINKING MARKETS

### 5.1 Risk Overview
Marine casualties include collisions, groundings, fires, explosions, foundering (sinking), and machinery damage. Classification follows IMO Casualty Investigation Code severity levels.

**Industry Reference:** IMO MSC-MEPC.3/Circ.3 (Casualty Investigation Code), IMO GISIS Database, Lloyd's List Intelligence

### 5.2 Emission Rules (Market Creation)

**Type A: Vessel-Specific Casualty Market**
```
MARKET QUESTION: "Will vessel [IMO_NUMBER] experience a [CASUALTY_TYPE] 
                  incident during voyage [ORIGIN] → [DESTINATION]?"

EMISSION TRIGGER:
  - Vessel departs on voyage [vessel endpoint → navigation_status = "Under way"]
  - Voyage distance > 500 NM (significant voyage)

REQUIRED PARAMETERS:
  - vessel_imo: string [vessel endpoint → imo]
  - vessel_name: string [vessel endpoint → name]
  - vessel_type: string [vessel_info endpoint → vessel_type]
  - origin_port: string
  - destination_port: string
  - voyage_start: timestamp
  - voyage_end: timestamp (estimated)
  - casualty_types: array ["Collision" | "Fire/Explosion" | "Grounding" | 
                           "Foundering" | "Hull Damage" | "Machinery Damage" | "All"]
  - severity_threshold: string ["Very Serious" | "Serious" | "Less Serious" | "Any"]
```

**Type B: Route-Based Casualty Market**
```
MARKET QUESTION: "Will a [SEVERITY] casualty occur on route [ROUTE_NAME] 
                  during [MONTH/QUARTER]?"

EMISSION TRIGGER:
  - First day of period
  - High-risk route identified (Strait of Hormuz, Suez, Malacca, etc.)

REQUIRED PARAMETERS:
  - route_bounding_box: {lat_min, lat_max, lon_min, lon_max}
  - route_name: string
  - severity_threshold: string
  - period_start: timestamp
  - period_end: timestamp
```

**Type C: Fleet Casualty Rate Market**
```
MARKET QUESTION: "Will casualty rate for [VESSEL_TYPE] vessels exceed 
                  [X] incidents per 1000 vessels this [QUARTER/YEAR]?"

EMISSION TRIGGER:
  - First day of period

REQUIRED PARAMETERS:
  - vessel_type: string ["Container" | "Tanker" | "Bulk Carrier" | "Passenger"]
  - threshold_rate: decimal (incidents per 1000 vessels)
  - period: string
```

### 5.3 Settlement Rules (Market Resolution)

```
SETTLEMENT EVENT: Casualty reported OR voyage completed without incident

DATA SOURCE: Datalastic Ship Casualty API
ENDPOINT: GET https://api.datalastic.com/api/maritime_reports/casualty
PARAMETERS: imo={vessel_imo}&from={voyage_start}&to={voyage_end}

SETTLEMENT FIELDS:
  - casualty_date: [casualty endpoint → casualty_date]
  - casualty_type: [casualty endpoint → casualty_type]
  - casualty_details: [casualty endpoint → casualty_details] (narrative)
  - vessel_imo: [casualty endpoint → imo]
  - vessel_name: [casualty endpoint → vessel_name]

RESOLUTION LOGIC (Type A - Vessel-Specific):
  Query casualty API for vessel IMO within voyage timeframe
  
  IF casualty_record_exists 
     AND casualty_type IN market.casualty_types
     AND casualty_severity >= market.severity_threshold THEN
    outcome = YES (casualty occurred)
  ELSE IF voyage_end_reached AND no_matching_casualty THEN
    outcome = NO (safe voyage)

RESOLUTION LOGIC (Type B - Route-Based):
  Query casualty API for date range
  Filter casualties by bounding box coordinates
  
  qualifying_casualties = casualties.filter(
    c => c.location WITHIN bounding_box
         AND c.severity >= threshold
  )
  
  IF qualifying_casualties.count > 0 THEN
    outcome = YES
  ELSE
    outcome = NO
```

### 5.4 Settlement Verification Standards

Per **IMO Casualty Investigation Code (MSC-MEPC.3/Circ.3):**

| Severity | Definition | Examples |
|----------|------------|----------|
| **Very Serious** | Total loss of ship, loss of life, severe pollution | Sinking, major fire with fatalities |
| **Serious** | Significant damage, injury, environmental impact | Grounding with hull breach, collision with injury |
| **Less Serious** | Minor damage requiring repair | Minor collision, minor machinery failure |
| **Marine Incident** | Near-miss, no damage/injury | Near-collision, navigational error |

**Casualty Types (per IMO classification):**
- Collision (with another ship)
- Contact (with fixed object)
- Grounding
- Fire/Explosion
- Capsizing
- Foundering (sinking)
- Hull failure
- Machinery damage
- Missing (presumed lost)

### 5.5 API Endpoint Mapping

| Data Point | Datalastic Endpoint | Field | Usage |
|------------|---------------------|-------|-------|
| Casualty record | `/api/maritime_reports/casualty` | `casualty_date`, `casualty_type` | **SETTLEMENT** |
| Casualty details | `/api/maritime_reports/casualty` | `casualty_details` | Evidence narrative |
| Vessel identification | `/api/maritime_reports/casualty` | `imo`, `vessel_name` | Cross-reference |
| Historical casualties | `/api/maritime_reports/casualty` | `from`, `to` params | Risk assessment |
| Vessel position | `/api/v0/vessel` | `lat`, `lon` | Location verification |

### 5.6 Example API Calls

```bash
# Check for casualty during voyage
curl "https://api.datalastic.com/api/maritime_reports/casualty?api-key={KEY}&imo=9319569&from=2025-01-01&to=2025-01-31"

# Response example:
{
  "data": [{
    "id": 1793,
    "imo": "9319569",
    "vessel_name": "VENTO",
    "casualty_date": "2023-09-03",
    "casualty_type": "Beached/Grounded",
    "casualty_details": "Container ship ran onto sandy bar and grounded at Cape Ammoglossa..."
  }]
}

# Check route-based casualties
curl "https://api.datalastic.com/api/maritime_reports/casualty?api-key={KEY}&from=2025-01-01&to=2025-03-31"
# Then filter by coordinates in application logic
```

---

## 6. DATALASTIC API ENDPOINT REFERENCE

### 6.1 Core Endpoints for All Markets

| Endpoint | Purpose | Pricing Tier |
|----------|---------|--------------|
| `GET /api/v0/vessel` | Real-time vessel tracking | Starter (€199/mo) |
| `GET /api/v0/vessel_info` | Static vessel specifications | Starter |
| `GET /api/v0/vessel_inradius` | Vessels within area | Starter |
| `GET /api/v0/port_find` | Port information | Starter |
| `GET /api/v0/vessel_history` | Historical positions | Experimenter (€569/mo) |
| `GET /api/v0/sea_routes` | Route calculation | Add-on |

### 6.2 Add-On Endpoints (Required for Full Coverage)

| Endpoint | Purpose | Pricing |
|----------|---------|---------|
| `GET /api/maritime_reports/inspections` | PSC inspection results | €399/mo |
| `GET /api/maritime_reports/casualty` | Ship casualties | €399/mo |
| `GET /api/maritime_reports/dry_dock_dates` | Dry dock schedules | €399/mo |
| `GET /api/maritime_reports/classification` | Class society data | €399/mo |

### 6.3 Request Parameters by Market Type

**PSC Detention Markets:**
```
Required: imo, from, to
Endpoints: /inspections, /vessel
Key fields: detention, ship_deficiencies, deficiency_description
```

**Dry Dock Markets:**
```
Required: imo, dry_dock_from, dry_dock_to
Endpoints: /dry_dock_dates, /vessel_info
Key fields: dry_dock_from, dry_dock_to, year_built
```

**Voyage Completion Markets:**
```
Required: imo
Endpoints: /vessel, /vessel_history, /sea_routes, /port_find
Key fields: lat, lon, navigation_status, eta, destination
```

**Port Congestion Markets:**
```
Required: lat, lon, radius
Endpoints: /vessel_inradius, /vessel, /port_find, /terminals
Key fields: navigation_status, lat, lon, port coordinates
```

**Casualty Markets:**
```
Required: imo OR from/to date range
Endpoints: /casualty, /vessel
Key fields: casualty_date, casualty_type, casualty_details
```

---

## 7. FLARE FDC INTEGRATION

### 7.1 Attestation Request Format

For each settlement, the protocol must submit attestation request to Flare Data Connector:

```solidity
// JsonApi/Web2Json attestation request
struct AttestationRequest {
    string url;           // Datalastic API endpoint
    string postprocessJq; // JQ filter for data extraction
    string abi_signature; // Solidity struct encoding
}
```

### 7.2 Example: PSC Detention Settlement Attestation

```javascript
// JQ filter for PSC detention
const postprocessJq = `{
  imo: .data[0].imo,
  inspection_date: .data[0].inspection_date,
  detention: .data[0].detention,
  deficiency_count: (.data[0].ship_deficiencies | tonumber),
  inspection_port: .data[0].inspection_port
}`;

// ABI signature
const abiSignature = `{
  "components": [
    {"internalType": "string", "name": "imo", "type": "string"},
    {"internalType": "string", "name": "inspection_date", "type": "string"},
    {"internalType": "string", "name": "detention", "type": "string"},
    {"internalType": "uint256", "name": "deficiency_count", "type": "uint256"},
    {"internalType": "string", "name": "inspection_port", "type": "string"}
  ],
  "name": "PSCInspectionResult",
  "type": "tuple"
}`;
```

### 7.3 Settlement Flow

```
1. Market expiry reached OR settlement event detected
2. Backend calls Datalastic API for settlement data
3. Format attestation request with JQ filter
4. Submit to FdcHub.requestAttestation()
5. Wait for voting round finalization (~180 seconds max)
6. Retrieve proof from DA Layer
7. Submit proof to settlement contract
8. Contract verifies proof via FdcVerification
9. Market resolves, payouts distributed
```

---

## 8. FEASIBILITY ASSESSMENT

### 8.1 Production-Ready Markets

| Market | Data Completeness | Settlement Clarity | Recommendation |
|--------|-------------------|-------------------|----------------|
| **PSC Detention** | 100% - Full inspection history | 100% - Binary TRUE/FALSE | **LAUNCH PRIORITY 1** |
| **Casualty/Sinking** | 100% - Comprehensive casualties | 95% - Type + details provided | **LAUNCH PRIORITY 1** |
| **Dry Dock Timing** | 90% - Planned + actual dates | 85% - May need confirmation polling | **LAUNCH PRIORITY 2** |
| **Voyage Completion** | 85% - Real-time tracking | 90% - Clear arrival detection | **LAUNCH PRIORITY 2** |

### 8.2 MVP-Ready Markets (Requires Workarounds)

| Market | Limitation | Workaround | Effort |
|--------|------------|------------|--------|
| **Port Congestion** | No direct waiting time field | Calculate from position history + status changes | Medium |

### 8.3 Recommended API Subscription

**Minimum Viable Product:**
- Datalastic Starter: €199/mo (vessel tracking)
- Ship Inspections Add-on: €399/mo (PSC detention)
- Ship Casualties Add-on: €399/mo (casualty markets)
- **Total: ~€1,000/mo**

**Full Coverage:**
- Add Dry Dock Dates: +€399/mo
- Add Classification Data: +€399/mo
- Upgrade to Experimenter for history: +€370/mo
- **Total: ~€2,200/mo**

---

## 9. GLOSSARY OF TERMS

| Term | Definition | API Reference |
|------|------------|---------------|
| **ATA** | Actual Time of Arrival | Derived from `navigation_status` change |
| **ETA** | Estimated Time of Arrival | `vessel` endpoint → `eta` |
| **IMO** | International Maritime Organization vessel number | `vessel` endpoint → `imo` |
| **Laytime** | Contractual time for cargo operations | External (charterparty) |
| **LFD** | Last Free Day (demurrage threshold) | External (Terminal49) |
| **MMSI** | Maritime Mobile Service Identity | `vessel` endpoint → `mmsi` |
| **MOU** | Memorandum of Understanding (PSC regime) | `inspections` → `inspection_authority` |
| **NOR** | Notice of Readiness | External (charterparty) |
| **PSC** | Port State Control | `inspections` endpoint |

---

## 10. DOCUMENT CONTROL

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-02-07 | Maritime Shield Protocol | Initial specification |

**References:**
- Paris MOU 46th Amendment (2025)
- Tokyo MOU Deficiency Codes (December 2024)
- IACS UR Z10.2 Rev.37 (Hull Classification Surveys)
- BIMCO Voylayrules 1993
- BIMCO GENCON 2022
- IMO MSC-MEPC.3/Circ.3 (Casualty Investigation Code)
- Datalastic API Reference (https://datalastic.com/api-reference/)
- Flare FDC Documentation (https://dev.flare.network/fdc/overview)
