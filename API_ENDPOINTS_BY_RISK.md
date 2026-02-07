# Datalastic API Endpoints for Maritime Risk Markets

## Base URL
```
https://api.datalastic.com/api/
```

---

## 1. PSC DETENTION Markets

**Market:** "Will vessel pass Port State Control inspection without detention?"

### EMISSION (Create Market)

| Purpose | Endpoint | Parameters |
|---------|----------|------------|
| Vessel identity | `/api/v0/vessel_info` | `imo` or `mmsi` |
| Inspection history | `/api/maritime_reports/inspections` | `imo`, `from`, `to` |
| Current position | `/api/v0/vessel` | `imo` or `mmsi` |
| Classification status | `/api/maritime_reports/classification` | `imo` |
| Dry dock recency | `/api/maritime_reports/dry_dock_dates` | `imo` |

```bash
# 1. Get vessel details
curl "https://api.datalastic.com/api/v0/vessel_info?api-key=KEY&imo=9703318"

# 2. Get inspection history (CRITICAL - shows past detentions)
curl "https://api.datalastic.com/api/maritime_reports/inspections?api-key=KEY&imo=9703318"

# 3. Get current position (confirm approaching port)
curl "https://api.datalastic.com/api/v0/vessel?api-key=KEY&imo=9703318"

# 4. Get classification society status
curl "https://api.datalastic.com/api/maritime_reports/classification?api-key=KEY&imo=9703318"

# 5. Get dry dock dates (maintenance recency)
curl "https://api.datalastic.com/api/maritime_reports/dry_dock_dates?api-key=KEY&imo=9703318"
```

### SETTLEMENT (Resolve Market)

| Purpose | Endpoint | Parameters | Check |
|---------|----------|------------|-------|
| New inspection result | `/api/maritime_reports/inspections` | `imo`, `from=market_start` | `detention` field |

```bash
# Poll for new inspection after vessel arrives at port
curl "https://api.datalastic.com/api/maritime_reports/inspections?api-key=KEY&imo=9703318&from=2024-03-01"

# Response includes:
# "detention": "TRUE" or "FALSE"
# "ship_deficiencies": count
# "deficiency_description": details
```

**Settlement Logic:**
```
IF inspection.detention == "TRUE" → NO wins
IF inspection.detention == "FALSE" → YES wins
```

---

## 2. DRY DOCK Markets

**Market:** "Will vessel require unscheduled dry dock in Q2 2024?"

### EMISSION (Create Market)

| Purpose | Endpoint | Parameters |
|---------|----------|------------|
| Scheduled dry dock | `/api/maritime_reports/dry_dock_dates` | `imo` |
| Vessel age/specs | `/api/v0/vessel_info` | `imo` |
| Classification surveys | `/api/maritime_reports/classification` | `imo` |
| Recent casualties | `/api/maritime_reports/casualty` | `imo` |

```bash
# 1. Get scheduled dry dock dates
curl "https://api.datalastic.com/api/maritime_reports/dry_dock_dates?api-key=KEY&imo=9703318"

# Response:
# "dry_dock_last": "2022-05-15"
# "dry_dock_next_due": "2025-05-15"

# 2. Get vessel specs (age affects risk)
curl "https://api.datalastic.com/api/v0/vessel_info?api-key=KEY&imo=9703318"

# 3. Get classification status (survey due dates)
curl "https://api.datalastic.com/api/maritime_reports/classification?api-key=KEY&imo=9703318"

# 4. Get casualty history (damage requiring repair?)
curl "https://api.datalastic.com/api/maritime_reports/casualty?api-key=KEY&imo=9703318"
```

### SETTLEMENT (Resolve Market)

| Purpose | Endpoint | Parameters | Check |
|---------|----------|------------|-------|
| Dry dock update | `/api/maritime_reports/dry_dock_dates` | `imo`, `dry_dock_from`, `dry_dock_to` | New entry before scheduled |

```bash
# Check for dry dock entries during market period
curl "https://api.datalastic.com/api/maritime_reports/dry_dock_dates?api-key=KEY&imo=9703318&dry_dock_from=2024-04-01&dry_dock_to=2024-06-30"
```

**Settlement Logic:**
```
IF new_dry_dock_date < scheduled_next_due → YES wins (unscheduled)
IF no_new_dry_dock OR dry_dock_date >= scheduled → NO wins (on schedule)
```

---

## 3. SHIP CASUALTY / SINKING Markets

