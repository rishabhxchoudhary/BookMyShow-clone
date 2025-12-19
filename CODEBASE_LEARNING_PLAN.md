# BookMyShow Clone - Complete Codebase Learning Guide

> **Purpose**: This document provides a comprehensive file-by-file breakdown of the entire codebase with exact line references. Use this to quickly locate any feature when asked in an interview.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Backend Lambda Handlers](#backend-lambda-handlers)
3. [Backend Services](#backend-services)
4. [Next.js API Routes (BFF Layer)](#nextjs-api-routes-bff-layer)
5. [Frontend Pages & Components](#frontend-pages--components)
6. [Data Models & Schemas](#data-models--schemas)
7. [Infrastructure Configuration](#infrastructure-configuration)
8. [Common Interview Questions - Quick Reference](#common-interview-questions---quick-reference)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND (Next.js)                              │
│   src/app/page.tsx → src/app/movies/[movieId]/page.tsx                   │
│   → src/app/movies/[movieId]/buytickets/[date]/page.tsx                  │
│   → src/app/seat-layout/.../page.tsx → src/app/order-summary/.../page.tsx│
└────────────────────────────────┬─────────────────────────────────────────┘
                                 │ HTTP Requests
                                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    NEXT.JS API ROUTES (BFF Layer)                        │
│   src/app/api/v1/movies/route.ts    │ src/app/api/v1/holds/route.ts     │
│   src/app/api/v1/orders/route.ts    │ src/app/api/v1/shows/.../route.ts │
└────────────────────────────────┬─────────────────────────────────────────┘
                                 │ HTTP (Forward to Lambda)
                                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                    AWS API GATEWAY + LAMBDA (Python)                      │
│   bms-lambda/src/handlers/movies.py  │ bms-lambda/src/handlers/holds.py │
│   bms-lambda/src/handlers/orders.py  │ bms-lambda/src/handlers/seats.py │
└────────────────────────────────┬─────────────────────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
┌─────────────────────┐ ┌────────────────┐ ┌────────────────────┐
│   PostgreSQL (RDS)  │ │ Redis (Cache)  │ │  SQS (Events)      │
│   - movies          │ │ - seat_lock:*  │ │  - order.created   │
│   - theatres        │ │ - hold:*       │ │  - order.confirmed │
│   - shows           │ │ - seatmap:*    │ │  - hold.created    │
│   - orders          │ │ - ratelimit:*  │ │  - hold.released   │
└─────────────────────┘ └────────────────┘ └────────────────────┘
```

---

## Backend Lambda Handlers

### 1. Movies Handler
**File**: `bms-lambda/src/handlers/movies.py`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| Lambda entry point | `12-42` | `lambda_handler()` - Routes requests based on HTTP method and path |
| Request routing | `29-38` | Routes to `get_movies()`, `get_movie_shows()`, or `get_movie_details()` |
| Get movies list | `44-78` | `get_movies()` - Paginated movie list with Redis caching |
| **Database query for movies** | `55` | `db_service.get_movies(limit=limit, offset=offset)` |
| **Cache movie list** | `68-72` | `redis_service._client.setex(cache_key, 300, ...)` - 5 min cache |
| Get movie details | `80-112` | `get_movie_details()` - Single movie with 1hr cache |
| **Cache check** | `89` | `cached_movie = redis_service._client.get(cache_key)` |
| **Database fetch movie** | `96` | `movie = db_service.get_movie_by_id(movie_id)` |
| Get movie shows | `114-188` | `get_movie_shows()` - Shows grouped by theatre |
| **Date validation** | `126-127` | Uses `BMSValidator.validate_date_format(date)` |
| **Database query for shows** | `141` | `db_service.get_shows_by_movie_and_date(movie_id, date)` |
| **Group shows by theatre** | `144-166` | Creates theatre-based structure with geo coordinates |
| Success response helper | `190-201` | `create_success_response()` - CORS headers included |
| Error response helper | `203-217` | `create_error_response()` - Standardized error format |

---

### 2. Holds Handler (CRITICAL - Seat Locking Logic)
**File**: `bms-lambda/src/handlers/holds.py`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| Lambda entry point | `15-48` | `lambda_handler()` - Routes hold requests |
| **User ID extraction** | `32` | `user_id = headers.get('x-user-id', 'test-user-123')` |
| Request routing | `35-44` | Routes to `create_hold()`, `get_hold()`, or `release_hold()` |
| **CREATE HOLD** | `50-190` | `create_hold()` - Main seat reservation logic |
| Parse request body | `54-60` | JSON parsing with error handling |
| **Validate hold request** | `64-66` | `BMSValidator.validate_hold_request(request_data)` |
| Extract seat data | `68-69` | `show_id`, `seat_ids`, `quantity` extraction |
| **Validate show exists** | `77-79` | `show = db_service.get_show_by_id(show_id)` |
| **Check show hasn't started** | `82-84` | Compares `show_time` with current UTC time |
| Get unavailable seats | `87` | `permanently_unavailable = get_permanently_unavailable_seats(show_id)` |
| **Get confirmed seats from DB** | `90` | `confirmed_seats = db_service.get_confirmed_seats_for_show(show_id)` |
| Combine unavailable seats | `93` | `all_unavailable = set(permanently_unavailable + confirmed_seats)` |
| **Check seat availability** | `96-102` | Rejects if any requested seat is unavailable |
| Generate hold ID | `105` | `hold_id = str(uuid.uuid4())` |
| **ATOMIC SEAT LOCKING** | `108` | `redis_service.lock_seats_atomic(show_id, user_id, seat_ids, hold_id)` |
| Handle lock failure | `110-123` | Returns 409 if seat taken |
| Prepare hold data | `126-138` | Creates hold object with expiration time |
| **Store hold in Redis** | `141` | `redis_service.store_hold(hold_data)` |
| **Compensation on failure** | `144` | `redis_service.release_seats_atomic()` if storage fails |
| Clear cache | `148` | `redis_service._client.delete(f"seatmap:{show_id}")` |
| **Send SQS event** | `162` | `sqs_service.send_hold_created_event(event_data)` |
| **GET HOLD** | `192-230` | `get_hold()` - Retrieve hold with expiration check |
| **Check expiration** | `209-212` | Calculates if hold is expired, returns `EXPIRED` status |
| **RELEASE HOLD** | `232-311` | `release_hold()` - Manual hold release |
| **Atomic seat release** | `261` | `redis_service.release_seats_atomic(show_id, user_id, seat_ids)` |
| Update hold status | `271-272` | Sets status to `RELEASED` |
| Permanently unavailable seats | `313-317` | `get_permanently_unavailable_seats()` - Returns `["A5", "B10", "C15"]` |

---

### 3. Orders Handler (CRITICAL - Booking Finalization)
**File**: `bms-lambda/src/handlers/orders.py`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| Lambda entry point | `15-48` | `lambda_handler()` - Routes order requests |
| Request routing | `35-44` | Routes to `create_order()`, `confirm_payment()`, or `get_order()` |
| **CREATE ORDER** | `50-203` | `create_order()` - Convert hold to order |
| **Validate order request** | `64-66` | `BMSValidator.validate_order_request(request_data)` |
| **Get hold from Redis** | `72` | `hold_data = redis_service.get_hold(hold_id)` |
| Verify hold ownership | `77-78` | Checks `hold_data.get('user_id') != user_id` |
| Check hold status | `81-82` | Must be `HELD` status |
| **Check hold expiration** | `85-87` | Validates hold hasn't expired |
| Get show details | `91` | `show = db_service.get_show_by_id(show_id)` |
| **RACE CONDITION CHECK** | `96-101` | Double-checks seats aren't already confirmed |
| Calculate amount | `104-106` | `total_amount = seat_count * price_per_seat` |
| Generate order ID | `109` | `order_id = str(uuid.uuid4())` |
| Prepare order data | `115-127` | Creates order object with `PAYMENT_PENDING` status |
| **INSERT ORDER INTO DB** | `132` | `db_service.create_order(order_data)` |
| **Delete hold from Redis** | `142` | `redis_service.delete_hold(hold_id)` |
| Clear seat cache | `148` | `redis_service._client.delete(f"seatmap:{show_id}")` |
| **Send SQS event** | `163` | `sqs_service.send_order_created_event(event_data)` |
| **Compensation on failure** | `195` | `redis_service.store_hold(hold_data)` restores hold |
| **GET ORDER** | `205-255` | `get_order()` - Retrieve order details |
| **Database query** | `213` | `order = db_service.get_order_by_id(order_id)` |
| **CONFIRM PAYMENT** | `257-339` | `confirm_payment()` - Finalize booking |
| Validate order status | `274-275` | Must be `PAYMENT_PENDING` |
| Check expiration | `278-280` | Order must not be expired |
| **Generate ticket code** | `283` | `ticket_code = f"BMS{order_id[:8].upper()}"` |
| **UPDATE ORDER IN DB** | `286` | `db_service.confirm_order_payment(order_id, ticket_code)` |
| **Release seat locks** | `294` | `redis_service.release_seats_atomic()` - Seats now permanent |
| Clear cache | `297` | `redis_service._client.delete(f"seatmap:{show_id}")` |
| **Send SQS event** | `317` | `sqs_service.send_order_confirmed_event(event_data)` |

---

### 4. Seats Handler (Seatmap)
**File**: `bms-lambda/src/handlers/seats.py`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| Lambda entry point | `12-35` | `lambda_handler()` - Only handles seatmap endpoint |
| **GET SEATMAP** | `37-88` | `get_seatmap()` - Returns seat availability |
| **Check Redis cache** | `45-48` | `redis_service.get_cached_seat_availability(show_id)` |
| Get show from DB | `51` | `show = db_service.get_show_by_id(show_id)` |
| Get seat layout | `56` | `get_seat_layout_for_theatre(show.get('theatre_id'))` |
| **Get confirmed seats** | `59` | `db_service.get_confirmed_seats_for_show(show_id)` |
| **Get locked (held) seats** | `62` | `redis_service.get_locked_seats_for_show(show_id)` |
| Get permanently unavailable | `65` | `get_permanently_unavailable_seats(show_id)` |
| Build seatmap response | `70-79` | Combines all availability data |
| **Cache result** | `82` | `redis_service.cache_seat_availability(show_id, seatmap_data, ttl=10)` |
| Generate seat layout | `90-106` | `get_seat_layout_for_theatre()` - Creates rows A-J, 10 seats each |
| **Seat generation loop** | `97-104` | Creates seat objects with `seatId`, `row`, `number`, `type` |

---

### 5. Shows Generator
**File**: `bms-lambda/src/handlers/shows_generator.py`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| Show time slots | `84-90` | `SHOW_TIMES` - 10:00 AM, 1:30 PM, 4:45 PM, 7:15 PM, 10:00 PM |
| Price mapping | `97-103` | `PRICE_MAPPING` - Morning cheaper, prime time expensive |
| Show status distribution | `106-110` | 70% active, 20% filling_fast, 10% almost_full |
| **Generate shows data** | `129-256` | `generate_shows_data()` - Main generation logic |
| Fetch movies from DB | `137` | `"SELECT movie_id, title, duration_mins FROM movies"` |
| Fetch theatres from DB | `138-142` | Selects theatre details |
| **Clear existing shows** | `164` | `"DELETE FROM shows WHERE DATE(start_time) >= %s"` |
| **Generate shows loop** | `176-207` | Nested loop: days → movies → theatres → times |
| Theatre selection | `185-189` | Each movie gets shows in 60-80% of theatres |
| **INSERT SHOWS** | `212-216` | `INSERT INTO shows (show_id, movie_id, theatre_id, start_time, price, status)` |
| Lambda handler | `258-293` | `lambda_handler()` - Entry point with days parameter |

---

## Backend Services

### 1. Database Service
**File**: `bms-lambda/src/services/db_service.py`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| Singleton pattern | `17-24` | `__new__()` - Single instance |
| **Connection pool init** | `26-43` | `_initialize_pool()` - ThreadedConnectionPool with 1-5 connections |
| Context manager | `45-62` | `get_connection()` - Safe connection handling |
| **Execute SELECT** | `64-70` | `execute_query()` - Returns list of dicts |
| **Execute INSERT/UPDATE** | `72-78` | `execute_update()` - Returns rowcount |
| Transaction support | `80-92` | `execute_transaction()` - Multiple ops with rollback |
| **Get movies** | `95-103` | `get_movies()` - `SELECT movie_id, title, thumbnail_url...` |
| **Get movie by ID** | `105-111` | `get_movie_by_id()` - `SELECT * FROM movies WHERE movie_id = %s` |
| **Get shows by movie & date** | `113-126` | `get_shows_by_movie_and_date()` - JOIN shows, theatres |
| **Get show by ID** | `128-152` | `get_show_by_id()` - JOIN shows, theatres, movies |
| **Get confirmed seats** | `155-166` | `get_confirmed_seats_for_show()` - `SELECT seat_ids FROM orders WHERE status='CONFIRMED'` |
| **Create order** | `168-187` | `create_order()` - `INSERT INTO orders (...) RETURNING order_id` |
| **Get order by ID** | `189-201` | `get_order_by_id()` - Full JOIN with shows, movies, theatres |
| **Confirm payment** | `203-212` | `confirm_order_payment()` - `UPDATE orders SET status='CONFIRMED'` |
| Global instance | `215` | `db_service = DatabaseService()` |

---

### 2. Redis Service (CRITICAL - Seat Locking)
**File**: `bms-lambda/src/services/redis_service.py`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| Singleton pattern | `17-21` | `__new__()` - Single instance |
| **Client initialization** | `23-42` | `_initialize_client()` - SSL, timeouts, retry |
| **LUA SCRIPT - LOCK SEATS** | `53-93` | `LOCK_SEATS_SCRIPT` - Atomic seat locking |
| Phase 1: Check availability | `60-77` | Checks all seats before locking any |
| **Existing lock check** | `64-76` | Parses `userId:holdId` format, rejects if different user |
| Phase 2: Lock all seats | `80-85` | `SET key lockValue EX ttl` for each seat |
| **LUA SCRIPT - RELEASE SEATS** | `96-120` | `RELEASE_SEATS_SCRIPT` - Atomic seat release |
| Ownership check on release | `106-110` | Only releases if user owns the lock |
| **lock_seats_atomic()** | `122-143` | Python wrapper for lock script |
| **Script execution** | `129` | `self._client.eval(self.LOCK_SEATS_SCRIPT, len(keys), *(keys + args))` |
| **release_seats_atomic()** | `145-164` | Python wrapper for release script |
| **Get locked seats** | `166-182` | `get_locked_seats_for_show()` - Uses KEYS pattern `seat_lock:{showId}:*` |
| **Store hold** | `184-194` | `store_hold()` - `setex(key, HOLD_TTL_SECONDS, value)` |
| **Get hold** | `196-208` | `get_hold()` - Retrieves hold JSON |
| **Delete hold** | `210-219` | `delete_hold()` - Removes hold key |
| **Cache seat availability** | `221-231` | `cache_seat_availability()` - 10 sec TTL |
| **Get cached availability** | `233-245` | `get_cached_seat_availability()` |
| Rate limiting | `247-260` | `set_rate_limit()` - INCR with EXPIRE |
| Global instance | `281` | `redis_service = RedisService()` |

**Redis Key Patterns:**
- `seat_lock:{showId}:{seatId}` → `{userId}:{holdId}` (locked seat)
- `hold:{holdId}` → JSON hold data
- `seatmap:{showId}` → Cached seatmap JSON
- `ratelimit:{userId}:{endpoint}` → Request count

---

### 3. SQS Service
**File**: `bms-lambda/src/services/sqs_service.py`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| Client initialization | `14-16` | `boto3.client('sqs', region_name=...)` |
| **Send event** | `18-51` | `send_event()` - Generic event sender |
| Message structure | `21-25` | `{eventType, timestamp, data}` |
| **SQS send_message** | `27-36` | `self.sqs.send_message(QueueUrl, MessageBody, MessageAttributes)` |
| Order created event | `53-55` | `send_order_created_event()` → `'order.created'` |
| Order confirmed event | `57-59` | `send_order_confirmed_event()` → `'order.confirmed'` |
| Hold created event | `61-63` | `send_hold_created_event()` → `'hold.created'` |
| Hold released event | `65-67` | `send_hold_released_event()` → `'hold.released'` |
| Hold expired event | `69-71` | `send_hold_expired_event()` → `'hold.expired'` |
| Show sold out event | `73-75` | `send_show_sold_out_event()` → `'show.sold_out'` |

---

### 4. Configuration
**File**: `bms-lambda/src/utils/config.py`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| **Database URL parsing** | `8-21` | Parses `DATABASE_URL` or individual env vars |
| **Redis URL parsing** | `25-37` | Parses `REDIS_URL` or individual env vars |
| SQS configuration | `40` | `SQS_QUEUE_URL` |
| **Hold TTL** | `43` | `HOLD_TTL_SECONDS = 300` (5 minutes) |
| **Order TTL** | `44` | `ORDER_TTL_SECONDS = 300` (5 minutes) |
| **Max seats** | `45` | `MAX_SEATS_PER_BOOKING = 10` |

---

### 5. Validators
**File**: `bms-lambda/src/utils/validators.py`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| **UUID validation** | `13-16` | `validate_uuid()` - UUID4 pattern |
| **Email validation** | `19-22` | `validate_email()` - Standard email pattern |
| **Phone validation** | `25-28` | `validate_phone()` - Indian mobile format `^[6-9]\d{9}$` |
| **Seat ID validation** | `31-34` | `validate_seat_ids()` - Pattern `^[A-Z]\d{1,2}$` |
| **Hold request validation** | `37-58` | `validate_hold_request()` - Validates showId, seatIds, quantity |
| **Order request validation** | `61-83` | `validate_order_request()` - Validates holdId, customer info |
| **Date format validation** | `86-91` | `validate_date_format()` - YYYY-MM-DD format |

---

## Next.js API Routes (BFF Layer)

### 1. Movies Routes
**File**: `src/app/api/v1/movies/route.ts`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| GET movies | `6-61` | Uses mock data, maps to `MovieCard[]` |
| Schema validation | `10-14` | `movieListQuerySchema.safeParse()` |
| Response formatting | `48-52` | Creates `MovieListResponse` |

**File**: `src/app/api/v1/movies/[movieId]/route.ts`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| GET movie by ID | `4-28` | `getMovieById(movieId)` from mock data |

**File**: `src/app/api/v1/movies/[movieId]/shows/route.ts`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| GET shows | `10-75` | Gets shows grouped by theatre |
| **Date query param** | `26-40` | Validates `date` parameter |
| Group by theatre | `46-59` | Creates `TheatreWithShows` map |

---

### 2. Holds Routes
**File**: `src/app/api/v1/holds/route.ts`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| **Authentication check** | `9-16` | `session = await auth()` |
| Schema validation | `19-31` | `createHoldSchema.safeParse(body)` |
| Seat count validation | `35-43` | `seatIds.length !== quantity` |
| **Forward to Lambda** | `47-58` | `fetch(\`${LAMBDA_HOLDS_URL}/holds\`)` |
| User ID header | `52` | `'x-user-id': session.user.id` |

**File**: `src/app/api/v1/holds/[holdId]/route.ts`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| GET hold | `6-48` | Forwards to Lambda |
| **Forward to Lambda** | `23-29` | `fetch(\`${LAMBDA_HOLDS_URL}/holds/${holdId}\`)` |

---

### 3. Orders Routes
**File**: `src/app/api/v1/orders/route.ts`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| POST create order | `7-65` | Creates order from hold |
| Schema validation | `19-31` | `createOrderSchema.safeParse(body)` |
| **Forward to Lambda** | `36-46` | `fetch(\`${LAMBDA_ORDERS_URL}/orders\`)` |

**File**: `src/app/api/v1/orders/[orderId]/route.ts`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| **Response transformer** | `8-42` | `transformOrderResponse()` - Lambda → Frontend format |
| GET order | `44-89` | Forwards to Lambda, transforms response |

**File**: `src/app/api/v1/orders/[orderId]/confirm-payment/route.ts`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| POST confirm payment | `7-92` | Confirms and fetches updated order |
| **Forward to Lambda** | `24-30` | `fetch(\`${LAMBDA_ORDERS_URL}/orders/${orderId}/confirm-payment\`)` |
| Fetch full order | `42-48` | Gets complete order after confirmation |

---

### 4. Seatmap Route
**File**: `src/app/api/v1/shows/[showId]/seatmap/route.ts`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| GET seatmap | `5-38` | Forwards directly to Lambda seats service |
| **Forward to Lambda** | `14-19` | `fetch(\`${LAMBDA_SEATS_URL}/shows/${showId}/seatmap\`)` |

---

## Frontend Pages & Components

### 1. Home Page
**File**: `src/app/page.tsx`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| **Fetch movies** | `5-29` | `getMovies()` - Calls `bmsAPI.getMovies()` |
| Transform response | `10-22` | Maps Lambda response to frontend types |
| Render movie grid | `75-79` | Maps to `<MovieCard>` components |

---

### 2. Movie Details Page
**File**: `src/app/movies/[movieId]/page.tsx`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| **Fetch movie** | `8-33` | `getMovie()` - Calls `bmsAPI.getMovieById()` |
| Duration formatter | `35-39` | `formatDuration()` - "2h 30m" format |
| **Book tickets link** | `126-129` | Links to `/movies/${movieId}/buytickets/${today}` |

---

### 3. Buy Tickets Page (Theatre/Show Selection)
**File**: `src/app/movies/[movieId]/buytickets/[date]/page.tsx`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| **Status mapper** | `8-19` | `mapShowStatus()` - Lambda → frontend status |
| Fetch movie | `21-42` | `getMovie()` |
| Generate availability | `44-58` | `getAvailability()` - Next 7 days |
| **Fetch shows** | `78-108` | `getShows()` - Transforms Lambda response |
| Date selector | `179-212` | Horizontal date picker |
| **Theatre listings** | `225-266` | Shows grouped by theatre with show times |
| **Seat layout link** | `243-246` | Links to `/seat-layout/${movieId}/${theatreId}/${showId}/${date}` |

---

### 4. Seat Selector Component (CRITICAL)
**File**: `src/components/SeatSelectorLambda.tsx`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| Component state | `25-29` | `seatMap`, `selectedSeats`, `loading`, `error`, `hold` |
| **Load seat map** | `32-53` | `loadSeatMap()` - Fetches from `/api/v1/shows/${showId}/seatmap` |
| **Handle seat click** | `55-67` | `handleSeatClick()` - Toggle seat selection |
| Availability check | `59-60` | Skips unavailable and held seats |
| **CREATE HOLD & ORDER** | `69-131` | `handleCreateHold()` - Main booking flow |
| Step 1: Create hold | `80-98` | `POST /api/v1/holds` |
| Step 2: Create order | `103-120` | `POST /api/v1/orders` with customer data |
| Navigate to summary | `123` | `router.push(\`/order-summary/${movieId}/${theatreId}?orderId=${orderData.orderId}\`)` |
| **Get seat status** | `133-140` | `getSeatStatus()` - Returns 'selected', 'unavailable', 'held', 'available' |
| Seat color mapping | `142-149` | `getSeatColor()` - CSS classes for seat states |
| **Seat grid rendering** | `243-264` | Maps seats by row, renders buttons |
| Booking summary | `287-340` | Shows selected seats and total |
| **Pay button** | `323-337` | Triggers `handleCreateHold()` |

---

### 5. Order Summary Page
**File**: `src/app/order-summary/[movieId]/[theatreId]/page.tsx`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| Server component | `4-25` | Extracts params, redirects if no orderId |
| Render client | `18-24` | Passes props to `OrderSummaryClient` |

**File**: `src/app/order-summary/[movieId]/[theatreId]/OrderSummaryClient.tsx`

| Feature | Line Numbers | Description |
|---------|--------------|-------------|
| Component state | `26-30` | `order`, `loading`, `paying`, `error`, `timeLeft` |
| **Fetch order** | `32-56` | Fetches from `/api/v1/orders/${orderId}` |
| **Countdown timer** | `59-75` | Counts down to order expiration |
| Expire order on timeout | `70` | Sets status to `EXPIRED` when time runs out |
| **Payment handler** | `77-101` | `handlePayment()` - `POST /api/v1/orders/${orderId}/confirm-payment` |
| Confirmed state | `178-188` | Shows success message with checkmark |
| Expired state | `190-197` | Shows expiration alert |
| Pending countdown | `199-205` | Shows time remaining |
| **Ticket code display** | `264-270` | Shows `order.ticketCode` on confirmation |
| **Pay button** | `274-289` | Triggers `handlePayment()` |

---

## Data Models & Schemas

### 1. Zod Schemas
**File**: `src/lib/schemas.ts`

| Schema | Line Numbers | Description |
|--------|--------------|-------------|
| **createHoldSchema** | `5-9` | `showId: uuid`, `seatIds: array[1-10]`, `quantity: int[1-10]` |
| updateHoldSchema | `11-14` | Same as create |
| **customerSchema** | `16-20` | `name`, `email`, `phone: 10 digits` |
| **createOrderSchema** | `22-25` | `holdId: uuid`, `customer` |
| movieListQuerySchema | `29-33` | `category`, `limit[1-50]`, `cursor` |
| showsQuerySchema | `40-42` | `date: YYYY-MM-DD` |

---

### 2. TypeScript Types
**File**: `src/lib/types.ts`

| Type | Line Numbers | Description |
|------|--------------|-------------|
| Movie | `15-29` | Full movie object |
| MovieCard | `31-38` | Shortened for listings |
| Theatre | `40-49` | Theatre with geo |
| **ShowStatus** | `51` | `"AVAILABLE" \| "FILLING_FAST" \| "ALMOST_FULL"` |
| Show | `53-60` | Show details |
| SeatMap | `71-79` | Layout + availability |
| **HoldStatus** | `83` | `"HELD" \| "EXPIRED" \| "RELEASED"` |
| Hold | `85-94` | Hold object |
| **OrderStatus** | `98-103` | `"PAYMENT_PENDING" \| "CONFIRMED" \| "FAILED" \| "EXPIRED" \| "CANCELLED"` |
| Order | `111-125` | Full order object |
| OrderResponse | `157-176` | API response format |

---

## Infrastructure Configuration

### SAM Template
**File**: `bms-lambda/template.yaml`

| Resource | Line Numbers | Description |
|----------|--------------|-------------|
| Global function config | `6-32` | Timeout: 30s, Runtime: Python 3.11, Memory: 512MB |
| Environment variables | `13-32` | DB, Redis, SQS, Hold/Order TTL |
| **API Gateway** | `73-82` | `BMSApi` with CORS |
| **MoviesFunction** | `90-129` | Handler: `handlers.movies.lambda_handler` |
| Movies endpoints | `112-129` | `/movies`, `/movies/{movieId}`, `/movies/{movieId}/shows` |
| **SeatsFunction** | `132-159` | Handler: `handlers.seats.lambda_handler` |
| Seatmap endpoint | `154-159` | `/shows/{showId}/seatmap` |
| **HoldsFunction** | `161-200` | Handler: `handlers.holds.lambda_handler` |
| Holds endpoints | `183-200` | `/holds`, `/holds/{holdId}`, `/holds/{holdId}/release` |
| **OrdersFunction** | `203-244` | Handler: `handlers.orders.lambda_handler` |
| Orders endpoints | `227-244` | `/orders`, `/orders/{orderId}`, `/orders/{orderId}/confirm-payment` |
| **EventsFunction** | `247-262` | SQS event processor |
| **ShowsGeneratorFunction** | `264-283` | Admin endpoint for data generation |

---

## Common Interview Questions - Quick Reference

### "Where do you lock seats?"
**Answer**: `bms-lambda/src/services/redis_service.py:122` - `lock_seats_atomic()` method uses a Lua script (lines 53-93) to atomically check and lock multiple seats.

### "Where is the order inserted into the database?"
**Answer**: `bms-lambda/src/services/db_service.py:168-187` - `create_order()` method executes `INSERT INTO orders (...) RETURNING order_id`

### "How do you prevent double booking?"
**Answer**:
1. **Redis atomic lock**: `redis_service.py:53-93` - Lua script checks all seats before locking
2. **Race condition check**: `orders.py:96-101` - Double-checks confirmed seats before creating order
3. **Hold expiration**: `holds.py:127` - Holds expire after 5 minutes (configurable)

### "Where do you validate the request?"
**Answer**: `bms-lambda/src/utils/validators.py` - `BMSValidator` class with methods for UUID (line 13), email (line 19), phone (line 25), seat IDs (line 31), hold request (line 37), order request (line 61)

### "How does the frontend talk to the backend?"
**Answer**:
1. Frontend calls Next.js API routes: `src/app/api/v1/*/route.ts`
2. API routes forward to Lambda: e.g., `holds/route.ts:47` - `fetch(\`${LAMBDA_HOLDS_URL}/holds\`)`
3. Lambda processes and responds

### "Where is the seat availability cached?"
**Answer**: `bms-lambda/src/handlers/seats.py:82` - `redis_service.cache_seat_availability(show_id, seatmap_data, ttl=10)` - 10 second cache

### "Where do you generate the ticket code?"
**Answer**: `bms-lambda/src/handlers/orders.py:283` - `ticket_code = f"BMS{order_id[:8].upper()}"`

### "Where is payment confirmed?"
**Answer**: `bms-lambda/src/handlers/orders.py:257-339` - `confirm_payment()` function updates order status and releases seat locks

### "How do you handle hold expiration?"
**Answer**:
1. **Redis TTL**: `redis_service.py:189` - `setex(key, config.HOLD_TTL_SECONDS, value)`
2. **Get hold check**: `holds.py:209-212` - Returns `EXPIRED` status if past expiration
3. **Order creation check**: `orders.py:85-87` - Validates hold hasn't expired

### "Where are movies fetched from the database?"
**Answer**: `bms-lambda/src/services/db_service.py:95-103` - `get_movies()` with SQL query at lines 97-101

### "Where do you send events to SQS?"
**Answer**: `bms-lambda/src/services/sqs_service.py:27-36` - `send_message()` with queue URL and message attributes

---

## Database Tables

| Table | Columns (Key) |
|-------|---------------|
| **movies** | movie_id (PK), title, thumbnail_url, rating, duration_mins, genres |
| **theatres** | theatre_id (PK), name, address, geo_lat, geo_lng, cancellation_available |
| **shows** | show_id (PK), movie_id (FK), theatre_id (FK), start_time, price, status |
| **orders** | order_id (PK), user_id, show_id (FK), seat_ids[], customer_name, customer_email, customer_phone, amount, status, ticket_code, created_at, expires_at |

---

## Quick File Reference

| When asked about... | Go to file |
|--------------------|------------|
| Movie listing | `bms-lambda/src/handlers/movies.py:44-78` |
| Show times | `bms-lambda/src/handlers/movies.py:114-188` |
| Seat map | `bms-lambda/src/handlers/seats.py:37-88` |
| Create hold | `bms-lambda/src/handlers/holds.py:50-190` |
| Create order | `bms-lambda/src/handlers/orders.py:50-203` |
| Confirm payment | `bms-lambda/src/handlers/orders.py:257-339` |
| Atomic seat lock | `bms-lambda/src/services/redis_service.py:53-93` |
| Database queries | `bms-lambda/src/services/db_service.py` |
| API validation | `bms-lambda/src/utils/validators.py` |
| Frontend seat UI | `src/components/SeatSelectorLambda.tsx` |
| Order summary UI | `src/app/order-summary/[movieId]/[theatreId]/OrderSummaryClient.tsx` |
| Infrastructure | `bms-lambda/template.yaml` |

---

*Generated for interview preparation. All line numbers reference the actual codebase.*
