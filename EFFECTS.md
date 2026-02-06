# EFFECTS: DRAFT 1

## Overview
This project demonstrates an event-driven hedging primitive where real-world logistics data is ingested and deterministically produces a payout.

The system is structured around an explicit effect model to separate pure business logic from side effects.

---

## Effect Inventory (I/O Boundary)

The system performs the following effects:

- Fetch external Web2 data (shipping / logistics API or mock)
- Log events and computed payouts
- Trigger settlement (on-chain or simulated)
- Read configuration values (rates, thresholds)

---

## Effect Definitions

Effects are modeled explicitly using an effect system.

Key effect boundaries:
- DataFetch: retrieving external JSON data
- Logger: structured logging of events
- Settlement: committing payout results

(Concrete implementations are provided at the runtime boundary.)

---

## Pure Core Logic

The pure core consists of deterministic functions that:

- Parse event data
- Compute delay durations
- Calculate payouts based on predefined rules

### These functions are free of I/O and can be tested independently.
### The pure core can be executed against recorded JSON inputs to reproduce outcomes deterministically.

---

## Execution Flow

1. User selects a risk to hedge
2. System fetches event data (effect)
3. Pure logic computes payout
4. Result is logged and settled (effects)

---

## Runtime

- Language: TypeScript
- Effect system: Effect (effect-ts)
- Execution: Program is run via a single runtime entrypoint that wires concrete effect implementations.
