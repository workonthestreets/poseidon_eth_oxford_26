# Maritime Market Parameters Guide

## Using Terminal49 API Data for Prediction Markets

This document explains which Terminal49 API parameters can be used to **create market rules** and **settle markets** for maritime demurrage prediction markets.

---

## Table of Contents
1. [Understanding the Maritime Journey](#understanding-the-maritime-journey)
2. [Key Timestamps for Demurrage](#key-timestamps-for-demurrage)
3. [Market Creation Parameters](#market-creation-parameters)
4. [Market Settlement Parameters](#market-settlement-parameters)
5. [Milestone Events for Triggers](#milestone-events-for-triggers)
6. [Example Market Configurations](#example-market-configurations)
7. [Data Availability by Carrier](#data-availability-by-carrier)

---

## Understanding the Maritime Journey

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        CONTAINER SHIPPING LIFECYCLE                              │
└─────────────────────────────────────────────────────────────────────────────────┘

PORT OF LADING (Origin)                     PORT OF DISCHARGE (Destination)
        │                                              │
        ▼                                              ▼
┌───────────────┐                             ┌───────────────┐
│   FULL IN     │                             │VESSEL ARRIVED │ ◄── ETA vs ATA
│ (Container    │                             │ (At anchorage)│
│  loaded)      │                             └───────┬───────┘
└───────┬───────┘                                     │
        │                                             ▼
        ▼                                     ┌───────────────┐
┌───────────────┐                             │VESSEL BERTHED │ ◄── Waiting time starts
│VESSEL LOADED  │                             │ (At dock)     │     being counted here
└───────┬───────┘                             └───────┬───────┘
        │                                             │
        ▼                                             ▼
┌───────────────┐                             ┌───────────────┐
│VESSEL DEPARTED│                             │   VESSEL      │ ◄── Container off ship
│ (ETD → ATD)   │                             │  DISCHARGED   │
└───────┬───────┘                             └───────┬───────┘
        │                                             │
        │         OCEAN TRANSIT                       ▼
        │    ─────────────────────────►       ┌───────────────┐
        │                                     │  AVAILABLE    │ ◄── Ready for pickup
        │                                     │ FOR PICKUP    │
        │                                     └───────┬───────┘
        │                                             │
        │                                             ▼
        │                                     ┌───────────────┐
        │                                     │   FULL OUT    │ ◄── Consignee picks up
        │                                     │ (Gate out)    │
        │                                     └───────┬───────┘
        │                                             │
        │                                             ▼
        │                                     ┌───────────────┐
        │                                     │ LAST FREE DAY │ ◄── Demurrage starts
        │                                     │   (LFD)       │     after this date
        └─────────────────────────────────────┴───────────────┘
```

---

## Key Timestamps for Demurrage

### From Terminal49 API - Shipment Level

| Parameter | API Field | Use Case |
|-----------|-----------|----------|
| **Estimated Time of Departure** | `estimated_departure` | Market creation - baseline expectation |
| **Actual Time of Departure** | `actual_departure` | Settlement - confirm voyage started |
| **Estimated Time of Arrival (POD)** | `estimated_arrival` | Market creation - expected arrival |
| **Actual Time of Arrival (POD)** | `actual_arrival` | **SETTLEMENT** - when vessel arrived |
| **Port of Lading** | `port_of_lading` | Market identification |
| **Port of Discharge** | `port_of_discharge` | Market identification |
| **Vessel Name** | `vessel_name` | Market identification |
| **Vessel IMO** | `vessel_imo` | Unique vessel identifier |
| **Voyage Number** | `voyage_number` | Unique voyage identifier |

### From Terminal49 API - Container Level

| Parameter | API Field | Use Case |
|-----------|-----------|----------|
| **Container Number** | `container_number` | Per-container markets |
| **Last Free Day (LFD)** | `last_free_day` | **CRITICAL** - demurrage calculation |
| **Availability for Pickup** | `available_for_pickup` | Settlement trigger |
| **Holds** | `holds[]` | Affects pickup ability |
| **Fees (Demurrage)** | `fees[]` | Direct demurrage evidence |
| **Full Out Timestamp** | `full_out_at` | When container was picked up |

---

## Market Creation Parameters

When creating a demurrage prediction market, use these parameters:

### Required Parameters

```json
{
  "market": {
    "vessel_imo": "9811000",
    "vessel_name": "Ever Given",
    "voyage_number": "0TP23W1MA",
    "port_of_lading": {
      "name": "Shanghai",
      "locode": "CNSHA"
    },
    "port_of_discharge": {
      "name": "Rotterdam", 
      "locode": "NLRTM"
    },
    "estimated_arrival": "2024-03-15T14:00:00Z",
    "demurrage_rules": {
      "free_time_hours": 72,
      "measurement_type": "vessel_berthed_to_full_out"
    }
  }
}
```

### Demurrage Rule Types

| Rule Type | Description | Start Event | End Event |
|-----------|-------------|-------------|-----------|
| `vessel_arrival_delay` | Vessel arrives late | ETA | ATA (vessel_arrived) |
| `berth_waiting_time` | Time waiting for berth | vessel_arrived | vessel_berthed |
| `discharge_delay` | Time to unload | vessel_berthed | vessel_discharged |
| `availability_delay` | Time until available | vessel_discharged | available_for_pickup |
| `pickup_delay` | Consignee pickup time | available_for_pickup | full_out |
| `total_port_time` | Total time at port | vessel_arrived | full_out |

---

## Market Settlement Parameters

### Primary Settlement Events

These are the **definitive events** that should trigger market resolution:

#### 1. Vessel Arrival Delay Market
```
RULE:    "Will vessel arrive more than 24 hours late?"
MEASURE: Actual Time of Arrival - Estimated Time of Arrival
SETTLE:  When `container.transport.vessel_arrived` event fires

Settlement Logic:
  - delay_hours = (actual_arrival - estimated_arrival) / 3600
  - IF delay_hours > 24 THEN YES wins
  - ELSE NO wins
```

#### 2. Berth Waiting Time Market  
```
RULE:    "Will vessel wait more than 12 hours for berth?"
MEASURE: Vessel Berthed Time - Vessel Arrived Time
SETTLE:  When `container.transport.vessel_berthed` event fires

Settlement Logic:
  - waiting_hours = (berthed_at - arrived_at) / 3600
  - IF waiting_hours > 12 THEN YES wins (demurrage likely)
  - ELSE NO wins
```

#### 3. Container Discharge Market
```
RULE:    "Will container be discharged within 48 hours of berthing?"
MEASURE: Vessel Discharged Time - Vessel Berthed Time
SETTLE:  When `container.transport.vessel_discharged` event fires

Settlement Logic:
  - discharge_hours = (discharged_at - berthed_at) / 3600
  - IF discharge_hours <= 48 THEN YES wins (on-time)
  - ELSE NO wins (delayed)
```

#### 4. Demurrage Occurrence Market (Most Common)
```
RULE:    "Will demurrage fees be incurred on this shipment?"
MEASURE: Full Out Date vs Last Free Day
SETTLE:  When `container.transport.full_out` event fires

Settlement Logic:
  - IF full_out_date > last_free_day THEN YES wins (demurrage!)
  - ELSE NO wins (picked up on time)
  
Alternative: Check `fees[]` array for demurrage fee > 0
```

#### 5. Container Availability Market
```
RULE:    "Will container be available within 24 hours of discharge?"
MEASURE: Available for Pickup Time - Vessel Discharged Time
SETTLE:  When `container.transport.available` event fires

Settlement Logic:
  - availability_hours = (available_at - discharged_at) / 3600
  - IF availability_hours <= 24 THEN YES wins
  - ELSE NO wins
```

---

## Milestone Events for Triggers

### Events That Can Create Markets

| Event | API Event Name | Market Type |
|-------|---------------|-------------|
| Container Loaded | `container.transport.full_in` | Departure delay |
| Vessel Departed | `container.transport.vessel_departed` | Transit time |
| Transshipment | `container.transport.transshipment_*` | Connection delay |

### Events That Can Settle Markets

| Event | API Event Name | What It Proves |
|-------|---------------|----------------|
| **Vessel Arrived** | `container.transport.vessel_arrived` | Arrival delay resolution |
| **Vessel Berthed** | `container.transport.vessel_berthed` | Berth waiting time |
| **Vessel Discharged** | `container.transport.vessel_discharged` | Discharge efficiency |
| **Available for Pickup** | `container.transport.available` | Terminal processing time |
| **Full Out** | `container.transport.full_out` | **Demurrage final settlement** |
| **LFD Changed** | `container.pickup_lfd.changed` | Free time adjustments |

---

## Example Market Configurations

### Market 1: Simple Arrival Delay

```json
{
  "market_type": "vessel_arrival_delay",
  "title": "Will Ever Given arrive at Rotterdam more than 24 hours late?",
  "vessel_imo": "9811000",
  "voyage": "0TP23W1MA",
  "port_of_discharge": "NLRTM",
  
  "creation_parameters": {
    "estimated_arrival": "2024-03-15T14:00:00Z",
    "threshold_hours": 24
  },
  
  "settlement_parameters": {
    "trigger_event": "container.transport.vessel_arrived",
    "settlement_field": "actual_arrival",
    "comparison": "delay_from_estimate",
    "yes_condition": "delay_hours > 24"
  }
}
```

### Market 2: Demurrage Occurrence (Full Lifecycle)

```json
{
  "market_type": "demurrage_occurrence",
  "title": "Will container MSCU1234567 incur demurrage at Long Beach?",
  "container_number": "MSCU1234567",
  "port_of_discharge": "USLGB",
  
  "creation_parameters": {
    "estimated_arrival": "2024-03-20T08:00:00Z",
    "standard_free_time_days": 5,
    "carrier": "MSC"
  },
  
  "settlement_parameters": {
    "trigger_event": "container.transport.full_out",
    "primary_check": {
      "field": "full_out_at",
      "compare_to": "last_free_day",
      "yes_condition": "full_out_at > last_free_day"
    },
    "fallback_check": {
      "field": "fees",
      "type": "demurrage",
      "yes_condition": "amount > 0"
    }
  }
}
```

### Market 3: Port Congestion (Berth Wait)

```json
{
  "market_type": "berth_waiting_time",
  "title": "Will MSC Oscar wait more than 48 hours for berth at Los Angeles?",
  "vessel_imo": "9703318",
  "port_of_discharge": "USLAX",
  
  "creation_parameters": {
    "estimated_arrival": "2024-03-18T06:00:00Z",
    "congestion_threshold_hours": 48
  },
  
  "settlement_parameters": {
    "start_event": "container.transport.vessel_arrived",
    "end_event": "container.transport.vessel_berthed",
    "measurement": "time_between_events",
    "yes_condition": "hours_elapsed > 48"
  }
}
```

### Market 4: Multi-Leg Journey

```json
{
  "market_type": "total_transit_time",
  "title": "Will shipment reach Chicago within 25 days of Shanghai departure?",
  "shipment_id": "BL123456789",
  "origin": "CNSHA",
  "final_destination": "USCHI",
  
  "creation_parameters": {
    "departure_date": "2024-03-01T00:00:00Z",
    "target_days": 25
  },
  
  "settlement_parameters": {
    "trigger_event": "container.transport.arrived_at_inland_destination",
    "measurement": "days_from_departure",
    "yes_condition": "transit_days <= 25"
  },
  
  "intermediate_milestones": [
    "container.transport.vessel_departed",
    "container.transport.vessel_arrived",
    "container.transport.vessel_discharged",
    "container.transport.rail_loaded",
    "container.transport.rail_departed",
    "container.transport.rail_arrived"
  ]
}
```

---

## Data Availability by Carrier

### Best Data Coverage (Recommended for Markets)

| Carrier | ETA | ATA | LFD | Discharge Time | Full Out |
|---------|-----|-----|-----|----------------|----------|
| Maersk | ✅ | ✅ | ✅ | ✅ | ✅ |
| MSC | ✅ | ✅ | ✅ | ✅ | ✅ |
| CMA-CGM | ✅ | ✅ | ✅ | ✅ | ✅ |
| Hapag-Lloyd | ✅ | ✅ | ✅ | ✅ | ✅ |
| ONE | ✅ | ✅ | ✅ | ✅ | ✅ |
| Evergreen | ⚠️ Date only | ⚠️ Date only | ✅ | ✅ | ✅ |
| COSCO | ⚠️ Limited | ✅ | ✅ | ✅ | ✅ |

### Terminal Coverage (For LFD and Availability)

**Full Support:** Long Beach, Los Angeles, New York/New Jersey, Savannah, Seattle, Oakland, Houston

**Partial Support:** Other US ports, Vancouver, Halifax

---

## Recommended Market Types for User Experience

### For Importers/Consignees
1. **"Will my container incur demurrage?"** - Most relevant, uses LFD + Full Out
2. **"When will my container be available?"** - Uses vessel_discharged + available events

### For Freight Forwarders
1. **"Will this vessel arrive on time?"** - ETA vs ATA comparison
2. **"Port congestion index"** - Berth waiting time markets

### For Traders/Speculators
1. **"Aggregate demurrage rate this week at LA/LB"** - Multiple container resolution
2. **"Transit time variance for Shanghai-Rotterdam route"** - Statistical markets

---

## Settlement Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        SETTLEMENT DATA FLOW                                      │
└─────────────────────────────────────────────────────────────────────────────────┘

   Terminal49 API                    MaritimeShield                    Blockchain
        │                                 │                                 │
        │  Webhook: vessel_arrived        │                                 │
        ├────────────────────────────────►│                                 │
        │  {                              │  Compare with market rules      │
        │    event: "vessel_arrived",     │  ─────────────────────────►     │
        │    timestamp: "...",            │                                 │
        │    vessel_imo: "9811000"        │  IF delay > threshold:          │
        │  }                              │    outcome = YES                │
        │                                 │  ELSE:                          │
        │                                 │    outcome = NO                 │
        │                                 │                                 │
        │                                 │  Submit to Oracle Contract      │
        │                                 ├────────────────────────────────►│
        │                                 │  reportOutcome(marketId, YES)   │
        │                                 │                                 │
        │                                 │                    Resolve CTF  │
        │                                 │◄────────────────────────────────┤
        │                                 │  YES tokens → $1.00             │
        │                                 │  NO tokens → $0.00              │
        │                                 │                                 │
```

---

## Integration Code Example

```rust
// src/oracle/terminal49.rs

use chrono::{DateTime, Utc};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct Terminal49Event {
    pub event: String,
    pub timestamp: DateTime<Utc>,
    pub container: ContainerData,
    pub shipment: ShipmentData,
}

#[derive(Deserialize)]  
pub struct ContainerData {
    pub number: String,
    pub last_free_day: Option<DateTime<Utc>>,
    pub available_for_pickup: Option<DateTime<Utc>>,
    pub full_out_at: Option<DateTime<Utc>>,
    pub fees: Vec<Fee>,
}

#[derive(Deserialize)]
pub struct Fee {
    pub fee_type: String,  // "demurrage", "exam", "other"
    pub amount: f64,
}

impl Terminal49Event {
    /// Determine market outcome based on event type and market rules
    pub fn resolve_market(&self, market: &Market) -> Option<MarketOutcome> {
        match self.event.as_str() {
            "container.transport.vessel_arrived" => {
                self.resolve_arrival_delay(market)
            }
            "container.transport.vessel_berthed" => {
                self.resolve_berth_waiting(market)
            }
            "container.transport.vessel_discharged" => {
                self.resolve_discharge_time(market)
            }
            "container.transport.full_out" => {
                self.resolve_demurrage(market)
            }
            _ => None
        }
    }
    
    fn resolve_demurrage(&self, market: &Market) -> Option<MarketOutcome> {
        let lfd = self.container.last_free_day?;
        let full_out = self.container.full_out_at?;
        
        // Primary check: Did they pick up after LFD?
        if full_out > lfd {
            return Some(MarketOutcome::Yes); // Demurrage occurred
        }
        
        // Fallback: Check if demurrage fees were charged
        let demurrage_fee = self.container.fees.iter()
            .find(|f| f.fee_type == "demurrage");
        
        if let Some(fee) = demurrage_fee {
            if fee.amount > 0.0 {
                return Some(MarketOutcome::Yes);
            }
        }
        
        Some(MarketOutcome::No) // No demurrage
    }
}
```

---

## Summary: Best Parameters for Each Use Case

| Use Case | Creation Params | Settlement Event | Settlement Check |
|----------|-----------------|------------------|------------------|
| **Arrival Delay** | ETA, threshold_hours | vessel_arrived | ATA - ETA > threshold |
| **Berth Congestion** | ETA, berth_threshold | vessel_berthed | berthed_at - arrived_at > threshold |
| **Discharge Speed** | ETA, discharge_threshold | vessel_discharged | discharged_at - berthed_at > threshold |
| **Demurrage** | ETA, free_time_days | full_out | full_out_at > LFD OR demurrage_fee > 0 |
| **Total Transit** | departure_date, target_days | arrived_at_inland_destination | total_days > target |

---

## Webhook Setup for Real-Time Settlement

```bash
# Register webhook with Terminal49
curl -X POST https://api.terminal49.com/v2/webhooks \
  -H "Authorization: Token YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "webhook": {
      "url": "https://your-oracle-service.com/terminal49/events",
      "events": [
        "container.transport.vessel_arrived",
        "container.transport.vessel_berthed", 
        "container.transport.vessel_discharged",
        "container.transport.available",
        "container.transport.full_out",
        "container.pickup_lfd.changed"
      ]
    }
  }'
```

This enables automatic market settlement when Terminal49 detects the relevant milestone events!
