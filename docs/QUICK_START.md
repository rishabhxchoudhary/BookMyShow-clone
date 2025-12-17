# 🚀 Quick Start Guide - BookMyShow Clone

> **Last Updated**: December 2025 | **Status**: Production Ready

## Overview
This guide will help you set up the complete BookMyShow clone with AWS Lambda backend and Next.js frontend in under 30 minutes.

## Live Production Environment
- **API Gateway**: `https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod/`
- **Database**: PostgreSQL RDS (ap-south-1)
- **Cache**: Redis Labs

## Prerequisites
- AWS Account with CLI configured (`aws configure`)
- Node.js 18+ and npm
- SAM CLI (`brew install aws-sam-cli`)
- PostgreSQL client (optional, for database access)

## 🏗️ Architecture
```
┌─────────────┐     ┌─────────────────┐     ┌──────────────────────────────┐
│   Next.js   │────▶│   AWS API       │────▶│   AWS Lambda Functions       │
│  Frontend   │     │   Gateway       │     │  (movies, seats, holds,      │
│  (port 3000)│     │                 │     │   orders, events)            │
└─────────────┘     └─────────────────┘     └──────────────┬───────────────┘
                                                           │
                                            ┌──────────────┼───────────────┐
                                            ▼              ▼               ▼
                                      ┌──────────┐  ┌───────────┐  ┌───────────┐
                                      │PostgreSQL│  │   Redis   │  │  AWS SQS  │
                                      │   RDS    │  │   Labs    │  │  Events   │
                                      └──────────┘  └───────────┘  └───────────┘
```

## 📋 Step-by-Step Setup

### 1. Clone and Setup
```bash
git clone <your-repo>
cd bms_clone
```

### 2. Backend Setup (Lambda + API Gateway)

#### Install SAM CLI
```bash
# macOS
brew tap aws/tap
brew install aws-sam-cli

# Linux/Windows - follow AWS documentation
```

#### Configure Environment
```bash
cd bms-lambda

# Update template.yaml with your database credentials
# Replace the following in template.yaml:
# REDIS_URL: redis://default:YOUR_PASSWORD@your-redis-host:port
# DATABASE_URL: postgresql://user:password@your-db-host:port/dbname
```

#### Deploy Lambda Backend
```bash
# Build
sam build

# Package
sam package --s3-bucket YOUR_S3_BUCKET --output-template-file packaged-template.yaml

# Deploy
aws cloudformation deploy \
  --template-file packaged-template.yaml \
  --stack-name bms-lambda \
  --capabilities CAPABILITY_IAM \
  --region ap-south-1
```

#### Get Your API URL
```bash
aws cloudformation describe-stacks --stack-name bms-lambda --query 'Stacks[0].Outputs[?OutputKey==`BMSApiUrl`].OutputValue' --output text
```

### 3. Database Setup

> **Note**: The production database is already set up. These schemas are for reference or new environments.

