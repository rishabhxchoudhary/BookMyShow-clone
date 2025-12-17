# BookMyShow Clone - Complete Architecture Documentation

> **Last Updated**: December 2025
> **Version**: 2.0 (Production Ready)

## 🏗️ System Overview

This BookMyShow clone is a modern, scalable movie ticket booking platform built with a **serverless-first architecture** using AWS Lambda, Next.js, PostgreSQL, and Redis. The system is designed to handle millions of concurrent users with atomic seat locking and real-time availability.

### Production Endpoints
- **API Gateway**: `https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod/`
- **Frontend**: Hosted on Next.js (local development: `http://localhost:3000`)
- **Database**: PostgreSQL RDS (AWS ap-south-1)
- **Cache**: Redis Labs (ap-south-1)

## 📋 Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Technology Stack](#technology-stack)
3. [System Components](#system-components)
4. [Database Design](#database-design)
5. [API Architecture](#api-architecture)
6. [Frontend Architecture](#frontend-architecture)
7. [Seat Booking Flow](#seat-booking-flow)
8. [Deployment Guide](#deployment-guide)
9. [Monitoring & Observability](#monitoring--observability)
10. [Security Considerations](#security-considerations)
11. [Scaling & Performance](#scaling--performance)
12. [Development Workflow](#development-workflow)

## 🏛️ Architecture Overview

```mermaid
graph TB
    subgraph "Frontend Layer"
        NextJS[Next.js 14 App Router]
        Components[React Components]
        TailwindCSS[Tailwind CSS + shadcn/ui]
    end

    subgraph "API Gateway Layer"
        APIGateway[AWS API Gateway]
        CORS[CORS Configuration]
        RateLimit[Rate Limiting]
    end

    subgraph "Serverless Backend"
        MoviesLambda[Movies Lambda]
        SeatsLambda[Seats Lambda]
        OrdersLambda[Orders Lambda]
        EventsLambda[Events Lambda]
    end

    subgraph "Data Layer"
        PostgreSQL[(PostgreSQL RDS)]
        Redis[(Redis Labs)]
        SQS[AWS SQS]
    end

    subgraph "External Services"
        Auth[Google OAuth]
        Payment[Payment Gateway]
        Email[Email Service]
    end

    NextJS --> APIGateway
    APIGateway --> MoviesLambda
    APIGateway --> SeatsLambda
    APIGateway --> OrdersLambda
    APIGateway --> EventsLambda
    
    MoviesLambda --> PostgreSQL
    SeatsLambda --> PostgreSQL
    SeatsLambda --> Redis
    OrdersLambda --> PostgreSQL
    OrdersLambda --> Redis
    EventsLambda --> SQS
    
    NextJS --> Auth
    OrdersLambda --> Payment
    EventsLambda --> Email
```

## 🛠️ Technology Stack

### Frontend Stack
- **Framework**: Next.js 14 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS + shadcn/ui components
- **State Management**: React hooks + Server Actions
- **Authentication**: NextAuth.js with Google OAuth

### Backend Stack
- **Runtime**: AWS Lambda (Python 3.11)
- **API Gateway**: AWS API Gateway with REST APIs
- **Database**: PostgreSQL 15 (AWS RDS)
- **Cache**: Redis 7.0 (Redis Labs)
- **Message Queue**: AWS SQS
- **IAC**: AWS SAM (Serverless Application Model)

### DevOps & Monitoring
- **Deployment**: AWS SAM CLI + CloudFormation
- **Logging**: AWS CloudWatch
- **Monitoring**: AWS X-Ray (optional)
- **CI/CD**: GitHub Actions (recommended)

## 🧩 System Components

### 1. Movies Service (`MoviesLambda`)
**Responsibilities:**
- Fetch paginated movie listings
- Get detailed movie information
- Retrieve show times for movies

**Key Features:**
- Redis caching for performance
- Database connection pooling
- Error handling and logging

**Endpoints:**
- `GET /movies` - List movies with pagination
- `GET /movies/{movieId}` - Get movie details
- `GET /movies/{movieId}/shows` - Get show times

### 2. Seats Service (`SeatsLambda`)
**Responsibilities:**
- Real-time seat availability
- Atomic seat locking/unlocking
- Hold management (temporary reservations)

**Key Features:**
- Redis-based atomic operations
- TTL-based automatic hold expiration
- Concurrent access protection
- Seat layout management

**Endpoints:**
- `GET /shows/{showId}/seatmap` - Get seat layout and availability
- `POST /holds` - Create seat hold
- `GET /holds/{holdId}` - Get hold details
- `PUT /holds/{holdId}` - Update hold
- `DELETE /holds/{holdId}` - Release hold

### 3. Orders Service (`OrdersLambda`)
**Responsibilities:**
- Order creation and management
- Payment processing integration
- Ticket generation
- Order status tracking

**Key Features:**
- Transactional operations
- Payment gateway integration
- Email notifications via SQS
- Order history management

**Endpoints:**
- `POST /orders` - Create new order
- `GET /orders/{orderId}` - Get order details
- `POST /orders/{orderId}/confirm-payment` - Confirm payment

### 4. Events Service (`EventsLambda`)
**Responsibilities:**
- Asynchronous event processing
- Email notifications
- Analytics data collection
- Audit logging

**Key Features:**
- SQS message processing
- Email service integration
- Event-driven architecture
- Retry mechanisms

## 🗄️ Database Design

> **Note**: These are the **actual production schemas** as deployed to AWS RDS PostgreSQL.

### Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│   movies    │       │   shows     │       │  theatres   │
├─────────────┤       ├─────────────┤       ├─────────────┤
│ movie_id PK │◄──────│ movie_id FK │       │ theatre_id  │
│ title       │       │ theatre_id  │──────►│    PK       │
│ about       │       │ show_id PK  │       │ name        │
│ rating      │       │ start_time  │       │ address     │
│ genres[]    │       │ price       │       │ geo_lat/lng │
└─────────────┘       │ status      │       └─────────────┘
                      └──────┬──────┘
                             │
                             ▼
                      ┌─────────────┐
                      │   orders    │
                      ├─────────────┤
                      │ order_id PK │
                      │ show_id FK  │
                      │ user_id     │
                      │ seat_ids[]  │
                      │ amount      │
                      │ status      │
                      │ ticket_code │
                      └─────────────┘
```

### Core Tables

#### 1. Movies Table
**Purpose**: Stores movie catalog with metadata for display and search.

```sql
CREATE TABLE movies (
    movie_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title         VARCHAR(255) NOT NULL,      -- Movie title for display
    about         TEXT,                        -- Movie description/synopsis
    thumbnail_url TEXT,                        -- Poster image URL
    rating        NUMERIC(3,1),               -- IMDB-style rating (e.g., 8.5)
    duration_mins INTEGER,                    -- Runtime in minutes
    age_rating    VARCHAR(10),                -- U, UA, A, etc.
    release_date  DATE,                       -- Theatrical release date
    language      VARCHAR(50),                -- Primary language
    format        VARCHAR(20),                -- 2D, 3D, IMAX, etc.
    genres        TEXT[],                     -- Array: ['Action', 'Drama']
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes: Primary key on movie_id
-- Referenced by: shows.movie_id
```

**Usage**:
- `GET /movies` - List all movies
- `GET /movies/{movieId}` - Get movie details
- Frontend movie cards and detail pages

---

#### 2. Theatres Table
**Purpose**: Stores theatre/cinema hall information for location-based search.

```sql
CREATE TABLE theatres (
    theatre_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  VARCHAR(255) NOT NULL,  -- "PVR Cinemas", "INOX"
    address               TEXT,                    -- Full address
    geo_lat               DECIMAL(10, 8),         -- Latitude for mapping
    geo_lng               DECIMAL(11, 8),         -- Longitude for mapping
    cancellation_available BOOLEAN DEFAULT TRUE,   -- Refund policy flag
    created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes: Primary key on theatre_id
-- Referenced by: shows.theatre_id
```

**Usage**:
- Display theatre info on show listings
- Location-based theatre filtering (future)
- Cancellation policy display

---

#### 3. Shows Table
**Purpose**: Represents a specific screening of a movie at a theatre at a particular time.

```sql
CREATE TABLE shows (
    show_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movie_id   UUID NOT NULL REFERENCES movies(movie_id),    -- Which movie
    theatre_id UUID NOT NULL REFERENCES theatres(theatre_id), -- Which theatre
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,            -- Show timing
    price      NUMERIC(10,2) NOT NULL,                       -- Ticket price
    status     VARCHAR(20) DEFAULT 'AVAILABLE',              -- AVAILABLE, FILLING_FAST, ALMOST_FULL, CANCELLED
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes:
--   PRIMARY KEY on show_id
--   idx_shows_movie_date: (movie_id, start_time) - for listing shows by movie
--   idx_shows_theatre: (theatre_id, start_time) - for listing shows by theatre

-- Foreign Keys:
--   movie_id -> movies(movie_id)
--   theatre_id -> theatres(theatre_id)

-- Referenced by: orders.show_id
```

**Usage**:
- `GET /movies/{movieId}/shows?date=YYYY-MM-DD` - List shows for a movie
- `GET /shows/{showId}/seatmap` - Get seat availability
- Links movies to theatres with pricing

---

#### 4. Orders Table
**Purpose**: Stores ticket bookings with customer info and payment status.

```sql
CREATE TABLE orders (
    order_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        VARCHAR(255) NOT NULL,        -- Auth user ID (from session)
    show_id        UUID NOT NULL REFERENCES shows(show_id),
    seat_ids       TEXT[] NOT NULL,              -- Array: ['A1', 'A2', 'A3']
    customer_name  VARCHAR(255),                 -- Booking name
    customer_email VARCHAR(255),                 -- For confirmation email
    customer_phone VARCHAR(20),                  -- SMS notifications
    amount         NUMERIC(10,2) NOT NULL,       -- Total price
    status         VARCHAR(20) NOT NULL DEFAULT 'PAYMENT_PENDING',
                   -- PAYMENT_PENDING: Awaiting payment
                   -- CONFIRMED: Payment successful
                   -- EXPIRED: Payment window expired
                   -- CANCELLED: User cancelled
    ticket_code    VARCHAR(50),                  -- Generated on confirmation: "BMS30F12E2E"
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    confirmed_at   TIMESTAMP WITH TIME ZONE,    -- When payment was confirmed
    expires_at     TIMESTAMP WITH TIME ZONE     -- Payment deadline (5 min from creation)
);

-- Indexes:
--   PRIMARY KEY on order_id
--   idx_orders_user: (user_id, created_at DESC) - for user order history
--   idx_orders_show_status: (show_id, status) - for seat availability queries

-- Foreign Keys:
--   show_id -> shows(show_id)
```

**Usage**:
- `POST /orders` - Create order from hold
- `GET /orders/{orderId}` - Get order details
- `POST /orders/{orderId}/confirm-payment` - Confirm payment
- Seat availability queries (CONFIRMED orders = booked seats)

---

#### 5. Seat Layouts Table (Optional)
**Purpose**: Stores theatre-specific seat configurations.

```sql
CREATE TABLE seat_layouts (
    layout_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    theatre_id  UUID REFERENCES theatres(theatre_id),
    screen_name VARCHAR(50),                    -- "Screen 1", "IMAX"
    rows        INTEGER,                        -- Number of rows (A-J = 10)
    cols        INTEGER,                        -- Seats per row (1-10 = 10)
    layout_json JSONB,                          -- Custom seat configuration
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

**Note**: Currently seat layouts are generated dynamically (10 rows × 10 seats).

---

### Order Status Flow

```
┌─────────────────┐
│  User selects   │
│     seats       │
└────────┬────────┘
         ▼
┌─────────────────┐
│  Hold created   │ (Redis: 5 min TTL)
│   in Redis      │
└────────┬────────┘
         ▼
┌─────────────────┐
│  Order created  │ status: PAYMENT_PENDING
│  in PostgreSQL  │ expires_at: now + 5 min
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐  ┌───────────┐
│ Pay   │  │  Timeout  │
└───┬───┘  └─────┬─────┘
    ▼            ▼
┌───────────┐  ┌───────────┐
│ CONFIRMED │  │  EXPIRED  │
│ticket_code│  │           │
└───────────┘  └───────────┘
```

### Redis Data Structures

Redis is used for **real-time seat locking** and **caching**. All seat reservation operations use Redis Lua scripts for atomicity.

#### 1. Seat Locks
**Purpose**: Prevent double-booking by locking seats during the booking process.

```
Key Pattern: seat_lock:{show_id}:{seat_id}
Example:    seat_lock:272366af-bbac-4d97-8ead-3d77a1703d9b:A1

Value: {user_id}:{hold_id}
Example: user-123:4d6b2c59-81ad-490e-832b-a19fbcfe3a2e

TTL: 300 seconds (5 minutes)
```

**Lua Script for Atomic Locking**:
```lua
-- Check all seats available, then lock atomically
for each seat:
    if seat_lock exists AND owned by different user:
        return SEAT_TAKEN error
lock all seats with SET ... EX 300
```

#### 2. Hold Metadata
**Purpose**: Store hold details for validation and conversion to orders.

```
Key Pattern: hold:{hold_id}
Example:    hold:4d6b2c59-81ad-490e-832b-a19fbcfe3a2e

Value (JSON):
{
    "hold_id": "4d6b2c59-81ad-490e-832b-a19fbcfe3a2e",
    "show_id": "272366af-bbac-4d97-8ead-3d77a1703d9b",
    "user_id": "user-123",
    "seat_ids": ["A1", "A2"],
    "quantity": 2,
    "status": "HELD",
    "created_at": "2025-12-17T15:07:26.335453+00:00",
    "expires_at": "2025-12-17T15:12:26.335453+00:00"
}

TTL: 300 seconds (5 minutes)
```

#### 3. Cached Seat Maps
**Purpose**: Reduce database load for frequently accessed seat availability.

```
Key Pattern: seatmap:{show_id}
Example:    seatmap:272366af-bbac-4d97-8ead-3d77a1703d9b

Value: JSON object with seat availability
TTL: 10 seconds (short cache for real-time accuracy)
```

**Cache Invalidation**: Deleted after seat locks change or orders created.

#### 4. Rate Limiting (Optional)
```
Key Pattern: ratelimit:{user_id}:{endpoint}
Example:    ratelimit:user-123:holds

Value: Request count
TTL: 60 seconds (sliding window)
```

## 🔌 API Architecture

### RESTful Design Principles
- **Resource-based URLs**: `/movies/{id}`, `/shows/{id}/seatmap`
- **HTTP methods**: GET, POST, PUT, DELETE
- **Status codes**: Proper HTTP status codes for responses
- **Content-Type**: JSON for all requests/responses

### Error Handling
```json
{
  "error": {
    "message": "Detailed error message",
    "timestamp": "2025-12-17T11:30:00.000Z"
  }
}
```

### CORS Configuration
- **Allowed Origins**: Frontend domain (configurable)
- **Allowed Methods**: GET, POST, PUT, DELETE, OPTIONS
- **Allowed Headers**: Content-Type, Authorization, x-user-id

### Authentication
- **Development**: x-user-id header for testing
- **Production**: JWT tokens from NextAuth.js

## 🎨 Frontend Architecture

### File Structure
```
src/
├── app/                    # Next.js App Router
│   ├── movies/            # Movie pages
│   ├── seat-layout/       # Seat selection
│   └── order-summary/     # Order confirmation
├── components/            # Reusable components
│   ├── ui/               # shadcn/ui components
│   └── SeatSelectorLambda.tsx
├── lib/                   # Utilities and types
│   ├── api-client.ts     # Lambda API client
│   ├── types.ts          # TypeScript definitions
│   └── utils.ts          # Helper functions
```

### Key Components

#### API Client (`api-client.ts`)
- Centralized API communication
- Error handling and retry logic
- Type-safe request/response handling
- Environment-based URL configuration

#### Seat Selector (`SeatSelectorLambda.tsx`)
- Real-time seat map rendering
- Interactive seat selection
- Hold creation and management
- Payment flow integration

### State Management Strategy
- **Server State**: React Server Components + Server Actions
- **Client State**: React hooks (useState, useEffect)
- **Form State**: Controlled components
- **Global State**: Context API (when needed)

## 🎫 Seat Booking Flow

### 1. Seat Selection Flow
```mermaid
sequenceDiagram
    participant User
    participant NextJS
    participant SeatsLambda
    participant Redis
    participant PostgreSQL

    User->>NextJS: Select show
    NextJS->>SeatsLambda: GET /shows/{id}/seatmap
    SeatsLambda->>Redis: Check cached seatmap
    alt Cache Miss
        SeatsLambda->>PostgreSQL: Query show details
        SeatsLambda->>Redis: Cache seatmap (10s TTL)
    end
    SeatsLambda-->>NextJS: Return seatmap
    NextJS-->>User: Display seat layout
    
    User->>NextJS: Select seats
    NextJS->>SeatsLambda: POST /holds
    SeatsLambda->>Redis: Atomic seat lock operation
    alt Seats Available
        SeatsLambda->>Redis: Store hold metadata
        SeatsLambda-->>NextJS: Return hold ID
    else Seats Taken
        SeatsLambda-->>NextJS: Return conflict error
    end
```

### 2. Payment Flow
```mermaid
sequenceDiagram
    participant User
    participant NextJS
    participant OrdersLambda
    participant PaymentGateway
    participant PostgreSQL
    participant EventsLambda

    User->>NextJS: Confirm booking
    NextJS->>OrdersLambda: POST /orders
    OrdersLambda->>PostgreSQL: Create order record
    OrdersLambda->>PaymentGateway: Initiate payment
    PaymentGateway-->>OrdersLambda: Payment response
    
    alt Payment Success
        OrdersLambda->>PostgreSQL: Update order status
        OrdersLambda->>EventsLambda: Send confirmation event
        OrdersLambda-->>NextJS: Order confirmed
        EventsLambda->>User: Send confirmation email
    else Payment Failed
        OrdersLambda->>PostgreSQL: Update order status
        OrdersLambda-->>NextJS: Payment failed
    end
```

### 3. Hold Expiration
- **TTL-based**: Redis automatically expires holds after 5 minutes
- **Background cleanup**: Lambda function periodically cleans expired holds
- **User notification**: Frontend shows countdown timer

## 🚀 Deployment Guide

### Prerequisites
- AWS CLI configured with appropriate permissions
- SAM CLI installed
- Node.js 18+ and npm/yarn
- PostgreSQL and Redis instances

### Backend Deployment

1. **Build and Package**
```bash
cd bms-lambda
sam build
sam package --s3-bucket your-deployment-bucket --output-template-file packaged-template.yaml
```

2. **Deploy to AWS**
```bash
aws cloudformation deploy \
  --template-file packaged-template.yaml \
  --stack-name bms-lambda \
  --capabilities CAPABILITY_IAM \
  --region ap-south-1
```

3. **Configure Environment Variables**
Update `template.yaml` with your database credentials:
```yaml
Environment:
  Variables:
    REDIS_URL: redis://your-redis-endpoint
    DATABASE_URL: postgresql://user:pass@host:port/db
```

### Frontend Deployment

1. **Install Dependencies**
```bash
npm install
```

2. **Configure Environment**
```bash
# .env
NEXT_PUBLIC_BMS_API_URL=https://your-api-gateway-url/prod
```

3. **Build and Deploy**
```bash
npm run build
# Deploy to Vercel, Netlify, or AWS Amplify
```

## 📊 Monitoring & Observability

### CloudWatch Metrics
- **Lambda Invocations**: Success/failure rates
- **API Gateway**: Request count, latency, errors
- **Database**: Connection count, query performance
- **Redis**: Cache hit/miss rates

### Custom Metrics
- **Seat Booking Success Rate**: Hold creation vs. order completion
- **Hold Expiration Rate**: Percentage of holds that expire
- **Payment Success Rate**: Order confirmation rates

### Logging Strategy
- **Structured Logging**: JSON format with correlation IDs
- **Log Levels**: INFO, WARNING, ERROR
- **Sensitive Data**: Never log credentials or PII

### Alerting
- **High Error Rate**: > 5% error rate in Lambda functions
- **High Latency**: > 3 seconds response time
- **Database Issues**: Connection pool exhaustion
- **Redis Issues**: Connection failures

## 🔒 Security Considerations

### Authentication & Authorization
- **JWT Tokens**: Secure user authentication
- **API Keys**: For service-to-service communication
- **Role-based Access**: Different permissions for different user types

### Data Protection
- **Encryption**: All data encrypted in transit and at rest
- **PII Handling**: Secure handling of customer information
- **Payment Security**: PCI compliance for payment data

### API Security
- **Rate Limiting**: Prevent abuse and DDoS attacks
- **Input Validation**: Validate all user inputs
- **SQL Injection**: Use parameterized queries
- **CORS**: Properly configured cross-origin policies

### Infrastructure Security
- **VPC**: Lambda functions in private subnets
- **Security Groups**: Restrictive database access
- **IAM Roles**: Principle of least privilege
- **Secrets Management**: AWS Secrets Manager for credentials

## 📈 Scaling & Performance

### Horizontal Scaling
- **Lambda Auto-scaling**: Automatic scaling based on demand
- **Database**: Read replicas for read-heavy workloads
- **Redis Cluster**: Sharding for high throughput

### Vertical Scaling
- **Lambda Memory**: Optimize memory allocation
- **Database**: Instance sizing based on workload
- **Connection Pooling**: Efficient database connections

### Caching Strategy
- **Redis**: Hot data with short TTLs
- **CDN**: Static assets and API responses
- **Application-level**: In-memory caching for frequently accessed data

### Performance Optimization
- **Database Indexing**: Optimized queries
- **Connection Reuse**: Persistent connections
- **Batch Operations**: Reduce API calls
- **Async Processing**: Non-blocking operations

## 👨‍💻 Development Workflow

### Local Development

1. **Backend Setup**
```bash
cd bms-lambda
pip install -r requirements.txt
sam local start-api --port 8000
```

2. **Frontend Setup**
```bash
npm install
npm run dev
```

3. **Environment Configuration**
```bash
# .env.local
NEXT_PUBLIC_BMS_API_URL=http://localhost:8000
```

### Testing Strategy

#### Unit Tests
- **Lambda Functions**: Test business logic
- **API Client**: Mock HTTP responses
- **Components**: React Testing Library

#### Integration Tests
- **API Endpoints**: Test with real database
- **Database Operations**: Test queries and transactions
- **Redis Operations**: Test caching and locking

#### End-to-End Tests
- **User Flows**: Complete booking process
- **Error Scenarios**: Network failures, timeouts
- **Performance**: Load testing with concurrent users

### Git Workflow
```bash
# Feature development
git checkout -b feature/seat-locking
git commit -m "feat: implement atomic seat locking"
git push origin feature/seat-locking

# Code review and merge
# Deploy to staging for testing
# Deploy to production
```

## 📚 Additional Resources

### API Documentation
- **OpenAPI Spec**: Available in `/docs/api-spec.yaml`
- **Postman Collection**: Import from `/docs/postman-collection.json`

### Database Scripts
- **Schema Creation**: `/docs/schema.sql`
- **Sample Data**: `/docs/sample-data.sql`
- **Migrations**: `/docs/migrations/`

### Troubleshooting Guide
- **Common Issues**: Database connection problems
- **Performance Issues**: Slow queries, high memory usage
- **Deployment Issues**: SAM build failures, permissions

---

## 🎯 Quick Start for New Developers

### 1. Understanding the Codebase

```
bms_clone/
├── bms-lambda/                 # AWS Lambda backend (Python)
│   ├── src/
│   │   ├── handlers/          # Lambda function entry points
│   │   │   ├── movies.py      # GET /movies, GET /movies/{id}
│   │   │   ├── seats.py       # GET /shows/{id}/seatmap
│   │   │   ├── holds.py       # POST/GET/DELETE /holds
│   │   │   └── orders.py      # POST /orders, confirm-payment
│   │   ├── services/          # Business logic layer
│   │   │   ├── db_service.py  # PostgreSQL queries
│   │   │   ├── redis_service.py # Redis operations + Lua scripts
│   │   │   └── sqs_service.py # Event publishing
│   │   └── utils/             # Shared utilities
│   │       ├── config.py      # Environment configuration
│   │       ├── logger.py      # Structured logging
│   │       └── validators.py  # Input validation
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
```

### 2. Key Files to Read First

| File | Purpose |
|------|---------|
| `bms-lambda/src/handlers/holds.py` | Understand seat locking flow |
| `bms-lambda/src/handlers/orders.py` | Understand order creation |
| `bms-lambda/src/services/redis_service.py` | Atomic seat operations |
| `bms-lambda/src/services/db_service.py` | Database queries |
| `src/components/SeatSelectorLambda.tsx` | Frontend booking UI |
| `src/app/api/v1/orders/[orderId]/route.ts` | API proxy pattern |

### 3. Testing the APIs

```bash
# Test movies listing
curl https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod/movies

# Test seat map
curl https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod/shows/272366af-bbac-4d97-8ead-3d77a1703d9b/seatmap

# Create a hold (reserve seats)
curl -X POST https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod/holds \
  -H "Content-Type: application/json" \
  -H "x-user-id: test-user-123" \
  -d '{"showId":"272366af-bbac-4d97-8ead-3d77a1703d9b","seatIds":["F5","F6"],"quantity":2}'

# Create order from hold (replace HOLD_ID with actual)
curl -X POST https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod/orders \
  -H "Content-Type: application/json" \
  -H "x-user-id: test-user-123" \
  -d '{"holdId":"HOLD_ID","customer":{"name":"Test","email":"test@example.com","phone":"9876543210"}}'

# Confirm payment (replace ORDER_ID with actual)
curl -X POST https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod/orders/ORDER_ID/confirm-payment \
  -H "x-user-id: test-user-123"
```

### 4. Local Development Setup

```bash
# Frontend
cd bms_clone
npm install
npm run dev          # Starts on http://localhost:3000

# Backend (deploy to AWS)
cd bms-lambda
sam build --skip-pull-image
sam deploy --no-confirm-changeset
```

### 5. Database Access (Development Only)

```bash
# Connect to PostgreSQL
PGPASSWORD='[password]' psql -h bookmyshow.cxwyaqu60aes.ap-south-1.rds.amazonaws.com \
  -U postgres -d bms

# Useful queries
\dt                           # List tables
SELECT * FROM movies;         # View movies
SELECT * FROM shows LIMIT 5;  # View shows
SELECT * FROM orders WHERE status = 'CONFIRMED';  # View confirmed orders

# Redis CLI
redis-cli -u redis://default:[password]@redis-15866.crce182.ap-south-1-1.ec2.cloud.redislabs.com:15866
KEYS seat_lock:*             # View seat locks
KEYS hold:*                  # View holds
```

### 6. Common Tasks

| Task | Files to Modify |
|------|-----------------|
| Add new movie field | `movies.py`, `db_service.py`, `types.ts` |
| Change seat pricing | `shows` table, `seats.py` |
| Modify hold duration | `config.py` (HOLD_TTL_SECONDS) |
| Add new API endpoint | `template.yaml`, new handler file |
| Update frontend UI | Components in `src/components/` |

### 7. Deployment Checklist

```bash
# 1. Make code changes
# 2. Test locally if possible

# 3. Build and deploy Lambda
cd bms-lambda
sam build --skip-pull-image
sam deploy --no-confirm-changeset

# 4. Check CloudWatch logs for errors
aws logs tail /aws/lambda/bms-orders-service --since 5m

# 5. Test API endpoints
curl https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod/movies
```

## 📞 Support

For questions or issues:
- **Documentation**: This README and `/docs` folder
- **Code Comments**: Inline documentation in source code
- **CloudWatch Logs**: `/aws/lambda/bms-*` log groups
- **Database**: Check `orders` and `shows` tables for data issues

### Troubleshooting

| Issue | Solution |
|-------|----------|
| "Hold not found" | Hold expired (5 min TTL), create new hold |
| "Seat taken" | Another user locked the seat, try different seats |
| "Failed to create order" | Check Lambda logs, verify hold exists |
| "Payment failed" | Order may have expired, check `expires_at` |
| Database connection error | Check VPC/security group settings |

---

**Happy Coding! 🚀**