# Integration Status - Final Architecture

## Overview

This document describes the final integration status of the BookMyShow clone, using a **hybrid architecture** that combines AWS Lambda backend with Next.js local APIs.

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           FINAL ARCHITECTURE                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Client (Browser)                                                          │
│         │                                                                   │
│         ▼                                                                   │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    Next.js Application                              │   │
│   │                                                                     │   │
│   │   ┌─────────────────────────────────────────────────────────────┐   │   │
│   │   │                    API Routes                                │   │   │
│   │   │                                                             │   │   │
│   │   │  LOCAL APIs (Memory Store)     LAMBDA APIs (AWS)            │   │   │
│   │   │  ├── /api/v1/holds             ├── GET /movies              │   │   │
│   │   │  ├── /api/v1/orders            ├── GET /movies/{id}         │   │   │
│   │   │  └── /api/v1/shows/[id]/       ├── GET /movies/{id}/shows   │   │   │
│   │   │      seatmap (merged)          └── GET /shows/{id}/seatmap  │   │   │
│   │   └─────────────────────────────────────────────────────────────┘   │   │
│   │                    │                           │                    │   │
│   │                    ▼                           ▼                    │   │
│   │   ┌─────────────────────────┐   ┌────────────────────────────┐     │   │
│   │   │     Memory Store        │   │    AWS API Gateway         │     │   │
│   │   │  ├── Holds (10 min TTL) │   │          ↓                 │     │   │
│   │   │  ├── Orders (5 min TTL) │   │    Lambda Functions        │     │   │
│   │   │  ├── Seat Versions      │   │          ↓                 │     │   │
│   │   │  └── Booking Queues     │   │    PostgreSQL + Redis      │     │   │
│   │   └─────────────────────────┘   └────────────────────────────┘     │   │
│   │                                                                     │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## API Integration Status

### Lambda APIs (AWS Backend)

| Endpoint | Status | Description |
|----------|--------|-------------|
| `GET /movies` | ✅ Working | List all movies |
| `GET /movies/{movieId}` | ✅ Working | Get movie details |
| `GET /movies/{movieId}/shows` | ✅ Working | Get shows for a date |
| `GET /shows/{showId}/seatmap` | ✅ Working | Base seat layout |
| `POST /holds` | ⚠️ Not Used | Bypassed for local consistency |
| `POST /orders` | ❌ Broken | Internal server error |

**Base URL**: `https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod`

### Local APIs (Next.js)

| Endpoint | Status | Description |
|----------|--------|-------------|
| `GET /api/v1/shows/{showId}/seatmap` | ✅ Working | Merged seatmap (Lambda + local holds) |
| `POST /api/v1/holds` | ✅ Working | Create seat hold (10 min TTL) |
| `GET /api/v1/holds/{holdId}` | ✅ Working | Get hold status |
| `POST /api/v1/orders` | ✅ Working | Create order from hold |
| `GET /api/v1/orders/{orderId}` | ✅ Working | Get order details |
| `POST /api/v1/orders/{orderId}/confirm-payment` | ✅ Working | Confirm payment |

---

## Data Flow

### 1. Movie Discovery Flow
```
User → Homepage → Lambda API (GET /movies) → PostgreSQL → Movie List
User → Movie Details → Lambda API (GET /movies/{id}) → PostgreSQL → Movie Info
```

### 2. Show Selection Flow
```
User → Buy Tickets → Lambda API (GET /movies/{id}/shows?date=) → PostgreSQL → Show List
```

### 3. Seat Selection Flow
```
User → Seat Layout → Local API (GET /api/v1/shows/{id}/seatmap)
                          │
                          ├── Lambda API (GET /shows/{id}/seatmap) → Base layout
                          │
                          └── Memory Store → Local holds + confirmed seats
                                    │
                                    ▼
                          Merged seat availability returned
```

### 4. Booking Flow
```
User → Select Seats → Local API (POST /api/v1/holds)
                          │
                          ├── Validate seats available
                          ├── Acquire optimistic locks
                          └── Create hold (10 min TTL)
                                    │
                                    ▼
User → Proceed to Pay → Local API (POST /api/v1/orders)
                          │
                          ├── Validate hold exists
                          └── Create order (5 min TTL)
                                    │
                                    ▼
User → Confirm Payment → Local API (POST /api/v1/orders/{id}/confirm-payment)
                          │
                          ├── Update order status
                          └── Generate ticket code
```

---

## Features Implemented

### Core Booking Features

| Feature | Status | Implementation |
|---------|--------|----------------|
| Movie Listing | ✅ | Lambda API |
| Show Times | ✅ | Lambda API |
| Seat Map Display | ✅ | Merged (Lambda + Local) |
| Seat Selection | ✅ | Client-side React state |
| Seat Locking | ✅ | Local Memory Store |
| Order Creation | ✅ | Local Memory Store |
| Payment Confirmation | ✅ | Local Memory Store |
| Ticket Generation | ✅ | Random ticket code |

### Advanced Locking Features

| Feature | Status | Description |
|---------|--------|-------------|
| Hold TTL (10 min) | ✅ | Holds expire after 10 minutes |
| Expiration on GET | ✅ | No DB writes on expiration check |
| Multiple Holds per User | ✅ | Each tab/session independent |
| Optimistic Locking | ✅ | Version numbers prevent race conditions |
| Booking Queue | ✅ | Partitioned by show + seat tier |