#### PostgreSQL Tables (Production Schema)
```sql
-- Connect to your PostgreSQL database and run:

-- 1. Movies table - stores movie catalog
CREATE TABLE movies (
    movie_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title         VARCHAR(255) NOT NULL,
    about         TEXT,
    thumbnail_url TEXT,
    rating        NUMERIC(3,1),
    duration_mins INTEGER,
    age_rating    VARCHAR(10),
    release_date  DATE,
    language      VARCHAR(50),
    format        VARCHAR(20),
    genres        TEXT[],
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Theatres table - stores cinema hall info
CREATE TABLE theatres (
    theatre_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  VARCHAR(255) NOT NULL,
    address               TEXT,
    geo_lat               DECIMAL(10, 8),
    geo_lng               DECIMAL(11, 8),
    cancellation_available BOOLEAN DEFAULT TRUE,
    created_at            TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Shows table - links movies to theatres with timing
CREATE TABLE shows (
    show_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movie_id   UUID NOT NULL REFERENCES movies(movie_id),
    theatre_id UUID NOT NULL REFERENCES theatres(theatre_id),
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    price      NUMERIC(10, 2) NOT NULL,
    status     VARCHAR(20) DEFAULT 'AVAILABLE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for show queries
CREATE INDEX idx_shows_movie_date ON shows(movie_id, start_time);
CREATE INDEX idx_shows_theatre ON shows(theatre_id, start_time);

-- 4. Orders table - stores ticket bookings
CREATE TABLE orders (
    order_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        VARCHAR(255) NOT NULL,
    show_id        UUID NOT NULL REFERENCES shows(show_id),
    seat_ids       TEXT[] NOT NULL,
    customer_name  VARCHAR(255),
    customer_email VARCHAR(255),
    customer_phone VARCHAR(20),
    amount         NUMERIC(10, 2) NOT NULL,
    status         VARCHAR(20) NOT NULL DEFAULT 'PAYMENT_PENDING',
    ticket_code    VARCHAR(50),
    created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    confirmed_at   TIMESTAMP WITH TIME ZONE,
    expires_at     TIMESTAMP WITH TIME ZONE
);

-- Indexes for order queries
CREATE INDEX idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX idx_orders_show_status ON orders(show_id, status);

-- 5. Seat layouts table (optional - seats generated dynamically)
CREATE TABLE seat_layouts (
    layout_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    theatre_id  UUID REFERENCES theatres(theatre_id),
    screen_name VARCHAR(50),
    rows        INTEGER,
    cols        INTEGER,
    layout_json JSONB,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

#### Sample Data
```sql
-- Insert sample movies
INSERT INTO movies (title, about, thumbnail_url, rating, duration_mins, age_rating, release_date, language, format, genres) VALUES
('Avengers: Endgame', 'After the devastating events of Avengers: Infinity War, the universe is in ruins.', 'https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?w=400', 8.4, 181, 'PG-13', '2019-04-26', 'English', '2D, IMAX', ARRAY['Action', 'Adventure', 'Drama']),
('RRR', 'A fictional story about two legendary revolutionaries and their journey far from home.', 'https://images.unsplash.com/photo-1509347528160-9a9e33742cdb?w=400', 8.8, 187, 'PG-13', '2022-03-25', 'Telugu', '2D, IMAX', ARRAY['Action', 'Drama']);

-- Insert sample theatres
INSERT INTO theatres (theatre_id, name, address, geo_lat, geo_lng, cancellation_available) VALUES 
('550e8400-e29b-41d4-a716-446655440011', 'PVR Phoenix Mills', 'Phoenix Mills, Mumbai', 19.0132, 72.8342, true),
('550e8400-e29b-41d4-a716-446655440012', 'INOX Mega Mall', 'Oreion Mall, Mumbai', 19.1136, 72.8697, true);

-- Insert sample shows (update movie_id from your actual movie records)
INSERT INTO shows (show_id, movie_id, theatre_id, start_time, price, status) VALUES 
('550e8400-e29b-41d4-a716-446655440021', 'YOUR_MOVIE_ID_HERE', '550e8400-e29b-41d4-a716-446655440011', '2025-12-17 18:00:00', 350.00, 'active'),
('550e8400-e29b-41d4-a716-446655440022', 'YOUR_MOVIE_ID_HERE', '550e8400-e29b-41d4-a716-446655440012', '2025-12-17 21:00:00', 400.00, 'active');
```

### 4. Frontend Setup

#### Install Dependencies
```bash
cd .. # Go back to project root
npm install
```

#### Environment Configuration
```bash
# Create .env file
echo "NEXT_PUBLIC_BMS_API_URL=https://your-api-gateway-url/prod" > .env
echo "AUTH_SECRET=your-auth-secret" >> .env
echo "GOOGLE_CLIENT_ID=your-google-client-id" >> .env
echo "GOOGLE_CLIENT_SECRET=your-google-client-secret" >> .env
```

#### Run Development Server
```bash
npm run dev
```

Visit `http://localhost:3000` to see your application!

## 🧪 Testing Your Setup

### 1. Test Lambda API Directly
```bash
# Base URL
API_URL="https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod"

# Test movies endpoint
curl "$API_URL/movies"

# Test seat map endpoint (working show ID)
curl "$API_URL/shows/272366af-bbac-4d97-8ead-3d77a1703d9b/seatmap"

# Test seat hold creation
curl -X POST "$API_URL/holds" \
  -H "Content-Type: application/json" \
  -H "x-user-id: test-user-123" \
  -d '{"showId":"272366af-bbac-4d97-8ead-3d77a1703d9b","seatIds":["G5","G6"],"quantity":2}'

# Create order from hold (replace HOLD_ID with actual)
curl -X POST "$API_URL/orders" \
  -H "Content-Type: application/json" \
  -H "x-user-id: test-user-123" \
  -d '{"holdId":"YOUR_HOLD_ID","customer":{"name":"Test User","email":"test@example.com","phone":"9876543210"}}'

# Confirm payment (replace ORDER_ID with actual)
curl -X POST "$API_URL/orders/YOUR_ORDER_ID/confirm-payment" \
  -H "x-user-id: test-user-123"
```