**Market:** "Will vessel experience casualty on voyage Shanghai→Rotterdam?"

### EMISSION (Create Market)

| Purpose | Endpoint | Parameters |
|---------|----------|------------|
| Vessel identity | `/api/v0/vessel_info` | `imo` |
| Historical casualties | `/api/maritime_reports/casualty` | `imo` |
| Current position | `/api/v0/vessel` | `imo` |
| Route tracking | `/api/v0/route` | `imo` (if subscribed) |

```bash
# 1. Get vessel info
curl "https://api.datalastic.com/api/v0/vessel_info?api-key=KEY&imo=9703318"

# 2. Get casualty history (risk indicator)
curl "https://api.datalastic.com/api/maritime_reports/casualty?api-key=KEY&imo=9703318"

# 3. Get current position
curl "https://api.datalastic.com/api/v0/vessel?api-key=KEY&imo=9703318"
```

### SETTLEMENT (Resolve Market)

| Purpose | Endpoint | Parameters | Check |
|---------|----------|------------|-------|
| New casualty | `/api/maritime_reports/casualty` | `imo`, `from=voyage_start` | New casualty entry |
| OR by date range | `/api/maritime_reports/casualty` | `from`, `to` | Filter by vessel |

```bash
# Check for new casualty during voyage period
curl "https://api.datalastic.com/api/maritime_reports/casualty?api-key=KEY&imo=9703318&from=2024-03-01"

# Response includes:
# "casualty_date": "2024-03-15"
# "casualty_type": "Collision" / "Fire" / "Grounded" / etc.
# "casualty_details": narrative
```

**Settlement Logic:**
```
IF casualty_count > 0 during voyage → YES wins (incident occurred)
IF casualty_count == 0 → NO wins (safe voyage)
```

**Casualty Types for Market Variants:**
- Collision
- Fire/Explosion
- Grounded/Beached
- Foundering/Sinking
- Machinery Failure
- Other

---

## 4. VOYAGE COMPLETION Markets

**Market:** "Will voyage complete within 35 days?"

### EMISSION (Create Market)

| Purpose | Endpoint | Parameters |
|---------|----------|------------|
| Vessel info | `/api/v0/vessel_info` | `imo` |
| Current position | `/api/v0/vessel` | `imo` |
| Historical tracks | `/api/v0/vessel_history` | `imo`, `from`, `to` |
| Port info | `/api/v0/port_find` | `locode` or `name` |

```bash
# 1. Get vessel info
curl "https://api.datalastic.com/api/v0/vessel_info?api-key=KEY&imo=9703318"

# 2. Get current position + destination
curl "https://api.datalastic.com/api/v0/vessel?api-key=KEY&imo=9703318"
# Returns: destination, eta, speed, course

# 3. Get destination port info
curl "https://api.datalastic.com/api/v0/port_find?api-key=KEY&locode=NLRTM"

# 4. Historical performance (optional - past voyage times)
curl "https://api.datalastic.com/api/v0/vessel_history?api-key=KEY&imo=9703318&from=2024-01-01&to=2024-02-01"
```

### SETTLEMENT (Resolve Market)

| Purpose | Endpoint | Parameters | Check |
|---------|----------|------------|-------|
| Track vessel arrival | `/api/v0/vessel` | `imo` | Position at destination port |
| OR location history | `/api/v0/vessel_inradius` | `lat`, `lon`, `radius` | Vessel in port area |

```bash
# Poll vessel position until arrival
curl "https://api.datalastic.com/api/v0/vessel?api-key=KEY&imo=9703318"

# Check if vessel is in destination port area
curl "https://api.datalastic.com/api/v0/vessel_inradius?api-key=KEY&lat=51.9&lon=4.5&radius=10"
```

**Settlement Logic:**
```
voyage_days = arrival_timestamp - departure_timestamp
IF voyage_days <= 35 → YES wins (on time)
IF voyage_days > 35 → NO wins (delayed)
```

---

## 5. PORT CONGESTION Markets

**Market:** "Will LA/LB have >20 vessels waiting at anchor?"

### EMISSION (Create Market)

| Purpose | Endpoint | Parameters |
|---------|----------|------------|
| Port info | `/api/v0/port_find` | `locode` or `name` |
| Port terminals | `/api/v0/terminals` | `locode` |
| Current vessels in area | `/api/v0/vessel_inradius` | `lat`, `lon`, `radius` |

