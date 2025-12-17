# BookMyShow Clone - Complete Architecture Documentation

## 🏗️ System Overview

This BookMyShow clone is a modern, scalable movie ticket booking platform built with a **serverless-first architecture** using AWS Lambda, Next.js, PostgreSQL, and Redis. The system is designed to handle millions of concurrent users with atomic seat locking and real-time availability.

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

### Core Tables

#### Movies Table
```sql
CREATE TABLE movies (
    movie_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    about TEXT,
    thumbnail_url TEXT,
    rating NUMERIC(3,1),
    duration_mins INTEGER,
    age_rating VARCHAR(10),
    release_date DATE,
    language VARCHAR(50),
    format VARCHAR(20),
    genres TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### Theatres Table
```sql
CREATE TABLE theatres (
    theatre_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    address TEXT,
    geo_lat DECIMAL(10, 8),
    geo_lng DECIMAL(11, 8),
    cancellation_available BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### Shows Table
```sql
CREATE TABLE shows (
    show_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movie_id UUID REFERENCES movies(movie_id),
    theatre_id UUID REFERENCES theatres(theatre_id),
    start_time TIMESTAMP WITH TIME ZONE,
    price DECIMAL(10, 2),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### Orders Table
```sql
CREATE TABLE orders (
    order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id UUID REFERENCES shows(show_id),
    user_id VARCHAR(255),
    seat_ids TEXT[],
    total_amount DECIMAL(10, 2),
    status VARCHAR(20) DEFAULT 'pending',
    customer_name VARCHAR(255),
    customer_email VARCHAR(255),
    customer_phone VARCHAR(20),
    payment_method VARCHAR(50),
    payment_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    confirmed_at TIMESTAMP WITH TIME ZONE
);
```

### Redis Data Structures

#### Seat Locks
```
Key Pattern: seat_lock:{show_id}:{seat_id}
Value: {user_id}:{hold_id}:{timestamp}
TTL: 300 seconds (5 minutes)
```

#### Hold Metadata
```
Key Pattern: hold:{hold_id}
Value: JSON object with hold details
TTL: 300 seconds (5 minutes)
```

#### Cached Seat Maps
```
Key Pattern: seatmap:{show_id}
Value: JSON object with seat availability
TTL: 10 seconds (hot data)
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

## 🎯 Next Steps for New Developers

1. **Setup Local Environment**: Follow the deployment guide
2. **Understand the Flow**: Trace through seat booking process
3. **Read the Code**: Start with API client and Lambda handlers
4. **Run Tests**: Execute unit and integration tests
5. **Make Changes**: Start with small features or bug fixes
6. **Deploy**: Test deployment process in staging environment

## 📞 Support

For questions or issues:
- **Documentation**: This README and `/docs` folder
- **Code Comments**: Inline documentation in source code
- **Issues**: GitHub Issues for bug reports and feature requests
- **Discussions**: Team Slack/Discord for real-time help

---

**Happy Coding! 🚀**