### 2. Test Frontend Features
1. **Homepage**: Should display movies from your database
2. **Movie Details**: Click on a movie to see details
3. **Seat Selection**: Navigate to seat layout page
4. **Booking Flow**: Select seats and create holds

## 🐛 Common Issues & Solutions

### Lambda Deployment Issues
```bash
# Check SAM build logs
sam build --debug

# Validate template
sam validate

# Check CloudFormation events
aws cloudformation describe-stack-events --stack-name bms-lambda
```

### Database Connection Issues
```bash
# Test database connection
psql -h your-db-host -U username -d dbname -c "SELECT NOW();"

# Check Lambda logs
aws logs tail /aws/lambda/bms-movies-service --region ap-south-1 --since 10m
```

### Frontend Issues
```bash
# Check environment variables
npm run dev
# Visit http://localhost:3000 and check browser console

# Test API client directly
node -e "
const { bmsAPI } = require('./src/lib/api-client.ts');
bmsAPI.getMovies().then(console.log).catch(console.error);
"
```

## 🚀 Deployment to Production

### Backend
- Already deployed with SAM
- Monitor via CloudWatch
- Set up CloudWatch alarms

### Frontend
```bash
# Build for production
npm run build

# Deploy to Vercel (recommended)
npx vercel

# Or deploy to AWS Amplify, Netlify, etc.
```

## 📊 Monitoring

### CloudWatch Dashboards
- Lambda function metrics
- API Gateway metrics
- Database connection metrics

### Logs
```bash
# Lambda logs
aws logs tail /aws/lambda/bms-movies-service --region ap-south-1 --follow

# API Gateway logs (if enabled)
aws logs tail /aws/apigateway/your-api-id --region ap-south-1 --follow
```

## 🔧 Development Workflow

### Making Changes

1. **Backend Changes**:
```bash
cd bms-lambda
# Edit Python files
sam build && sam package --s3-bucket YOUR_BUCKET --output-template-file packaged-template.yaml
aws cloudformation deploy --template-file packaged-template.yaml --stack-name bms-lambda --capabilities CAPABILITY_IAM
```

2. **Frontend Changes**:
```bash
# Edit React/TypeScript files
npm run dev # Auto-reloads
```

### Adding New Features

1. **New Lambda Function**: Add to `template.yaml`
2. **New API Endpoint**: Add route in Lambda handler
3. **New Frontend Component**: Create in `src/components/`
4. **New Page**: Add in `src/app/`

## 📚 What's Next?

1. **Payment Integration**: Add Stripe/Razorpay
2. **Email Notifications**: Implement SQS + SES
3. **User Authentication**: Complete NextAuth.js setup
4. **Admin Dashboard**: Add theatre/movie management
5. **Mobile App**: React Native or Flutter
6. **Analytics**: Add tracking and reporting

## 🆘 Need Help?

1. **Check Logs**: Lambda logs in CloudWatch
2. **API Testing**: Use Postman or curl
3. **Database Issues**: Check connection strings and permissions
4. **Frontend Issues**: Check browser console and network tab

---

**Your BookMyShow clone is ready! 🎬🍿**

## Production URLs
| Resource | URL |
|----------|-----|
| **Frontend** | `http://localhost:3000` (local dev) |
| **API Gateway** | `https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod` |
| **Movies** | `https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod/movies` |
| **Seat Map** | `https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod/shows/{showId}/seatmap` |
| **Holds** | `https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod/holds` |
| **Orders** | `https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod/orders` |

## Sample Show ID for Testing
```
272366af-bbac-4d97-8ead-3d77a1703d9b
```

For complete architecture details, see [COMPLETE_ARCHITECTURE.md](./COMPLETE_ARCHITECTURE.md).