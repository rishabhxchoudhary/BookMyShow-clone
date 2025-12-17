# BookMyShow Clone - Architecture Documentation

## Table of Contents
1. [System Overview](#system-overview)
2. [Current Implementation](#current-implementation)
   - [Hybrid Architecture](#hybrid-architecture)
   - [Seat Locking Mechanism](#seat-locking-mechanism)
   - [Booking Queue System](#booking-queue-system)
   - [Optimistic Locking](#optimistic-locking)
3. [Booking Flow](#booking-flow)
4. [State Machines](#state-machines)
5. [Scaling to Production](#scaling-to-production)

---

## System Overview

This BookMyShow clone uses a **hybrid architecture** combining:
- **AWS Lambda Backend**: For movie/show data (PostgreSQL + Redis)
- **Next.js Local API**: For booking operations (in-memory store with advanced locking)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         HYBRID ARCHITECTURE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Browser/Client                                                            │
│        │                                                                    │
│        ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                      Next.js Application                            │   │
│   │                                                                     │   │
│   │  ┌───────────────────────┐    ┌────────────────────────────────┐   │   │
│   │  │   Local API Routes    │    │    Lambda API Client           │   │   │
│   │  │   /api/v1/holds       │    │    (movies, shows, seatmap)    │   │   │
│   │  │   /api/v1/orders      │    │                                │   │   │
│   │  │   /api/v1/shows/      │    │                                │   │   │
│   │  │   [showId]/seatmap    │    │                                │   │   │
│   │  └───────────┬───────────┘    └────────────────┬───────────────┘   │   │
│   │              │                                  │                   │   │
│   │              ▼                                  ▼                   │   │
│   │  ┌───────────────────────┐    ┌────────────────────────────────┐   │   │
│   │  │   Memory Store        │    │    AWS API Gateway             │   │   │
│   │  │   - Holds             │    │    ↓                           │   │   │
│   │  │   - Orders            │    │    AWS Lambda Functions        │   │   │
│   │  │   - Seat Versions     │    │    ↓                           │   │   │
│   │  │   - Booking Queues    │    │    PostgreSQL + Redis          │   │   │
│   │  └───────────────────────┘    └────────────────────────────────┘   │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Current Implementation

### Hybrid Architecture

The system uses two data paths:

| Operation | Data Source | Reason |
|-----------|-------------|--------|
| List Movies | Lambda API → PostgreSQL | Centralized movie catalog |
| Movie Details | Lambda API → PostgreSQL | Centralized movie data |
| Show Times | Lambda API → PostgreSQL | Centralized scheduling |
| Base Seat Map | Lambda API → Redis | Seat layout from backend |
| **Seat Holds** | **Local Memory Store** | Fast, consistent local locking |
| **Orders** | **Local Memory Store** | Consistent with holds |
| **Combined Seatmap** | **Local API (merges both)** | Unified availability view |

#### Why Hybrid?
- Lambda `/orders` endpoint had issues
- Local store ensures consistency between holds and orders
- Local seatmap API merges Lambda base data with local holds
- Enables advanced features: queue partitioning, optimistic locking

### Seat Locking Mechanism

The current implementation uses **in-memory optimistic locking** with:
- **10-minute TTL** for holds
- **Expiration check on GET** (no database writes)
- **Multiple holds per user** (each tab/session independent)

#### Key Data Structures

```typescript
// In-memory storage
const holds = new Map<string, Hold>();
const orders = new Map<string, Order>();
const seatVersions = new Map<string, SeatVersion>();  // For optimistic locking
const bookingQueues = new Map<string, QueuedBooking[]>();  // Partitioned queues

// Hold with 10-minute TTL
interface Hold {
  holdId: string;
  showId: string;
  userId: string;
  seatIds: string[];      // e.g., ["A1", "A2"]
  quantity: number;
  status: "HELD" | "EXPIRED" | "RELEASED";
  createdAt: string;
  expiresAt: string;      // TTL = 10 minutes
}

// Seat version for optimistic locking
interface SeatVersion {
  version: number;
  lockedBy: string | null;
  lockedAt: number | null;
}
```

#### Expiration Without Database Writes

```typescript
// Expiration check happens on READ, not WRITE
function getEffectiveHoldStatus(hold: Hold): Hold["status"] {
  if (hold.status === "HELD" && new Date(hold.expiresAt) < new Date()) {
    return "EXPIRED";  // Returns EXPIRED status without updating storage
  }
  return hold.status;
}

// When fetching seat availability, expired holds are treated as available
function getHeldSeatIdsForShow(showId: string): string[] {
  const result: string[] = [];
  for (const hold of holds.values()) {
    if (hold.showId === showId) {
      const effectiveStatus = getEffectiveHoldStatus(hold);
      if (effectiveStatus === "HELD") {
        result.push(...hold.seatIds);
      }
      // Expired holds are NOT included - seats appear available
    }
  }
  return result;
}
```

### Booking Queue System

Handles high-concurrency scenarios with partitioned queues:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       QUEUE PARTITIONING STRATEGY                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Queue Key Pattern: {showId}:{tier}                                        │
│                                                                             │
│   Seat Tier Classification:                                                 │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  TIER 1 (Premium/Front)     │  TIER 2 (Regular/Back)               │   │
│   │  Rows A, B, C, D, E         │  Rows F, G, H, I, J, K...            │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│   Example Queues:                                                           │
│   ┌─────────────────────────────┐  ┌─────────────────────────────────┐     │
│   │ show_123:tier1              │  │ show_123:tier2                  │     │
│   │ ├── Booking 1 (seats A1-A2) │  │ ├── Booking 3 (seats F1-F4)     │     │
│   │ ├── Booking 2 (seats B3-B4) │  │ ├── Booking 4 (seats G2-G3)     │     │
│   │ └── ...                     │  │ └── ...                         │     │
│   └─────────────────────────────┘  └─────────────────────────────────┘     │
│                                                                             │
│   Benefits:                                                                 │
│   - Parallel processing of different seat tiers                             │
│   - Premium seats don't block regular seat bookings                         │
│   - Reduced queue contention                                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

```typescript
// Tier determination
function getSeatTier(seatId: string): "tier1" | "tier2" {
  const row = seatId.charAt(0).toUpperCase();
  return row <= "E" ? "tier1" : "tier2";  // A-E = premium, F-Z = regular
}

// Queue processing (async version for high-concurrency)
async function createHoldAsync(showId, userId, seatIds, quantity) {
  const tier = getPrimaryTier(seatIds);
  const queueKey = `${showId}:${tier}`;

  return new Promise((resolve) => {
    bookingQueues.get(queueKey).push({
      showId, userId, seatIds, quantity, resolve
    });
    processQueue(queueKey);  // Serial processing within partition
  });
}
```

### Optimistic Locking

Prevents race conditions when multiple users try to book the same seat:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       OPTIMISTIC LOCKING FLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   User A (booking A1)                User B (booking A1)                    │
│         │                                    │                              │
│   1. Read seat version                 1. Read seat version                 │
│      A1: version=5                        A1: version=5                     │
│         │                                    │                              │
│   2. Check seat available ✓            2. Check seat available ✓            │
│         │                                    │                              │
│   3. Try lock with version=5           3. Try lock with version=5           │
│      ↓                                       ↓                              │
│   ┌─────────────────────┐              ┌─────────────────────┐              │
│   │ Check: current == 5 │              │ Check: current == 6 │              │
│   │ Result: YES ✓       │              │ Result: NO ✗        │              │
│   │ Lock acquired       │              │ Version mismatch!   │              │
│   │ Version → 6         │              │ Seat was just taken │              │
│   └─────────────────────┘              └─────────────────────┘              │
│         │                                    │                              │
│   4. Hold created                      4. Return error:                     │
│      Success!                             "Seat A1 was just taken"          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

```typescript
function tryAcquireSeatLock(
  showId: string,
  seatId: string,
  userId: string,
  expectedVersion: number
): { success: boolean; currentVersion: number } {
  const current = getSeatVersion(showId, seatId);

  // Check if already locked by another user (and not expired)
  if (current.lockedBy && current.lockedBy !== userId && current.lockedAt) {
    const lockAge = Date.now() - current.lockedAt;
    if (lockAge < HOLD_TTL_MS) {
      return { success: false, currentVersion: current.version };
    }
  }

  // Optimistic locking: version must match
  if (current.version !== expectedVersion) {
    return { success: false, currentVersion: current.version };
  }

  // Acquire lock with version increment
  seatVersions.set(key, {
    version: current.version + 1,
    lockedBy: userId,
    lockedAt: Date.now(),
  });

  return { success: true, currentVersion: current.version + 1 };
}
```

---

## Booking Flow

### Complete Flow Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          COMPLETE BOOKING FLOW                              │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────┐ │
│  │  Browse  │───▶│  Select  │───▶│  Select  │───▶│  Create  │───▶│Create│ │
│  │  Movies  │    │   Show   │    │  Seats   │    │   Hold   │    │Order │ │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘    └──┬───┘ │
│                                                                      │     │
│  Lambda API      Lambda API      Local API       Local API      Local API │
│  GET /movies     GET /shows      GET /seatmap    POST /holds    POST /orders
│                                  (merged)        (10 min TTL)   (5 min TTL)│
│                                                                      │     │
│                                                                      ▼     │
│                                                              ┌──────────┐  │
│                                                              │  Confirm │  │
│                                                              │ Payment  │  │
│                                                              └──────────┘  │
│                                                                      │     │
│                                                    POST /orders/{id}/confirm
│                                                                      │     │
│                                                                      ▼     │
│                                                              ┌──────────┐  │
│                                                              │  Ticket  │  │
│                                                              │  Issued  │  │
│                                                              └──────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

### API Call Sequence

| Step | Endpoint | Source | Auth | Purpose |
|------|----------|--------|------|---------|
| 1 | `GET /movies` | Lambda | No | List movies |
| 2 | `GET /movies/{id}` | Lambda | No | Movie details |
| 3 | `GET /movies/{id}/shows?date=` | Lambda | No | Shows by date |
| 4 | `GET /api/v1/shows/{id}/seatmap` | **Local** | No | Combined seat map |
| 5 | `POST /api/v1/holds` | **Local** | **Yes** | Lock seats (10 min TTL) |
| 6 | `POST /api/v1/orders` | **Local** | **Yes** | Create order from hold |
| 7 | `POST /api/v1/orders/{id}/confirm-payment` | **Local** | **Yes** | Confirm payment |

### Seatmap Merging

The local seatmap API combines data from Lambda and local memory:

```typescript
// GET /api/v1/shows/[showId]/seatmap
export async function GET(request, { params }) {
  // 1. Get base seatmap from Lambda (layout + Lambda-side bookings)
  const lambdaSeatmap = await bmsAPI.getSeatmap(showId);

  // 2. Get locally held seats
  const localHeldSeats = getHeldSeatIdsForShow(showId);

  // 3. Get locally confirmed seats
  const localConfirmedSeats = getConfirmedSeatIdsForShow(showId);

  // 4. Merge all unavailable seats
  const allUnavailable = [...new Set([
    ...lambdaSeatmap.unavailableSeatIds,
    ...localConfirmedSeats,
  ])];

  const allHeld = [...new Set([
    ...lambdaSeatmap.heldSeatIds,
    ...localHeldSeats,
  ])];

  return { ...lambdaSeatmap, unavailableSeatIds: allUnavailable, heldSeatIds: allHeld };
}
```

---

## State Machines

### Hold State Machine

```
                    ┌─────────┐
                    │  START  │
                    └────┬────┘
                         │
                         │ POST /holds
                         ▼
                    ┌─────────┐
          ┌────────│  HELD   │────────┐
          │        └────┬────┘        │
          │             │             │
    TTL expires    User releases   Order created
    (10 min)           │             │
          │             │             │
          ▼             ▼             ▼
    ┌─────────┐   ┌──────────┐   (Hold stays HELD,
    │ EXPIRED │   │ RELEASED │    linked to order)
    └─────────┘   └──────────┘

    Note: Expiration is checked on READ without DB writes
```

### Order State Machine

```
                         ┌─────────┐
                         │  START  │
                         └────┬────┘
                              │
                              │ POST /orders
                              ▼
                    ┌─────────────────┐
          ┌────────│ PAYMENT_PENDING │────────┐
          │        └────────┬────────┘        │
          │                 │                 │
    TTL expires      Payment confirmed   Payment failed
    (5 min)                │                 │
          │                 │                 │
          ▼                 ▼                 ▼
    ┌─────────┐       ┌───────────┐      ┌────────┐
    │ EXPIRED │       │ CONFIRMED │      │ FAILED │
    └─────────┘       └───────────┘      └────────┘
                            │
                      Ticket generated
                      (BMS-XXXXXX)
```

---

## Scaling to Production

### Current Limitations

| Limitation | Impact | Production Solution |
|------------|--------|---------------------|
| In-memory storage | Data loss on restart | Redis Cluster |
| Single server | No horizontal scaling | ECS + ALB |
| No persistent holds | Lost on deploy | Redis with persistence |
| Race conditions (edge) | Rare double bookings | Redis Lua atomic scripts |

### Production Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      AWS PRODUCTION ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│    Users                                                                    │
│      │                                                                      │
│      ▼                                                                      │
│   ┌─────────────┐                                                           │
│   │ CloudFront  │ ◄── CDN for static assets                                 │
│   └──────┬──────┘                                                           │
│          │                                                                  │
│          ▼                                                                  │
│   ┌─────────────┐                                                           │
│   │ API Gateway │ ◄── Rate limiting, WAF                                    │
│   └──────┬──────┘                                                           │
│          │                                                                  │
│          ▼                                                                  │
│   ┌─────────────────────────────────────────────────────────────────┐       │
│   │              Application Load Balancer                          │       │
│   └───────────────────────────┬─────────────────────────────────────┘       │
│                               │                                             │
│         ┌─────────────────────┼─────────────────────┐                       │
│         ▼                     ▼                     ▼                       │
│   ┌───────────┐         ┌───────────┐         ┌───────────┐                 │
│   │  ECS Task │         │  ECS Task │         │  ECS Task │                 │
│   │  (Next.js)│         │  (Next.js)│         │  (Next.js)│                 │
│   └─────┬─────┘         └─────┬─────┘         └─────┬─────┘                 │
│         │                     │                     │                       │
│         └─────────────────────┼─────────────────────┘                       │
│                               │                                             │
│    ┌──────────────────────────┼──────────────────────────┐                  │
│    │                          │                          │                  │
│    ▼                          ▼                          ▼                  │
│ ┌──────────┐           ┌───────────┐             ┌─────────────┐            │
│ │ElastiCache│          │   Aurora  │             │     SQS     │            │
│ │  (Redis) │           │ PostgreSQL│             │   Queues    │            │
│ │  Cluster │           │  Cluster  │             │             │            │
│ └──────────┘           └───────────┘             └─────────────┘            │
│      │                       │                         │                    │
│ Seat Locks              Persistent              Async Events                │
│ Hold Metadata           Data Store              (notifications)             │
│ Queue State                                                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Redis Seat Locking (Production)

```lua
-- Atomic seat locking Lua script for Redis
local showId = ARGV[1]
local userId = ARGV[2]
local holdId = ARGV[3]
local ttl = tonumber(ARGV[4])

-- Phase 1: Check all seats are available
for i, seatId in ipairs(KEYS) do
    local key = "seat_lock:" .. showId .. ":" .. seatId
    local existing = redis.call('GET', key)
    if existing then
        local existingUserId = string.match(existing, "^([^:]+)")
        if existingUserId ~= userId then
            return {err = "CONFLICT", seat = seatId}
        end
    end
end

-- Phase 2: Lock all seats atomically
local value = userId .. ":" .. holdId
for i, seatId in ipairs(KEYS) do
    local key = "seat_lock:" .. showId .. ":" .. seatId
    redis.call('SET', key, value, 'EX', ttl)
end

return {ok = true}
```

### Production Checklist

- [ ] Replace in-memory Map with Redis Cluster
- [ ] Implement Lua scripts for atomic seat operations
- [ ] Set up Aurora PostgreSQL with read replicas
- [ ] Configure CloudFront for static + API caching
- [ ] Implement virtual waiting room for flash sales
- [ ] Set up CloudWatch monitoring and alerts
- [ ] Load test with 10K+ concurrent users
- [ ] Implement circuit breakers and fallbacks

---

## Summary

### Key Features Implemented

| Feature | Implementation | Status |
|---------|---------------|--------|
| Seat Lock TTL | 10 minutes, checked on GET | ✅ Complete |
| Expiration without DB writes | `getEffectiveHoldStatus()` | ✅ Complete |
| Booking Queue | Partitioned by showId + tier | ✅ Complete |
| Optimistic Locking | Version numbers per seat | ✅ Complete |
| Multiple Holds per User | Each tab/session independent | ✅ Complete |
| Hybrid Architecture | Lambda + Local API | ✅ Complete |

### Files Modified

- `src/lib/memoryStore.ts` - Core booking logic
- `src/components/SeatSelectorLambda.tsx` - Seat selection UI
- `src/app/api/v1/shows/[showId]/seatmap/route.ts` - Combined seatmap
- `src/app/api/v1/holds/route.ts` - Hold creation
- `src/app/api/v1/orders/route.ts` - Order creation
- `src/app/api/v1/orders/[orderId]/route.ts` - Order retrieval
- `src/app/api/v1/orders/[orderId]/confirm-payment/route.ts` - Payment confirmation
