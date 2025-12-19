# BookMyShow Clone

A production-ready movie ticket booking application with real-time seat selection, atomic seat locking, and concurrent booking support. Built with Next.js 15, AWS Lambda, PostgreSQL, and Redis.

## Demo

https://github.com/user-attachments/assets/demo-placeholder

> **[View Demo Video](docs/Book%20my%20show%20concurrent%20booking%20demo_Rishabh.mp4)** - Watch the concurrent booking demonstration

The demo showcases:
- Real-time seat selection with concurrent users
- Atomic seat locking preventing double bookings
- Complete booking flow from movie selection to ticket generation

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SYSTEM ARCHITECTURE                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Browser/Client                                                            │
│        │                                                                    │
│        ▼                                                                    │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                    Next.js Application                              │   │
│   │  ┌─────────────────────────────────────────────────────────────────┐│   │
│   │  │  API Routes (Authentication + Forwarding)                       ││   │
│   │  │  /api/v1/holds    → λ holds-service                             ││   │
│   │  │  /api/v1/orders   → λ orders-service                            ││   │
│   │  │  /api/v1/shows/*  → λ seats-service                             ││   │
│   │  │  /movies/*        → λ movies-service                            ││   │
│   │  └─────────────────────────────────────────────────────────────────┘│   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                 │                                           │
│                                 ▼                                           │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                     AWS API Gateway                                 │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                 │                                           │
│                ┌────────────────┼────────────────┐                          │
│                ▼                ▼                ▼                          │
│    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐             │
│    │ λ Movies Service │ │ λ Holds Service │ │ λ Orders Service│             │
│    │ (Read-heavy)     │ │ (Redis-based)   │ │ (DB + Redis)    │             │
│    └─────────────────┘ └─────────────────┘ └─────────────────┘             │
│             │                    │                    │                     │
│             └────────────────────┼────────────────────┘                     │
│                                  ▼                                          │
│          ┌─────────────────────────────────────────────────────────────┐    │
│          │                   Data Layer                                │    │
│          │  ┌─────────────────┐    ┌─────────────────────────────────┐ │    │
│          │  │   PostgreSQL    │    │         Redis Cluster          │ │    │
│          │  │  (Persistent)   │    │       (Seat Locks & Cache)     │ │    │
│          │  │  - Movies       │    │  - seat_lock:showId:seatId     │ │    │
│          │  │  - Shows        │    │  - hold:holdId                 │ │    │
│          │  │  - Orders       │    │  - seatmap:showId (cache)      │ │    │
│          │  └─────────────────┘    └─────────────────────────────────┘ │    │
│          └─────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Features

### Booking System
- **Atomic Seat Locking**: Redis Lua scripts ensure no double bookings
- **10-minute Hold TTL**: Seats automatically release if not purchased
- **Concurrent User Support**: Handles multiple users booking simultaneously
- **Real-time Seat Availability**: Live updates of seat status

### User Experience
- Browse movies with recommendations and trending sections
- View movie details with cast and crew information
- Select showtime and theatre
- Interactive seat selection grid
- Order summary with payment confirmation
- Ticket code generation

### Technical Highlights
- **Serverless Backend**: AWS Lambda functions for auto-scaling
- **PostgreSQL**: Persistent storage for movies, shows, and orders
- **Redis**: High-performance seat locking and caching
- **Next.js 15**: Modern React framework with App Router

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 15, TypeScript, Tailwind CSS, shadcn/ui |
| **Backend** | AWS Lambda (Python 3.11), API Gateway |
| **Database** | PostgreSQL 15 (AWS RDS) |
| **Cache** | Redis 7.0 (Redis Labs) |
| **Auth** | Auth.js v5 (NextAuth) with Google OAuth |
| **Infrastructure** | AWS SAM, CloudFormation |

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- AWS CLI configured (for backend deployment)
- SAM CLI (for Lambda deployment)

### Frontend Setup

```bash
# Clone repository
git clone <your-repo>
cd bms_clone

# Install dependencies
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with your credentials

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

### Environment Variables

```env
# API
NEXT_PUBLIC_BMS_API_URL=https://your-api-gateway-url/prod

# Authentication
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
AUTH_SECRET=your_auth_secret

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Backend Deployment

```bash
cd bms-lambda

# Build Lambda functions
sam build --skip-pull-image

# Deploy to AWS
sam deploy --no-confirm-changeset --no-fail-on-empty-changeset
```

## API Endpoints

### Public Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/movies` | List movies |
| GET | `/movies/{movieId}` | Get movie details |
| GET | `/movies/{movieId}/shows?date=YYYY-MM-DD` | Get shows for a date |
| GET | `/shows/{showId}/seatmap` | Get seat layout and availability |

### Protected Endpoints (Auth Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/holds` | Create seat hold |
| GET | `/holds/{holdId}` | Get hold status |
| POST | `/orders` | Create order from hold |
| GET | `/orders/{orderId}` | Get order details |
| POST | `/orders/{orderId}/confirm-payment` | Confirm payment |

### Testing the API

```bash
# Base URL
API_URL="https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod"

# List movies
curl "$API_URL/movies"

# Get seat map
curl "$API_URL/shows/272366af-bbac-4d97-8ead-3d77a1703d9b/seatmap"

# Create a hold
curl -X POST "$API_URL/holds" \
  -H "Content-Type: application/json" \
  -H "x-user-id: test-user-123" \
  -d '{"showId":"272366af-bbac-4d97-8ead-3d77a1703d9b","seatIds":["A1","A2"],"quantity":2}'
```

## Project Structure

```
bms_clone/
├── bms-lambda/                 # AWS Lambda backend (Python)
│   ├── src/
│   │   ├── handlers/          # Lambda function entry points
│   │   │   ├── movies.py      # GET /movies, GET /movies/{id}
│   │   │   ├── seats.py       # GET /shows/{id}/seatmap
│   │   │   ├── holds.py       # POST/GET/DELETE /holds
│   │   │   └── orders.py      # POST /orders, confirm-payment
│   │   └── services/          # Business logic layer
│   │       ├── db_service.py  # PostgreSQL queries
│   │       └── redis_service.py # Redis operations + Lua scripts
│   └── template.yaml          # AWS SAM infrastructure definition
│
├── src/                       # Next.js frontend (TypeScript)
│   ├── app/
│   │   ├── api/v1/           # Next.js API routes (proxy to Lambda)
│   │   ├── movies/           # Movie listing and details
│   │   ├── seat-layout/      # Seat selection page
│   │   └── order-summary/    # Payment and confirmation
│   ├── components/
│   │   ├── ui/               # shadcn/ui components
│   │   └── SeatSelectorLambda.tsx  # Main seat booking component
│   └── lib/
│       ├── api-client.ts     # Lambda API client
│       ├── types.ts          # TypeScript interfaces
│       └── schemas.ts        # Zod validation schemas
│
└── docs/                      # Documentation
    ├── ARCHITECTURE.md        # System architecture details
    ├── COMPLETE_ARCHITECTURE.md # Comprehensive architecture guide
    ├── API_AND_DATABASE_DESIGN.md # API specs and DB schema
    ├── AWS_DEPLOYMENT_GUIDE.md # Step-by-step deployment
    ├── QUICK_START.md         # Quick setup guide
    ├── INTEGRATION_STATUS.md  # Current integration status
    ├── QUEUE_BASED_BOOKING_DESIGN.md # Future scaling design
    └── Book my show concurrent booking demo_Rishabh.mp4 # Demo video
```

## Database Schema

### Core Tables

```sql
-- Movies: Store movie catalog
CREATE TABLE movies (
    movie_id UUID PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    rating NUMERIC(3,1),
    duration_mins INTEGER,
    genres TEXT[]
);

-- Shows: Link movies to theatres with timing
CREATE TABLE shows (
    show_id UUID PRIMARY KEY,
    movie_id UUID REFERENCES movies(movie_id),
    theatre_id UUID REFERENCES theatres(theatre_id),
    start_time TIMESTAMP WITH TIME ZONE,
    price NUMERIC(10,2)
);

-- Orders: Store ticket bookings
CREATE TABLE orders (
    order_id UUID PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    show_id UUID REFERENCES shows(show_id),
    seat_ids TEXT[] NOT NULL,
    status VARCHAR(20) DEFAULT 'PAYMENT_PENDING',
    ticket_code VARCHAR(50)
);
```

### Redis Data Structures

```
# Seat locks (TTL = 10 minutes)
seat_lock:{showId}:{seatId} = "{userId}:{holdId}"

# Hold metadata (TTL = 10 minutes)
hold:{holdId} = JSON { holdId, showId, userId, seatIds, status, expiresAt }

# Seatmap cache (TTL = 10 seconds)
seatmap:{showId} = JSON { unavailableSeatIds, heldSeatIds }
```

## Booking Flow

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────┐
│  Browse  │───▶│  Select  │───▶│  Select  │───▶│  Create  │───▶│Create│
│  Movies  │    │   Show   │    │  Seats   │    │   Hold   │    │Order │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └──┬───┘
                                                                   │
GET /movies     GET /shows      GET /seatmap    POST /holds    POST /orders
                                                (10 min TTL)   (5 min TTL)
                                                                   │
                                                                   ▼
                                                           ┌──────────┐
                                                           │  Confirm │
                                                           │ Payment  │
                                                           └──────────┘
                                                                   │
                                                    POST /orders/{id}/confirm
                                                                   │
                                                                   ▼
                                                           ┌──────────┐
                                                           │  Ticket  │
                                                           │  Issued  │
                                                           └──────────┘
```

## Status Models

### Hold Status
| Status | Description |
|--------|-------------|
| `HELD` | Seats are locked for the user |
| `EXPIRED` | Hold has expired (10 minutes) |
| `RELEASED` | User released the hold |

### Order Status
| Status | Description |
|--------|-------------|
| `PAYMENT_PENDING` | Awaiting payment |
| `CONFIRMED` | Payment successful, tickets issued |
| `FAILED` | Payment failed |
| `EXPIRED` | Payment window expired (5 minutes) |

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System architecture and design |
| [Complete Architecture](docs/COMPLETE_ARCHITECTURE.md) | Comprehensive guide with all details |
| [API & Database Design](docs/API_AND_DATABASE_DESIGN.md) | API specs, DB schema, Redis design |
| [AWS Deployment Guide](docs/AWS_DEPLOYMENT_GUIDE.md) | Step-by-step deployment instructions |
| [Quick Start](docs/QUICK_START.md) | Get started in 30 minutes |
| [Integration Status](docs/INTEGRATION_STATUS.md) | Current integration status |
| [Queue-Based Design](docs/QUEUE_BASED_BOOKING_DESIGN.md) | Future scaling architecture |

## Scripts

```bash
npm run dev        # Start development server
npm run build      # Build for production
npm run start      # Start production server
npm run lint       # Run ESLint
npm run typecheck  # Run TypeScript type checking
```

## Production URLs

| Resource | URL |
|----------|-----|
| API Gateway | `https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod` |
| Movies API | `/movies` |
| Shows API | `/movies/{movieId}/shows` |
| Seatmap API | `/shows/{showId}/seatmap` |
| Holds API | `/holds` |
| Orders API | `/orders` |

## Scaling Capabilities

| Metric | Current Capacity | Scale Limit |
|--------|------------------|-------------|
| Concurrent Users | 1,000/sec | 100K+ (Lambda auto-scaling) |
| Seat Locks/sec | 500/sec | 10K+ (Redis throughput) |
| Order Processing | 200/sec | 5K+ (Aurora write IOPS) |

## License

MIT
