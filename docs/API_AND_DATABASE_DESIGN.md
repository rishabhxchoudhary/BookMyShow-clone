# API & Database Design Documentation

## Table of Contents

1. [System Overview](#system-overview)
2. [Database Schema Design](#database-schema-design)
3. [Redis Key Design](#redis-key-design)
4. [API Specifications](#api-specifications)
5. [Data Flow Diagrams](#data-flow-diagrams)
6. [Scaling Considerations](#scaling-considerations)

---

## System Overview

### Architecture Summary

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           SYSTEM ARCHITECTURE                             │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐                                                         │
│  │   Client    │                                                         │
│  │ (Browser)   │                                                         │
│  └──────┬──────┘                                                         │
│         │ HTTPS                                                          │
│         ▼                                                                │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐               │
│  │    API      │      │    Load     │      │    ECS      │               │
│  │   Gateway   │─────▶│  Balancer   │─────▶│  Fargate    │               │
│  └─────────────┘      └─────────────┘      └──────┬──────┘               │
│                                                   │                      │
│                           ┌───────────────────────┼───────────────┐      │
│                           │                       │               │      │
│                           ▼                       ▼               ▼      │
│                    ┌───────────┐          ┌───────────┐    ┌──────────┐  │
│                    │   Redis   │          │PostgreSQL │    │   SQS    │  │
│                    │ (Caching  │          │   (RDS)   │    │ (Queue)  │  │
│                    │  + Locks) │          │           │    │          │  │
│                    └───────────┘          └───────────┘    └──────────┘  │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Purpose |
|-----------|---------|
| **API Gateway** | Entry point, rate limiting, request routing |
| **Load Balancer** | Distributes traffic across ECS tasks |
| **ECS Fargate** | Runs your Next.js application containers |
| **PostgreSQL (RDS)** | Persistent storage for movies, shows, orders |
| **Redis (ElastiCache)** | Seat locking, session caching, hot data |
| **SQS** | Async notifications (email, SMS) |

---

## Database Schema Design

### Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ENTITY RELATIONSHIP DIAGRAM                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────┐         ┌───────────────┐         ┌───────────────┐      │
│  │    MOVIES     │         │   THEATRES    │         │    USERS      │      │
│  ├───────────────┤         ├───────────────┤         ├───────────────┤      │
│  │ movie_id (PK) │         │ theatre_id(PK)│         │ user_id (PK)  │      │
│  │ title         │         │ name          │         │ email         │      │
│  │ about         │         │ address       │         │ name          │      │
│  │ rating        │         │ geo_lat       │         │ phone         │      │
│  │ duration_mins │         │ geo_lng       │         │ created_at    │      │
│  │ genres[]      │         │ cancellation  │         └───────┬───────┘      │
│  │ ...           │         │ ...           │                 │              │
│  └───────┬───────┘         └───────┬───────┘                 │              │
│          │                         │                         │              │
│          │         ┌───────────────┴───────────────┐         │              │
│          │         │                               │         │              │
│          ▼         ▼                               │         │              │
│  ┌─────────────────────────┐                       │         │              │
│  │         SHOWS           │                       │         │              │
│  ├─────────────────────────┤                       │         │              │
│  │ show_id (PK)            │                       │         │              │
│  │ movie_id (FK) ──────────┘                       │         │              │
│  │ theatre_id (FK) ────────────────────────────────┘         │              │
│  │ screen_id                                                 │              │
│  │ start_time                                                │              │
│  │ price                                                     │              │
│  │ status                                                    │              │
│  └───────────┬─────────────┘                                 │              │
│              │                                               │              │
│              │                                               │              │
│              ▼                                               │              │
│  ┌─────────────────────────┐                                 │              │
│  │        ORDERS           │                                 │              │
│  ├─────────────────────────┤                                 │              │
│  │ order_id (PK)           │                                 │              │
│  │ show_id (FK) ───────────┘                                 │              │
│  │ user_id (FK) ─────────────────────────────────────────────┘              │
│  │ seat_ids[]                                                               │
│  │ amount                                                                   │
│  │ status                                                                   │
│  │ ticket_code                                                              │
│  │ customer_name                                                            │
│  │ customer_email                                                           │
│  │ customer_phone                                                           │
│  │ created_at                                                               │
│  │ expires_at                                                               │
│  └─────────────────────────┘                                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Table Definitions

#### 1. Movies Table

```sql
CREATE TABLE movies (
    movie_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           VARCHAR(255) NOT NULL,
    about           TEXT,
    thumbnail_url   TEXT,
    banner_url      TEXT,
    rating          DECIMAL(3,1) CHECK (rating >= 0 AND rating <= 10),
    duration_mins   INTEGER NOT NULL CHECK (duration_mins > 0),
    age_rating      VARCHAR(10),  -- 'U', 'UA', 'A', 'S'
    release_date    DATE,
    language        VARCHAR(50),
    format          VARCHAR(20),  -- '2D', '3D', 'IMAX'
    genres          TEXT[],       -- Array: ['Action', 'Drama']
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_movies_release_date ON movies(release_date DESC);
CREATE INDEX idx_movies_is_active ON movies(is_active) WHERE is_active = true;
CREATE INDEX idx_movies_genres ON movies USING GIN(genres);
```

**Sample Data:**
| movie_id | title | rating | duration_mins | genres |
|----------|-------|--------|---------------|--------|
| 550e8400-... | Avatar: Fire and Ash | 8.7 | 192 | {Action, Sci-Fi} |
| 550e8401-... | The Dark Knight Returns | 9.1 | 165 | {Action, Drama} |

---

#### 2. Theatres Table

```sql
CREATE TABLE theatres (
    theatre_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    VARCHAR(255) NOT NULL,
    address                 TEXT,
    city                    VARCHAR(100),
    geo_lat                 DECIMAL(10,8),
    geo_lng                 DECIMAL(11,8),
    cancellation_available  BOOLEAN DEFAULT true,
    is_active               BOOLEAN DEFAULT true,
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_theatres_city ON theatres(city);
CREATE INDEX idx_theatres_location ON theatres USING GIST (
    ll_to_earth(geo_lat, geo_lng)
);  -- For proximity searches
```

---

#### 3. Screens Table

```sql
CREATE TABLE screens (
    screen_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    theatre_id      UUID NOT NULL REFERENCES theatres(theatre_id),
    screen_name     VARCHAR(50) NOT NULL,  -- 'Screen 1', 'IMAX'
    screen_type     VARCHAR(20),           -- 'Standard', 'IMAX', 'Dolby'
    total_seats     INTEGER NOT NULL,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(theatre_id, screen_name)
);
```

---

#### 4. Seat Layouts Table

```sql
CREATE TABLE seat_layouts (
    layout_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    screen_id       UUID NOT NULL REFERENCES screens(screen_id),
    row_label       VARCHAR(5) NOT NULL,   -- 'A', 'B', 'C'
    seat_numbers    INTEGER[] NOT NULL,    -- {1, 2, 3, 4, 5, 6, 7, 8}
    seat_type       VARCHAR(20) DEFAULT 'REGULAR',  -- 'REGULAR', 'PREMIUM', 'RECLINER'
    is_active       BOOLEAN DEFAULT true,

    UNIQUE(screen_id, row_label)
);

-- Example: Screen with 5 rows, 8 seats each
-- Row A: seats 1-8
-- Row B: seats 1-8
-- ...
```

---

#### 5. Shows Table

```sql
CREATE TABLE shows (
    show_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movie_id        UUID NOT NULL REFERENCES movies(movie_id),
    theatre_id      UUID NOT NULL REFERENCES theatres(theatre_id),
    screen_id       UUID NOT NULL REFERENCES screens(screen_id),
    start_time      TIMESTAMPTZ NOT NULL,
    end_time        TIMESTAMPTZ NOT NULL,
    price           DECIMAL(10,2) NOT NULL CHECK (price > 0),
    status          VARCHAR(20) DEFAULT 'AVAILABLE',
    -- Status: 'AVAILABLE', 'FILLING_FAST', 'ALMOST_FULL', 'SOLD_OUT', 'CANCELLED'
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    -- Prevent overlapping shows on same screen
    EXCLUDE USING GIST (
        screen_id WITH =,
        tstzrange(start_time, end_time) WITH &&
    )
);

-- Indexes for common queries
CREATE INDEX idx_shows_movie_date ON shows(movie_id, start_time);
CREATE INDEX idx_shows_theatre_date ON shows(theatre_id, start_time);
CREATE INDEX idx_shows_start_time ON shows(start_time);

-- Partial index for active shows only
CREATE INDEX idx_shows_available ON shows(movie_id, start_time)
    WHERE status != 'CANCELLED' AND start_time > NOW();
```

---

#### 6. Orders Table

```sql
CREATE TABLE orders (
    order_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         VARCHAR(255) NOT NULL,  -- From Auth.js
    show_id         UUID NOT NULL REFERENCES shows(show_id),
    seat_ids        TEXT[] NOT NULL,        -- {'A1', 'A2', 'A3'}

    -- Customer details
    customer_name   VARCHAR(255),
    customer_email  VARCHAR(255),
    customer_phone  VARCHAR(20),

    -- Financial
    amount          DECIMAL(10,2) NOT NULL CHECK (amount > 0),

    -- Status tracking
    status          VARCHAR(20) NOT NULL DEFAULT 'PAYMENT_PENDING',
    -- Status: 'PAYMENT_PENDING', 'CONFIRMED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED'

    -- Ticket
    ticket_code     VARCHAR(50) UNIQUE,

    -- Timestamps
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    expires_at      TIMESTAMPTZ,
    confirmed_at    TIMESTAMPTZ,
    cancelled_at    TIMESTAMPTZ,

    -- Constraints
    CONSTRAINT valid_seat_count CHECK (array_length(seat_ids, 1) > 0)
);

-- Indexes
CREATE INDEX idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX idx_orders_show_status ON orders(show_id, status);
CREATE INDEX idx_orders_status_expires ON orders(status, expires_at)
    WHERE status = 'PAYMENT_PENDING';

-- Prevent double booking (same seat, same show, confirmed)
CREATE UNIQUE INDEX idx_orders_unique_seats ON orders(show_id, seat_ids)
    WHERE status = 'CONFIRMED';
```

---

#### 7. Cast & Crew Tables

```sql
CREATE TABLE persons (
    person_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    image_url       TEXT,
    bio             TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE movie_cast (
    movie_id        UUID REFERENCES movies(movie_id),
    person_id       UUID REFERENCES persons(person_id),
    role_name       VARCHAR(255),  -- Character name
    billing_order   INTEGER,       -- 1 = lead, 2 = supporting, etc.
    PRIMARY KEY (movie_id, person_id)
);

CREATE TABLE movie_crew (
    movie_id        UUID REFERENCES movies(movie_id),
    person_id       UUID REFERENCES persons(person_id),
    role            VARCHAR(100),  -- 'Director', 'Producer', 'Writer'
    PRIMARY KEY (movie_id, person_id, role)
);
```

---

### Database Partitioning Strategy (For Scale)

```sql
-- Partition shows table by month for better performance
CREATE TABLE shows (
    show_id         UUID NOT NULL,
    movie_id        UUID NOT NULL,
    theatre_id      UUID NOT NULL,
    screen_id       UUID NOT NULL,
    start_time      TIMESTAMPTZ NOT NULL,
    price           DECIMAL(10,2) NOT NULL,
    status          VARCHAR(20) DEFAULT 'AVAILABLE',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (show_id, start_time)
) PARTITION BY RANGE (start_time);

-- Create partitions
CREATE TABLE shows_2025_01 PARTITION OF shows
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE shows_2025_02 PARTITION OF shows
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

-- Automatic partition creation (use pg_partman extension)
```

---

## Redis Key Design

### Key Patterns

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           REDIS KEY PATTERNS                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. SEAT LOCKS (Core functionality)                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Key:    seat_lock:{showId}:{seatId}                                 │    │
│  │ Value:  {userId}:{holdId}                                           │    │
│  │ TTL:    300 seconds (5 minutes)                                     │    │
│  │                                                                     │    │
│  │ Example:                                                            │    │
│  │ Key:    seat_lock:show_123:A1                                       │    │
│  │ Value:  user_456:hold_789                                           │    │
│  │ TTL:    300                                                         │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  2. HOLD METADATA                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Key:    hold:{holdId}                                               │    │
│  │ Value:  JSON string with hold details                               │    │
│  │ TTL:    300 seconds                                                 │    │
│  │                                                                     │    │
│  │ Example:                                                            │    │
│  │ Key:    hold:789e8400-e29b-41d4-a716-446655440001                    │    │
│  │ Value:  {"holdId":"...","showId":"...","seatIds":["A1","A2"],...}   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  3. SESSION CACHE                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Key:    session:{sessionId}                                         │    │
│  │ Value:  JSON string with user session                               │    │
│  │ TTL:    86400 seconds (24 hours)                                    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  4. API RESPONSE CACHE                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Key:    cache:movies:recommended                                    │    │
│  │ Value:  JSON response                                               │    │
│  │ TTL:    300 seconds                                                 │    │
│  │                                                                     │    │
│  │ Key:    cache:shows:{movieId}:{date}                                │    │
│  │ Value:  JSON response                                               │    │
│  │ TTL:    60 seconds                                                  │    │
│  │                                                                     │    │
│  │ Key:    cache:seatmap:{showId}                                      │    │
│  │ Value:  JSON response                                               │    │
│  │ TTL:    10 seconds (short, seats change frequently)                 │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  5. RATE LIMITING                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Key:    ratelimit:{userId}:{endpoint}                               │    │
│  │ Value:  Counter                                                     │    │
│  │ TTL:    60 seconds (sliding window)                                 │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Lua Scripts for Atomic Operations

#### 1. Lock Multiple Seats Atomically

```lua
-- KEYS: seat IDs to lock (e.g., "A1", "A2", "A3")
-- ARGV[1]: showId
-- ARGV[2]: userId
-- ARGV[3]: holdId
-- ARGV[4]: TTL in seconds

local showId = ARGV[1]
local userId = ARGV[2]
local holdId = ARGV[3]
local ttl = tonumber(ARGV[4])

-- Phase 1: Validate all seats are available
for i, seatId in ipairs(KEYS) do
    local key = "seat_lock:" .. showId .. ":" .. seatId
    local existing = redis.call('GET', key)

    if existing then
        -- Parse existing lock: "userId:holdId"
        local existingUserId = string.match(existing, "^([^:]+)")

        -- If different user owns the lock, reject
        if existingUserId ~= userId then
            return cjson.encode({
                success = false,
                error = "SEAT_TAKEN",
                seat = seatId,
                message = "Seat " .. seatId .. " is already taken"
            })
        end
    end
end

-- Phase 2: Atomically lock all seats
local lockValue = userId .. ":" .. holdId

for i, seatId in ipairs(KEYS) do
    local key = "seat_lock:" .. showId .. ":" .. seatId
    redis.call('SET', key, lockValue, 'EX', ttl)
end

return cjson.encode({
    success = true,
    holdId = holdId,
    seats = KEYS,
    expiresIn = ttl
})
```

#### 2. Release Seats

```lua
-- KEYS: seat IDs to release
-- ARGV[1]: showId
-- ARGV[2]: userId (must match to release)

local showId = ARGV[1]
local userId = ARGV[2]
local released = {}

for i, seatId in ipairs(KEYS) do
    local key = "seat_lock:" .. showId .. ":" .. seatId
    local existing = redis.call('GET', key)

    if existing then
        local existingUserId = string.match(existing, "^([^:]+)")

        -- Only release if user owns the lock
        if existingUserId == userId then
            redis.call('DEL', key)
            table.insert(released, seatId)
        end
    end
end

return cjson.encode({
    success = true,
    released = released
})
```

---

## API Specifications

### API Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API ENDPOINTS                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PUBLIC ENDPOINTS (No Auth Required)                                        │
│  ────────────────────────────────────                                       │
│  GET  /api/v1/movies                    List movies                         │
│  GET  /api/v1/movies/{movieId}          Get movie details                   │
│  GET  /api/v1/movies/{movieId}/availability   Get available dates           │
│  GET  /api/v1/movies/{movieId}/shows    Get shows for a date                │
│  GET  /api/v1/shows/{showId}/seatmap    Get seat layout                     │
│  GET  /api/health                       Health check                        │
│                                                                             │
│  PROTECTED ENDPOINTS (Auth Required)                                        │
│  ────────────────────────────────────                                       │
│  POST /api/v1/holds                     Create seat hold                    │
│  GET  /api/v1/holds/{holdId}            Get hold status                     │
│  PATCH /api/v1/holds/{holdId}           Update hold (change seats)          │
│  POST /api/v1/holds/{holdId}/release    Release hold                        │
│  POST /api/v1/orders                    Create order from hold              │
│  GET  /api/v1/orders/{orderId}          Get order details                   │
│  POST /api/v1/orders/{orderId}/confirm-payment   Confirm payment            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Detailed API Specifications

---

#### 1. GET /api/v1/movies

**Purpose:** List movies (recommended/trending)

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| category | string | No | recommended | `recommended` or `trending` |
| limit | integer | No | 20 | Max 50 |
| cursor | string | No | - | Pagination cursor |

**Response (200 OK):**
```json
{
  "items": [
    {
      "movieId": "550e8400-e29b-41d4-a716-446655440001",
      "title": "Avatar: Fire and Ash",
      "thumbnailUrl": "https://...",
      "rating": 8.7,
      "genres": ["Action", "Sci-Fi"],
      "durationMins": 192
    }
  ],
  "nextCursor": "eyJvZmZzZXQiOjIwfQ=="
}
```

**Database Query:**
```sql
SELECT movie_id, title, thumbnail_url, rating, genres, duration_mins
FROM movies
WHERE is_active = true
  AND release_date <= CURRENT_DATE
ORDER BY
  CASE WHEN :category = 'trending' THEN rating END DESC,
  CASE WHEN :category = 'recommended' THEN release_date END DESC
LIMIT :limit
OFFSET :offset;
```

**Caching:**
- Redis key: `cache:movies:{category}`
- TTL: 5 minutes

---

#### 2. GET /api/v1/movies/{movieId}

**Purpose:** Get movie details with cast & crew

**Response (200 OK):**
```json
{
  "movieId": "550e8400-e29b-41d4-a716-446655440001",
  "title": "Avatar: Fire and Ash",
  "about": "The epic continuation...",
  "thumbnailUrl": "https://...",
  "bannerUrl": "https://...",
  "rating": 8.7,
  "durationMins": 192,
  "ageRating": "UA",
  "releaseDate": "2025-12-17",
  "language": "English",
  "format": "2D",
  "genres": ["Action", "Adventure", "Sci-Fi"],
  "cast": [
    {
      "name": "Sam Worthington",
      "role": "Jake Sully",
      "imageUrl": "https://..."
    }
  ],
  "crew": [
    {
      "name": "James Cameron",
      "role": "Director",
      "imageUrl": "https://..."
    }
  ]
}
```

**Database Query:**
```sql
SELECT m.*,
       json_agg(DISTINCT jsonb_build_object(
         'name', pc.name, 'role', mc.role_name, 'imageUrl', pc.image_url
       )) as cast,
       json_agg(DISTINCT jsonb_build_object(
         'name', pw.name, 'role', mw.role, 'imageUrl', pw.image_url
       )) as crew
FROM movies m
LEFT JOIN movie_cast mc ON m.movie_id = mc.movie_id
LEFT JOIN persons pc ON mc.person_id = pc.person_id
LEFT JOIN movie_crew mw ON m.movie_id = mw.movie_id
LEFT JOIN persons pw ON mw.person_id = pw.person_id
WHERE m.movie_id = :movieId
GROUP BY m.movie_id;
```

---

#### 3. GET /api/v1/movies/{movieId}/availability

**Purpose:** Get dates when movie has shows (for date picker)

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| from | string | Yes | Start date (YYYY-MM-DD) |
| to | string | Yes | End date (YYYY-MM-DD) |

**Response (200 OK):**
```json
{
  "movieId": "550e8400-...",
  "availableDates": [
    "2025-12-17",
    "2025-12-18",
    "2025-12-19",
    "2025-12-20"
  ]
}
```

**Database Query:**
```sql
SELECT DISTINCT DATE(start_time) as show_date
FROM shows
WHERE movie_id = :movieId
  AND start_time >= :from
  AND start_time < :to + INTERVAL '1 day'
  AND status != 'CANCELLED'
ORDER BY show_date;
```

---

#### 4. GET /api/v1/movies/{movieId}/shows

**Purpose:** Get shows grouped by theatre for a specific date

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| date | string | Yes | Date (YYYY-MM-DD) |

**Response (200 OK):**
```json
{
  "movieId": "550e8400-...",
  "date": "2025-12-17",
  "theatres": [
    {
      "theatreId": "660e8400-...",
      "name": "PVR Orion Mall",
      "address": "Orion Mall, Bangalore",
      "geo": { "lat": 12.9914, "lng": 77.5573 },
      "cancellationAvailable": true,
      "shows": [
        {
          "showId": "770e8400-...",
          "startTime": "2025-12-17T10:30:00+05:30",
          "price": 280,
          "status": "AVAILABLE"
        },
        {
          "showId": "770e8401-...",
          "startTime": "2025-12-17T14:00:00+05:30",
          "price": 280,
          "status": "FILLING_FAST"
        }
      ]
    }
  ]
}
```

**Database Query:**
```sql
SELECT
  t.theatre_id, t.name, t.address, t.geo_lat, t.geo_lng, t.cancellation_available,
  s.show_id, s.start_time, s.price, s.status
FROM shows s
JOIN theatres t ON s.theatre_id = t.theatre_id
WHERE s.movie_id = :movieId
  AND DATE(s.start_time) = :date
  AND s.status != 'CANCELLED'
ORDER BY t.name, s.start_time;
```

---

#### 5. GET /api/v1/shows/{showId}/seatmap

**Purpose:** Get seat layout with availability status

**Response (200 OK):**
```json
{
  "showId": "770e8400-...",
  "theatreId": "660e8400-...",
  "screenName": "Screen 1",
  "price": 280,
  "layout": {
    "rows": [
      { "rowLabel": "A", "seats": ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"] },
      { "rowLabel": "B", "seats": ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8"] },
      { "rowLabel": "C", "seats": ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"] },
      { "rowLabel": "D", "seats": ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8"] },
      { "rowLabel": "E", "seats": ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"] }
    ]
  },
  "unavailableSeatIds": ["A4", "C6"],
  "heldSeatIds": ["B2", "B3"]
}
```

**Data Sources:**
1. **Layout:** From PostgreSQL `seat_layouts` table
2. **Unavailable (Confirmed):** From PostgreSQL `orders` WHERE status = 'CONFIRMED'
3. **Held:** From Redis `seat_lock:{showId}:*` keys

**Caching:**
- Redis key: `cache:seatmap:{showId}`
- TTL: 10 seconds (short due to frequent changes)

---

#### 6. POST /api/v1/holds (Auth Required)

**Purpose:** Create a temporary seat hold (5 min TTL)

**Request Body:**
```json
{
  "showId": "770e8400-...",
  "seatIds": ["A1", "A2"],
  "quantity": 2
}
```

**Validation:**
- `seatIds.length` must equal `quantity`
- All seats must exist in layout
- No seats can be already held or confirmed

**Success Response (201 Created):**
```json
{
  "holdId": "880e8400-...",
  "showId": "770e8400-...",
  "seatIds": ["A1", "A2"],
  "status": "HELD",
  "expiresAt": "2025-12-17T14:05:00Z"
}
```

**Error Response (409 Conflict):**
```json
{
  "error": {
    "message": "Seats already taken: A1, A2",
    "code": "SEATS_UNAVAILABLE"
  }
}
```

**Process Flow:**
```
1. Validate request
2. Check if user has existing hold for this show → Release it
3. Execute Redis Lua script to atomically lock all seats
4. If any seat taken → Return 409
5. Store hold metadata in Redis with TTL
6. Return hold details
```

---

#### 7. POST /api/v1/orders (Auth Required)

**Purpose:** Create order from hold, transition to payment

**Request Body:**
```json
{
  "holdId": "880e8400-...",
  "customer": {
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "9876543210"
  }
}
```

**Success Response (201 Created):**
```json
{
  "orderId": "990e8400-...",
  "status": "PAYMENT_PENDING",
  "movie": {
    "movieId": "550e8400-...",
    "title": "Avatar: Fire and Ash"
  },
  "theatre": {
    "theatreId": "660e8400-...",
    "name": "PVR Orion Mall"
  },
  "show": {
    "showId": "770e8400-...",
    "startTime": "2025-12-17T14:00:00+05:30"
  },
  "seats": ["A1", "A2"],
  "amount": 560,
  "expiresAt": "2025-12-17T14:10:00Z"
}
```

**Process Flow:**
```
1. Validate hold exists and belongs to user
2. Validate hold status is "HELD" (not expired)
3. Create order record in PostgreSQL
4. Send "order.created" event to SQS
5. Return order details
```

---

#### 8. POST /api/v1/orders/{orderId}/confirm-payment (Auth Required)

**Purpose:** Mock payment confirmation, finalize booking

**Success Response (200 OK):**
```json
{
  "orderId": "990e8400-...",
  "status": "CONFIRMED",
  "ticketCode": "BMS-ABC123",
  "movie": { ... },
  "theatre": { ... },
  "show": { ... },
  "seats": ["A1", "A2"],
  "amount": 560
}
```

**Process Flow:**
```
1. Validate order exists and belongs to user
2. Validate order status is "PAYMENT_PENDING"
3. Validate order not expired
4. Update order status to "CONFIRMED"
5. Generate ticket code
6. Send "order.confirmed" event to SQS
7. Return confirmed order
```

---

## Data Flow Diagrams

### Seat Booking Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         COMPLETE BOOKING FLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User                 API                  Redis              PostgreSQL    │
│   │                    │                     │                    │         │
│   │──GET /seatmap─────▶│                     │                    │         │
│   │                    │──GET seat_lock:*───▶│                    │         │
│   │                    │◀──locked seats──────│                    │         │
│   │                    │────────────────────GET confirmed seats──▶│         │
│   │                    │◀──────────────────────confirmed seats────│         │
│   │◀──seatmap + status─│                     │                    │         │
│   │                    │                     │                    │         │
│   │  (User selects A1, A2)                   │                    │         │
│   │                    │                     │                    │         │
│   │──POST /holds──────▶│                     │                    │         │
│   │  {seatIds:[A1,A2]} │                     │                    │         │
│   │                    │──EVAL lock_script──▶│                    │         │
│   │                    │  (atomic check+lock)│                    │         │
│   │                    │◀──{success:true}────│                    │         │
│   │                    │──SET hold:{id}─────▶│                    │         │
│   │◀──{holdId,expires}─│                     │                    │         │
│   │                    │                     │                    │         │
│   │  (User enters details)                   │                    │         │
│   │                    │                     │                    │         │
│   │──POST /orders─────▶│                     │                    │         │
│   │  {holdId,customer} │                     │                    │         │
│   │                    │──GET hold:{id}─────▶│                    │         │
│   │                    │◀──hold data─────────│                    │         │
│   │                    │───────────────────INSERT order──────────▶│         │
│   │                    │◀─────────────────────order created───────│         │
│   │                    │──────────SQS: order.created─────────────▶│         │
│   │◀──{orderId}────────│                     │                    │         │
│   │                    │                     │                    │         │
│   │──POST /confirm────▶│                     │                    │         │
│   │                    │───────────────────UPDATE order status───▶│         │
│   │                    │◀─────────────────────order confirmed─────│         │
│   │                    │──────────SQS: order.confirmed───────────▶│         │
│   │◀──{ticketCode}─────│                     │                    │         │
│   │                    │                     │                    │         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Seat Lock Conflict Handling

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      CONCURRENT BOOKING SCENARIO                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User A              User B               Redis                             │
│    │                   │                    │                               │
│    │ (Both view seatmap, see A1 available) │                               │
│    │                   │                    │                               │
│    │──POST /holds {A1}────────────────────▶│ (User A first)                │
│    │                   │                    │──Check: A1 available          │
│    │                   │                    │──Lock: seat_lock:show:A1=A   │
│    │◀──{holdId:X}──────│                    │                               │
│    │                   │                    │                               │
│    │                   │──POST /holds {A1}─▶│ (User B second, 100ms later) │
│    │                   │                    │──Check: A1 LOCKED by A       │
│    │                   │◀──409 Conflict─────│                               │
│    │                   │   "A1 already      │                               │
│    │                   │    taken"          │                               │
│    │                   │                    │                               │
│    │  (User A continues to payment)        │                               │
│    │  (User B selects different seat)      │                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Scaling Considerations

### Request Volume Estimates

| Scenario | Requests/sec | Peak Events |
|----------|--------------|-------------|
| Normal day | 100-500 | - |
| Weekend | 500-2000 | - |
| New release (first hour) | 5000-10000 | Blockbuster opening |
| Flash sale | 50000+ | IPL final, Coldplay concert |

### Scaling Strategy by Component

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SCALING STRATEGY                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Component          Normal         Peak           Flash Sale                │
│  ─────────────────────────────────────────────────────────────              │
│                                                                             │
│  ECS Tasks          2              10             50+                       │
│  (Auto-scaling based on CPU/Memory)                                         │
│                                                                             │
│  Redis              cache.t3.micro cache.r6g.large  cache.r6g.xlarge       │
│  (Single node)      (Free tier)    (Production)     (+ read replicas)       │
│                                                                             │
│  PostgreSQL         db.t3.micro    db.r6g.large     db.r6g.xlarge          │
│  (RDS)              (Free tier)    (+ 2 read        (+ 5 read replicas)     │
│                                     replicas)                               │
│                                                                             │
│  API Gateway        Built-in       Built-in         + WAF + Rate limiting  │
│  throttling         throttling     throttling       + Virtual waiting room  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Auto-Scaling Configuration

```yaml
# ECS Service Auto-Scaling
MinCapacity: 2
MaxCapacity: 50
TargetCPUUtilization: 70%
ScaleOutCooldown: 60 seconds
ScaleInCooldown: 300 seconds

# Scaling Triggers:
# - CPU > 70% for 2 minutes → Add 2 tasks
# - CPU < 30% for 10 minutes → Remove 1 task
# - Request count > 1000/min → Add 1 task
```

### Read/Write Split

```
┌─────────────────────────────────────────────────────────────────┐
│                    READ/WRITE DISTRIBUTION                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  WRITES (10% of traffic) ──────▶ Primary PostgreSQL             │
│  - Create order                                                 │
│  - Confirm payment                                              │
│  - Update order status                                          │
│                                                                 │
│  READS (90% of traffic) ───────▶ Read Replicas / Redis Cache    │
│  - List movies (cached)                                         │
│  - Movie details (cached)                                       │
│  - Show listings (cached)                                       │
│  - Seat availability (Redis + short cache)                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Summary

This document covers:

1. **Database Schema** - 7 tables optimized for the booking flow
2. **Redis Design** - Key patterns and Lua scripts for atomic seat locking
3. **API Specifications** - 10 endpoints with request/response formats
4. **Data Flows** - Visual diagrams showing booking and conflict handling
5. **Scaling Strategy** - From free tier to handling millions of users

When you're ready to implement, start with:
1. Set up PostgreSQL and run the schema
2. Set up Redis
3. Implement the Lua scripts for seat locking
4. Build the APIs one by one
5. Add caching layer
6. Deploy to ECS and test under load