### UI Features

| Feature | Status | Description |
|---------|--------|-------------|
| Movie Cards | ✅ | BookMyShow-style design |
| Seat Grid | ✅ | Interactive seat selection |
| Booking Summary | ✅ | Real-time price calculation |
| Order Summary | ✅ | Ticket details display |
| Loading States | ✅ | Skeleton loaders |
| Error Handling | ✅ | User-friendly error messages |

---

## Technical Implementation Details

### Memory Store (src/lib/memoryStore.ts)

```typescript
// Core data structures
const holds = new Map<string, Hold>();           // Active holds
const orders = new Map<string, Order>();         // Orders
const seatVersions = new Map<string, SeatVersion>(); // Optimistic locking
const bookingQueues = new Map<string, QueuedBooking[]>(); // Queue partitions

// TTL Configuration
const HOLD_TTL_MS = 10 * 60 * 1000;  // 10 minutes
const ORDER_TTL_MS = 5 * 60 * 1000;   // 5 minutes

// Key functions
- getEffectiveHoldStatus()    // Check expiration without DB writes
- processBookingWithLock()    // Handle booking with optimistic locking
- tryAcquireSeatLock()        // Acquire lock with version check
- getHeldSeatIdsForShow()     // Get all held seats (excludes expired)
- getConfirmedSeatIdsForShow() // Get all confirmed seats
```

### Seatmap Merging (src/app/api/v1/shows/[showId]/seatmap/route.ts)

```typescript
// Combines Lambda base seatmap with local booking state
export async function GET(request, { params }) {
  // 1. Fetch from Lambda
  const lambdaSeatmap = await bmsAPI.getSeatmap(showId);

  // 2. Get local state
  const localHeldSeats = getHeldSeatIdsForShow(showId);
  const localConfirmedSeats = getConfirmedSeatIdsForShow(showId);

  // 3. Merge
  return {
    ...lambdaSeatmap,
    unavailableSeatIds: [...lambdaSeatmap.unavailableSeatIds, ...localConfirmedSeats],
    heldSeatIds: [...lambdaSeatmap.heldSeatIds, ...localHeldSeats],
  };
}
```

### Seat Selector Component (src/components/SeatSelectorLambda.tsx)

```typescript
// Uses local APIs for consistent booking flow
const loadSeatMap = async () => {
  const res = await fetch(`/api/v1/shows/${showId}/seatmap`);
  // Returns merged seatmap
};

const handleCreateHold = async () => {
  // 1. Create hold via local API
  const holdRes = await fetch('/api/v1/holds', { method: 'POST', body: ... });

  // 2. Create order from hold
  const orderRes = await fetch('/api/v1/orders', { method: 'POST', body: ... });

  // 3. Navigate to order summary
  router.push(`/order-summary/${movieId}/${theatreId}?orderId=${orderData.orderId}`);
};
```

---

## Known Issues & Solutions

### Issue 1: Lambda Orders Endpoint Broken
- **Problem**: `POST /orders` returns 500 Internal Server Error
- **Solution**: Use local Next.js API for orders

### Issue 2: Holds Not Consistent Across Lambda/Local
- **Problem**: Holds created in Lambda weren't visible locally
- **Solution**: Create holds locally, merge seatmaps

### Issue 3: Previous Hold Released on New Booking
- **Problem**: Same user's previous hold was released when creating new hold
- **Solution**: Removed "one hold per user" restriction

### Issue 4: Seats Not Showing as Held
- **Problem**: Held seats appeared available
- **Solution**: Local seatmap API merges Lambda + local holds

---

## Testing Checklist

### Manual Testing

- [x] Browse movies on homepage
- [x] View movie details
- [x] Select show time and date
- [x] View seat map with availability
- [x] Select multiple seats
- [x] Create seat hold
- [x] Create order from hold
- [x] Confirm payment
- [x] View ticket code

### Concurrency Testing

- [x] Multiple tabs with same user
- [x] Different users booking same seats
- [x] Hold expiration after 10 minutes
- [x] Optimistic locking prevents double booking

---

## Future Improvements

### Short Term
1. Add real payment gateway integration
2. Implement email notifications
3. Add booking history page
4. Add user profile management

### Long Term
1. Replace memory store with Redis
2. Implement distributed locking
3. Add virtual waiting room for flash sales
4. Multi-region deployment

---

## Environment Variables

```env
# Lambda API
NEXT_PUBLIC_BMS_API_URL=https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod

# Authentication
AUTH_SECRET=your-auth-secret
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## Quick Start

```bash
# Install dependencies
npm install

# Clear build cache (if permission issues)
sudo rm -rf .next

# Run development server
npm run dev

# Visit http://localhost:3000
```

---

## Summary

The BookMyShow clone is **fully functional** with:
- ✅ Movie discovery and selection
- ✅ Real-time seat availability
- ✅ Seat locking with 10-minute TTL
- ✅ Optimistic locking for concurrency
- ✅ Queue-based booking for high traffic
- ✅ Multiple independent holds per user
- ✅ Complete booking and payment flow
- ✅ Ticket generation

The hybrid architecture ensures reliability by using Lambda for read-heavy operations (movies, shows) and local APIs for write-heavy operations (holds, orders) with advanced locking mechanisms.
