# BookMyShow Clone - Architecture Documentation

## Table of Contents
1. [Current Implementation](#current-implementation)
   - [Seat Locking Mechanism](#seat-locking-mechanism)
   - [Booking Flow](#booking-flow)
   - [State Machines](#state-machines)
2. [Scaling to Billions of Users on AWS](#scaling-to-billions-of-users-on-aws)
   - [High-Level Architecture](#high-level-architecture)
   - [Component Deep Dive](#component-deep-dive)
   - [Data Flow](#data-flow)
   - [Handling Flash Sales](#handling-flash-sales)

---

## Current Implementation

### Seat Locking Mechanism

The current implementation uses an **in-memory optimistic locking** strategy with TTL-based expiration.

#### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                     SEAT LOCKING FLOW                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User Selects Seats                                             │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────┐                                            │
│  │ Check Conflicts │◄─── Query holds Map + orders Map           │
│  └────────┬────────┘                                            │
│           │                                                     │
│     ┌─────┴─────┐                                               │
│     │           │                                               │
│  Conflict?   No Conflict                                        │
│     │           │                                               │
│     ▼           ▼                                               │
│  Return 409  ┌─────────────────┐                                │
│              │ Release User's  │                                │
│              │ Previous Hold   │                                │
│              │ (if exists)     │                                │
│              └────────┬────────┘                                │
│                       │                                         │
│                       ▼                                         │
│              ┌─────────────────┐                                │
│              │ Create New Hold │                                │
│              │ TTL = 5 minutes │                                │
│              └────────┬────────┘                                │
│                       │                                         │
│                       ▼                                         │
│              Return holdId + expiresAt                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Key Data Structures

```typescript
// In-memory storage (current implementation)
const holds = new Map<string, Hold>();
const orders = new Map<string, Order>();

interface Hold {
  holdId: string;
  showId: string;
  userId: string;
  seatIds: string[];      // e.g., ["A1", "A2"]
  quantity: number;
  status: "HELD" | "EXPIRED" | "RELEASED";
  createdAt: string;
  expiresAt: string;      // TTL timestamp
}
```

#### Conflict Detection Algorithm

```typescript
function checkSeatAvailability(showId: string, requestedSeats: string[], userId: string) {
  // 1. Get all active holds for this show (excluding user's own hold)
  const heldSeats = getHeldSeatIdsForShow(showId, userId);

  // 2. Get all confirmed bookings for this show
  const confirmedSeats = getConfirmedSeatIdsForShow(showId);

  // 3. Get permanently unavailable seats (broken, reserved)
  const unavailable = permanentlyUnavailableSeats;

  // 4. Merge all unavailable seats
  const allUnavailable = [...unavailable, ...heldSeats, ...confirmedSeats];

  // 5. Check for conflicts
  const conflicts = requestedSeats.filter(seat => allUnavailable.includes(seat));

  return { hasConflict: conflicts.length > 0, conflicts };
}
```

#### TTL Expiration Handling

The system uses **lazy expiration** - holds are checked and marked expired on read:

```typescript
function updateHoldStatusIfExpired(hold: Hold): Hold {
  if (hold.status === "HELD" && new Date(hold.expiresAt) < new Date()) {
    hold.status = "EXPIRED";
    holds.set(hold.holdId, hold);
  }
  return hold;
}
```

### Booking Flow

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
│  GET /movies     GET /shows      Client-side    POST /holds     POST /orders
│                                  interaction    (Auth required) (Auth req) │
│                                                                      │     │
│                                                                      ▼     │
│                                                              ┌──────────┐  │
│                                                              │  Confirm │  │
│                                                              │ Payment  │  │
│                                                              └──────────┘  │
│                                                                      │     │
│                                                    POST /orders/{id}/confirm-payment
│                                                                      │     │
│                                                                      ▼     │
│                                                              ┌──────────┐  │
│                                                              │  Ticket  │  │
│                                                              │  Issued  │  │
│                                                              └──────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

#### API Call Sequence

| Step | Endpoint | Auth | Purpose |
|------|----------|------|---------|
| 1 | `GET /api/v1/movies` | No | List movies |
| 2 | `GET /api/v1/movies/{id}` | No | Movie details |
| 3 | `GET /api/v1/movies/{id}/availability` | No | Available dates |
| 4 | `GET /api/v1/movies/{id}/shows?date=` | No | Shows by date |
| 5 | `GET /api/v1/shows/{id}/seatmap` | No | Seat layout + availability |
| 6 | `POST /api/v1/holds` | **Yes** | Lock seats (5 min TTL) |
| 7 | `POST /api/v1/orders` | **Yes** | Create order from hold |
| 8 | `POST /api/v1/orders/{id}/confirm-payment` | **Yes** | Mock payment confirmation |

### State Machines

#### Hold State Machine

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
          │             │             │
          ▼             ▼             ▼
    ┌─────────┐   ┌──────────┐   (Hold stays HELD,
    │ EXPIRED │   │ RELEASED │    linked to order)
    └─────────┘   └──────────┘
```

#### Order State Machine

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
          │                 │                 │
          ▼                 ▼                 ▼
    ┌─────────┐       ┌───────────┐      ┌────────┐
    │ EXPIRED │       │ CONFIRMED │      │ FAILED │
    └─────────┘       └───────────┘      └────────┘
          │                                   │
          │           User/Admin cancels      │
          │                 │                 │
          └────────────────►│◄────────────────┘
                            ▼
                      ┌───────────┐
                      │ CANCELLED │
                      └───────────┘
```

---

## Scaling to Billions of Users on AWS

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        AWS PRODUCTION ARCHITECTURE                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│    Users (Billions)                                                             │
│         │                                                                       │
│         ▼                                                                       │
│    ┌─────────┐                                                                  │
│    │Route 53 │ ◄── GeoDNS routing to nearest region                             │
│    └────┬────┘                                                                  │
│         │                                                                       │
│         ▼                                                                       │
│    ┌─────────────┐                                                              │
│    │ CloudFront  │ ◄── CDN for static assets, API caching                       │
│    │    (CDN)    │                                                              │
│    └──────┬──────┘                                                              │
│           │                                                                     │
│           ▼                                                                     │
│    ┌─────────────┐     ┌─────────────┐                                          │
│    │    WAF      │────▶│   Shield    │ ◄── DDoS protection                      │
│    └──────┬──────┘     └─────────────┘                                          │
│           │                                                                     │
│           ▼                                                                     │
│    ┌─────────────────────────────────────────┐                                  │
│    │        Application Load Balancer         │                                  │
│    │         (Multi-AZ, Auto-scaling)         │                                  │
│    └──────────────────┬──────────────────────┘                                  │
│                       │                                                         │
│         ┌─────────────┼─────────────┐                                           │
│         ▼             ▼             ▼                                           │
│    ┌─────────┐   ┌─────────┐   ┌─────────┐                                      │
│    │  ECS    │   │  ECS    │   │  ECS    │  ◄── Fargate containers              │
│    │ Task 1  │   │ Task 2  │   │ Task N  │      Auto-scaling 10-10000           │
│    └────┬────┘   └────┬────┘   └────┬────┘                                      │
│         │             │             │                                           │
│         └─────────────┼─────────────┘                                           │
│                       │                                                         │
│    ┌──────────────────┼──────────────────┐                                      │
│    │                  │                  │                                      │
│    ▼                  ▼                  ▼                                      │
│ ┌──────────┐    ┌───────────┐    ┌─────────────┐                                │
│ │ ElastiCache│   │  Aurora    │    │    SQS      │                                │
│ │  (Redis)  │    │ PostgreSQL │    │   Queues    │                                │
│ │  Cluster  │    │  Cluster   │    │             │                                │
│ └──────────┘    └───────────┘    └─────────────┘                                │
│      │                │                  │                                      │
│ Seat Locks       Persistent         Async Events                                │
│ Session Cache    Data Store         (notifications)                             │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Component Deep Dive

#### 1. Distributed Seat Locking with Redis

Replace in-memory Map with Redis Cluster for distributed locking:

```
┌─────────────────────────────────────────────────────────────────┐
│                 REDIS SEAT LOCKING STRATEGY                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Key Pattern: seat_lock:{showId}:{seatId}                       │
│  Value: {userId}:{holdId}:{timestamp}                           │
│  TTL: 300 seconds (5 minutes)                                   │
│                                                                 │
│  Example:                                                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ KEY: seat_lock:show_123:A1                              │    │
│  │ VALUE: user_456:hold_789:1702828800000                  │    │
│  │ TTL: 300s                                               │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Atomic Locking with Lua Script:**

```lua
-- KEYS[1..N] = seat keys to lock
-- ARGV[1] = userId
-- ARGV[2] = holdId
-- ARGV[3] = TTL in seconds

local function atomicSeatLock(KEYS, ARGV)
    local userId = ARGV[1]
    local holdId = ARGV[2]
    local ttl = tonumber(ARGV[3])

    -- Phase 1: Check all seats are available
    for i, key in ipairs(KEYS) do
        local existing = redis.call('GET', key)
        if existing then
            -- Check if it's the same user (allow update)
            local existingUserId = string.match(existing, "^([^:]+)")
            if existingUserId ~= userId then
                return {err = "CONFLICT", seat = key}
            end
        end
    end

    -- Phase 2: Lock all seats atomically
    local value = userId .. ":" .. holdId .. ":" .. tostring(os.time())
    for i, key in ipairs(KEYS) do
        redis.call('SET', key, value, 'EX', ttl)
    end

    return {ok = true, holdId = holdId}
end
```

**Why Redis Cluster?**

| Feature | Benefit |
|---------|---------|
| Sub-millisecond latency | Fast seat availability checks |
| Automatic TTL expiration | No background cleanup jobs needed |
| Atomic operations (Lua) | Prevents race conditions |
| Cluster mode | Horizontal scaling, 1M+ ops/sec |
| Replication | High availability |

#### 2. Database Layer (Aurora PostgreSQL)

**Schema Design:**

```sql
-- Partitioned by show_date for efficient queries and archival
CREATE TABLE shows (
    show_id UUID PRIMARY KEY,
    movie_id UUID NOT NULL,
    theatre_id UUID NOT NULL,
    screen_id UUID NOT NULL,
    show_date DATE NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'SCHEDULED'
) PARTITION BY RANGE (show_date);

-- Hot partition (current + next 7 days)
CREATE TABLE shows_current PARTITION OF shows
    FOR VALUES FROM (CURRENT_DATE) TO (CURRENT_DATE + INTERVAL '8 days');

-- Orders table with optimized indexes
CREATE TABLE orders (
    order_id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    show_id UUID NOT NULL,
    seat_ids TEXT[] NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    ticket_code VARCHAR(50)
);

-- Composite index for conflict detection
CREATE INDEX idx_orders_show_status ON orders(show_id, status)
    WHERE status = 'CONFIRMED';

-- Index for user's booking history
CREATE INDEX idx_orders_user ON orders(user_id, created_at DESC);
```

**Read Replicas Strategy:**

```
┌─────────────────────────────────────────────────────────────────┐
│                    AURORA READ SCALING                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Write Operations (Orders, Confirmations)                       │
│         │                                                       │
│         ▼                                                       │
│    ┌─────────┐                                                  │
│    │ Primary │ ◄── Single writer, strong consistency            │
│    │   (r6g) │                                                  │
│    └────┬────┘                                                  │
│         │ Async Replication (<10ms lag)                         │
│         │                                                       │
│    ┌────┴────────────────────────────┐                          │
│    │              │                  │                          │
│    ▼              ▼                  ▼                          │
│ ┌───────┐    ┌───────┐          ┌───────┐                       │
│ │Replica│    │Replica│   ...    │Replica│  ◄── Up to 15         │
│ │  #1   │    │  #2   │          │  #15  │      replicas         │
│ └───┬───┘    └───┬───┘          └───┬───┘                       │
│     │            │                  │                           │
│     └────────────┼──────────────────┘                           │
│                  │                                              │
│                  ▼                                              │
│    Read Operations (Movie listings, Show availability)          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### 3. Caching Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                    MULTI-LAYER CACHING                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Layer 1: CloudFront Edge Cache                                 │
│  ├── Movie listings: TTL 5 minutes                              │
│  ├── Movie details: TTL 1 hour                                  │
│  ├── Theatre info: TTL 24 hours                                 │
│  └── Static assets: TTL 1 year                                  │
│                                                                 │
│  Layer 2: ElastiCache (Redis)                                   │
│  ├── Seat availability per show: TTL 10 seconds                 │
│  ├── Show listings by date: TTL 1 minute                        │
│  ├── User session data: TTL 24 hours                            │
│  └── Seat locks: TTL 5 minutes (business rule)                  │
│                                                                 │
│  Layer 3: Application Memory (Node.js LRU)                      │
│  ├── Movie metadata: TTL 5 minutes                              │
│  └── Configuration: TTL on change                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Cache Invalidation Pattern:**

```typescript
// Write-through with async invalidation
async function confirmBooking(orderId: string) {
  // 1. Update database (source of truth)
  await db.orders.update({ orderId, status: 'CONFIRMED' });

  // 2. Invalidate related caches asynchronously
  await Promise.all([
    redis.del(`seat_availability:${showId}`),
    redis.del(`show_stats:${showId}`),
    cloudfront.invalidate(`/api/v1/shows/${showId}/seatmap`),
  ]);

  // 3. Publish event for other services
  await sqs.send('booking.confirmed', { orderId, showId, seats });
}
```

#### 4. Event-Driven Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    EVENT FLOW ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Booking Service                                                │
│        │                                                        │
│        │ booking.confirmed                                      │
│        ▼                                                        │
│   ┌─────────┐                                                   │
│   │   SNS   │ ◄── Fan-out to multiple consumers                 │
│   │  Topic  │                                                   │
│   └────┬────┘                                                   │
│        │                                                        │
│   ┌────┼────────────────────────────┐                           │
│   │    │                            │                           │
│   ▼    ▼                            ▼                           │
│ ┌────┐ ┌────┐                    ┌────┐                         │
│ │SQS │ │SQS │                    │SQS │                         │
│ │ Q1 │ │ Q2 │                    │ Q3 │                         │
│ └─┬──┘ └─┬──┘                    └─┬──┘                         │
│   │      │                         │                            │
│   ▼      ▼                         ▼                            │
│ ┌──────┐ ┌──────┐              ┌──────┐                         │
│ │Email │ │ SMS  │              │Analytics                       │
│ │Lambda│ │Lambda│              │ Firehose                       │
│ └──────┘ └──────┘              └──────┘                         │
│                                    │                            │
│                                    ▼                            │
│                               ┌─────────┐                       │
│                               │Redshift │                       │
│                               │   DW    │                       │
│                               └─────────┘                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

#### Seat Selection Flow (Production)

```
┌────────────────────────────────────────────────────────────────────────────┐
│                     PRODUCTION SEAT LOCKING FLOW                            │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  1. User clicks "Reserve Seats" with [A1, A2]                              │
│     │                                                                      │
│     ▼                                                                      │
│  2. API Gateway → Lambda/ECS                                               │
│     │                                                                      │
│     ▼                                                                      │
│  3. ┌─────────────────────────────────────────────────────────────────┐    │
│     │ Redis Lua Script (Atomic)                                       │    │
│     │ ┌─────────────────────────────────────────────────────────────┐ │    │
│     │ │ MULTI                                                       │ │    │
│     │ │   SETNX seat_lock:show_123:A1 user_456:hold_789 EX 300      │ │    │
│     │ │   SETNX seat_lock:show_123:A2 user_456:hold_789 EX 300      │ │    │
│     │ │ EXEC                                                        │ │    │
│     │ └─────────────────────────────────────────────────────────────┘ │    │
│     └─────────────────────────────────────────────────────────────────┘    │
│     │                                                                      │
│     ├── Success (both SETNX return 1)                                      │
│     │   │                                                                  │
│     │   ▼                                                                  │
│     │   4. Write hold record to Aurora (async, best-effort)                │
│     │   │                                                                  │
│     │   ▼                                                                  │
│     │   5. Return { holdId, expiresAt } to client                          │
│     │                                                                      │
│     └── Failure (any SETNX returns 0)                                      │
│         │                                                                  │
│         ▼                                                                  │
│         6. Rollback: DEL any keys that were set                            │
│         │                                                                  │
│         ▼                                                                  │
│         7. Return 409 Conflict with available seats                        │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### Handling Flash Sales

For high-demand events (e.g., blockbuster movie opening night):

```
┌─────────────────────────────────────────────────────────────────┐
│                    FLASH SALE ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Problem: 1M users trying to book 1000 seats in 10 seconds      │
│                                                                 │
│  Solution: Virtual Waiting Room + Token Bucket                  │
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐     │
│  │                   WAITING ROOM                         │     │
│  │                                                        │     │
│  │  1. User arrives → Assigned queue position             │     │
│  │  2. WebSocket connection for real-time updates         │     │
│  │  3. Token released at controlled rate (100/second)     │     │
│  │  4. User with token can attempt booking                │     │
│  │                                                        │     │
│  └────────────────────────────────────────────────────────┘     │
│                                                                 │
│  Implementation:                                                │
│                                                                 │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐      │
│  │CloudFront    │API GW   │    │ Lambda  │    │  Redis  │      │
│  │+ WAF    │───▶│+ Limits │───▶│ Queue   │───▶│ Sorted  │      │
│  │         │    │         │    │ Manager │    │  Set    │      │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘      │
│                                                                 │
│  Rate Limits:                                                   │
│  ├── CloudFront: 10,000 req/sec per IP                          │
│  ├── WAF: Block suspicious patterns                             │
│  ├── API Gateway: 1,000 req/sec per user                        │
│  └── Application: Token bucket per show                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Cost Optimization

| Component | Scaling Strategy | Estimated Cost (1B requests/month) |
|-----------|-----------------|-----------------------------------|
| CloudFront | Pay per request | ~$850 |
| ALB | Capacity units | ~$500 |
| ECS Fargate | Auto-scale 10-1000 | ~$3,000 |
| Aurora | Serverless v2 | ~$2,000 |
| ElastiCache | r6g.xlarge cluster | ~$1,500 |
| SQS + SNS | Pay per message | ~$200 |
| **Total** | | **~$8,050/month** |

### Monitoring & Observability

```
┌─────────────────────────────────────────────────────────────────┐
│                    OBSERVABILITY STACK                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐        │
│  │  CloudWatch   │  │   X-Ray       │  │  OpenSearch   │        │
│  │   Metrics     │  │   Tracing     │  │    Logs       │        │
│  └───────┬───────┘  └───────┬───────┘  └───────┬───────┘        │
│          │                  │                  │                │
│          └──────────────────┼──────────────────┘                │
│                             │                                   │
│                             ▼                                   │
│                    ┌───────────────┐                            │
│                    │   Grafana     │                            │
│                    │  Dashboards   │                            │
│                    └───────────────┘                            │
│                                                                 │
│  Key Metrics to Monitor:                                        │
│  ├── Seat lock success rate (target: >99%)                      │
│  ├── Lock acquisition latency (target: <50ms p99)               │
│  ├── Booking conversion rate                                    │
│  ├── Hold expiration rate                                       │
│  ├── Redis cluster memory utilization                           │
│  └── Database connection pool saturation                        │
│                                                                 │
│  Alerts:                                                        │
│  ├── Lock failure rate > 5% → PagerDuty                         │
│  ├── p99 latency > 500ms → Slack                                │
│  └── Redis memory > 80% → Auto-scale trigger                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Summary

### Current Implementation Limitations

| Limitation | Impact | Production Solution |
|------------|--------|---------------------|
| In-memory storage | Data loss on restart | Redis Cluster + Aurora |
| Single server | No horizontal scaling | ECS + ALB |
| No real TTL cleanup | Memory growth | Redis native TTL |
| Race conditions possible | Double bookings | Redis Lua atomic scripts |
| No monitoring | Blind operations | CloudWatch + X-Ray |

### Production Checklist

- [ ] Replace in-memory Map with Redis Cluster
- [ ] Implement Lua scripts for atomic operations
- [ ] Set up Aurora PostgreSQL with read replicas
- [ ] Configure CloudFront for static + API caching
- [ ] Implement virtual waiting room for flash sales
- [ ] Set up monitoring dashboards and alerts
- [ ] Load test with 100K concurrent users
- [ ] Implement circuit breakers and fallbacks
- [ ] Set up multi-region failover (optional)