```bash
# 1. Get port coordinates
curl "https://api.datalastic.com/api/v0/port_find?api-key=KEY&locode=USLAX"

# 2. Get terminals
curl "https://api.datalastic.com/api/v0/terminals?api-key=KEY&locode=USLAX"

# 3. Get vessels currently in port area
curl "https://api.datalastic.com/api/v0/vessel_inradius?api-key=KEY&lat=33.74&lon=-118.27&radius=20"
```

### SETTLEMENT (Resolve Market)

| Purpose | Endpoint | Parameters | Check |
|---------|----------|------------|-------|
| Count vessels in area | `/api/v0/vessel_inradius` | `lat`, `lon`, `radius` | Count with nav_status = "at anchor" |

```bash
# Count vessels at anchor in port area
curl "https://api.datalastic.com/api/v0/vessel_inradius?api-key=KEY&lat=33.74&lon=-118.27&radius=20"

# Filter response by:
# "nav_status": "at anchor" (not "moored" or "underway")
```

**Settlement Logic:**
```
anchored_count = vessels.filter(nav_status == "at anchor").count()
IF anchored_count > 20 → YES wins (congested)
IF anchored_count <= 20 → NO wins (not congested)
```

---

## Quick Reference: All Endpoints

### Vessel Tracking
| Endpoint | URL | Use |
|----------|-----|-----|
| Live Position | `/api/v0/vessel` | Current location |
| Vessel Info | `/api/v0/vessel_info` | Static specs |
| Historical Track | `/api/v0/vessel_history` | Past positions |
| Area Search | `/api/v0/vessel_inradius` | Vessels in radius |
| Vessel Finder | `/api/v0/vessel_find` | Search by name |

### Maritime Reports (Add-Ons)
| Endpoint | URL | Use |
|----------|-----|-----|
| **Inspections** | `/api/maritime_reports/inspections` | PSC detention data |
| **Casualties** | `/api/maritime_reports/casualty` | Accidents/incidents |
| **Dry Dock** | `/api/maritime_reports/dry_dock_dates` | Maintenance schedule |
| Classification | `/api/maritime_reports/classification` | Class society status |
| Ownership | `/api/maritime_reports/ownership` | Ship owner data |
| Engine Data | `/api/maritime_reports/engines` | Engine specs |

### Port Data
| Endpoint | URL | Use |
|----------|-----|-----|
| Port Finder | `/api/v0/port_find` | Port info by locode |
| Terminals | `/api/v0/terminals` | Terminal details |

---

## Example: Full PSC Market Flow

### 1. EMISSION
```python
import requests

API_KEY = "your_key"
BASE = "https://api.datalastic.com/api"

# Get vessel data
vessel = requests.get(f"{BASE}/v0/vessel_info?api-key={API_KEY}&imo=9703318").json()

# Get inspection history
inspections = requests.get(f"{BASE}/maritime_reports/inspections?api-key={API_KEY}&imo=9703318").json()

# Calculate risk score
detention_count = sum(1 for i in inspections['data'] if i['detention'] == 'TRUE')
deficiency_avg = sum(int(i['ship_deficiencies']) for i in inspections['data']) / len(inspections['data'])

risk_score = detention_count * 0.3 + deficiency_avg * 0.1

# Create market with initial odds based on risk_score
market = create_market(
    vessel_imo="9703318",
    vessel_name=vessel['data']['name'],
    risk_score=risk_score,
    initial_yes_price=85 - (risk_score * 10)  # Higher risk = lower YES price
)
```

### 2. SETTLEMENT
```python
def check_psc_settlement(market_id, vessel_imo, market_start_date):
    # Get inspections since market started
    inspections = requests.get(
        f"{BASE}/maritime_reports/inspections?api-key={API_KEY}&imo={vessel_imo}&from={market_start_date}"
    ).json()
    
    if not inspections['data']:
        return None  # No inspection yet, market still open
    
    latest = inspections['data'][0]
    
    if latest['detention'] == 'TRUE':
        return 'NO'  # Vessel was detained
    else:
        return 'YES'  # Vessel passed inspection
```

---

## Pricing Note

| Plan | Monthly | Includes |
|------|---------|----------|
| Starter | €199 | Base tracking APIs |
| + Inspections | €399/mo | PSC detention data |
| + Casualties | €399/mo | Incident data |
| + Dry Dock | €399/mo | Maintenance data |

**Recommended for MVP:** Starter (€199) + Inspections Add-On (€399) = **€598/mo total**

This gives you PSC Detention markets with the highest value and clearest settlement logic.
