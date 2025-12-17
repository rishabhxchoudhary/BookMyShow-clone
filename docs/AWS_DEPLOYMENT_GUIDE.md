# AWS Deployment Guide - Step by Step (Beginner Friendly)

## Overview

This guide will help you deploy the BookMyShow clone to AWS with the following architecture:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         YOUR AWS ARCHITECTURE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Users (Browser/Mobile)                                                    │
│          │                                                                  │
│          ▼                                                                  │
│   ┌─────────────┐                                                           │
│   │ API Gateway │  ◄── Entry point, handles routing & throttling            │
│   └──────┬──────┘                                                           │
│          │                                                                  │
│          ▼                                                                  │
│   ┌─────────────────────┐                                                   │
│   │ Application Load    │  ◄── Distributes traffic to containers            │
│   │ Balancer (ALB)      │                                                   │
│   └──────────┬──────────┘                                                   │
│              │                                                              │
│    ┌─────────┴─────────┐                                                    │
│    ▼                   ▼                                                    │
│ ┌──────┐           ┌──────┐                                                 │
│ │ ECS  │           │ ECS  │  ◄── Your Next.js app in containers             │
│ │Task 1│           │Task 2│      (Auto-scales based on load)                │
│ └──┬───┘           └──┬───┘                                                 │
│    │                  │                                                     │
│    └────────┬─────────┘                                                     │
│             │                                                               │
│    ┌────────┼────────┐                                                      │
│    ▼        ▼        ▼                                                      │
│ ┌──────┐ ┌─────┐ ┌─────┐                                                    │
│ │Redis │ │ RDS │ │ SQS │                                                    │
│ │Cache │ │(DB) │ │Queue│                                                    │
│ └──────┘ └─────┘ └─────┘                                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Phase 1: Set Up AWS Account & VPC](#phase-1-set-up-aws-account--vpc)
3. [Phase 2: Set Up RDS (PostgreSQL Database)](#phase-2-set-up-rds-postgresql-database)
4. [Phase 3: Set Up ElastiCache (Redis)](#phase-3-set-up-elasticache-redis)
5. [Phase 4: Set Up SQS (Message Queue)](#phase-4-set-up-sqs-message-queue)
6. [Phase 5: Modify Your Next.js Code](#phase-5-modify-your-nextjs-code)
7. [Phase 6: Containerize Your App (Docker)](#phase-6-containerize-your-app-docker)
8. [Phase 7: Set Up ECR (Container Registry)](#phase-7-set-up-ecr-container-registry)
9. [Phase 8: Set Up ECS Fargate](#phase-8-set-up-ecs-fargate)
10. [Phase 9: Set Up Application Load Balancer](#phase-9-set-up-application-load-balancer)
11. [Phase 10: Set Up API Gateway](#phase-10-set-up-api-gateway)
12. [Phase 11: Environment Variables & Secrets](#phase-11-environment-variables--secrets)
13. [Phase 12: Testing & Monitoring](#phase-12-testing--monitoring)
14. [Cost Estimation](#cost-estimation)

---

## 1. Prerequisites

### Tools to Install on Your Computer

```bash
# 1. AWS CLI (to interact with AWS from terminal)
# Mac:
brew install awscli

# Windows: Download from https://aws.amazon.com/cli/

# 2. Docker (to build containers)
# Download from https://www.docker.com/products/docker-desktop

# 3. Verify installations
aws --version
docker --version
```

### AWS Account Setup

1. Go to [aws.amazon.com](https://aws.amazon.com) and create account
2. Enable MFA (Multi-Factor Authentication) for security
3. Create an IAM user for programmatic access:
   - Go to IAM → Users → Add User
   - Name: `bms-deploy-user`
   - Select: "Access key - Programmatic access"
   - Attach policies: `AdministratorAccess` (for learning; restrict later)
   - Save the Access Key ID and Secret Access Key

```bash
# Configure AWS CLI with your credentials
aws configure
# Enter:
# AWS Access Key ID: [your-key]
# AWS Secret Access Key: [your-secret]
# Default region: ap-south-1 (Mumbai) or us-east-1
# Default output format: json
```

---

## Phase 1: Set Up AWS Account & VPC

### What is VPC?
VPC (Virtual Private Cloud) is your private network in AWS where all your resources live.

### Step 1.1: Create VPC

```bash
# Create VPC with CIDR block 10.0.0.0/16
aws ec2 create-vpc \
  --cidr-block 10.0.0.0/16 \
  --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=bms-vpc}]'

# Note the VpcId from output (e.g., vpc-0abc123...)
```

**Or use AWS Console (easier for beginners):**

1. Go to AWS Console → VPC → Your VPCs → Create VPC
2. Settings:
   - Name: `bms-vpc`
   - IPv4 CIDR: `10.0.0.0/16`
   - Click "Create VPC"

### Step 1.2: Create Subnets

You need at least 2 subnets in different Availability Zones for high availability.

**Public Subnets (for Load Balancer):**
```
Subnet 1:
- Name: bms-public-subnet-1
- VPC: bms-vpc
- Availability Zone: ap-south-1a
- CIDR: 10.0.1.0/24

Subnet 2:
- Name: bms-public-subnet-2
- VPC: bms-vpc
- Availability Zone: ap-south-1b
- CIDR: 10.0.2.0/24
```

**Private Subnets (for ECS, RDS, Redis):**
```
Subnet 3:
- Name: bms-private-subnet-1
- VPC: bms-vpc
- Availability Zone: ap-south-1a
- CIDR: 10.0.3.0/24

Subnet 4:
- Name: bms-private-subnet-2
- VPC: bms-vpc
- Availability Zone: ap-south-1b
- CIDR: 10.0.4.0/24
```

### Step 1.3: Create Internet Gateway

```bash
# Create Internet Gateway
aws ec2 create-internet-gateway \
  --tag-specifications 'ResourceType=internet-gateway,Tags=[{Key=Name,Value=bms-igw}]'

# Attach to VPC
aws ec2 attach-internet-gateway \
  --internet-gateway-id igw-xxx \
  --vpc-id vpc-xxx
```

### Step 1.4: Create Route Tables

**Public Route Table:**
1. Create route table for public subnets
2. Add route: `0.0.0.0/0` → Internet Gateway
3. Associate with public subnets

**Private Route Table:**
1. Create route table for private subnets
2. Add route: `0.0.0.0/0` → NAT Gateway (for outbound internet)
3. Associate with private subnets

### Step 1.5: Create NAT Gateway

NAT Gateway allows private subnets to access internet (for downloading packages, etc.)

1. Go to VPC → NAT Gateways → Create
2. Subnet: Select a public subnet
3. Allocate Elastic IP
4. Create NAT Gateway
5. Update private route table to use NAT Gateway

### Network Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         VPC (10.0.0.0/16)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────┐    ┌─────────────────────┐             │
│  │ Public Subnet 1     │    │ Public Subnet 2     │             │
│  │ 10.0.1.0/24        │    │ 10.0.2.0/24        │             │
│  │ (ap-south-1a)      │    │ (ap-south-1b)      │             │
│  │                     │    │                     │             │
│  │  ┌─────────────┐   │    │                     │             │
│  │  │ NAT Gateway │   │    │                     │             │
│  │  └─────────────┘   │    │                     │             │
│  │                     │    │                     │             │
│  │  ┌─────────────────────────────────────────┐ │             │
│  │  │      Application Load Balancer          │ │             │
│  │  └─────────────────────────────────────────┘ │             │
│  └─────────────────────┘    └─────────────────────┘             │
│              │                        │                         │
│              │    Internet Gateway    │                         │
│              └───────────┬────────────┘                         │
│                          │                                      │
│  ┌─────────────────────┐ │  ┌─────────────────────┐             │
│  │ Private Subnet 1    │ │  │ Private Subnet 2    │             │
│  │ 10.0.3.0/24        │ │  │ 10.0.4.0/24        │             │
│  │ (ap-south-1a)      │ │  │ (ap-south-1b)      │             │
│  │                     │ │  │                     │             │
│  │  ┌───────┐         │ │  │  ┌───────┐         │             │
│  │  │ ECS   │         │ │  │  │ ECS   │         │             │
│  │  │Task 1 │         │ │  │  │Task 2 │         │             │
│  │  └───────┘         │ │  │  └───────┘         │             │
│  │                     │ │  │                     │             │
│  │  ┌───────┐ ┌─────┐ │ │  │  ┌───────┐         │             │
│  │  │ Redis │ │ RDS │ │ │  │  │RDS    │         │             │
│  │  │       │ │Primary│ │  │  │Standby│         │             │
│  │  └───────┘ └─────┘ │ │  │  └───────┘         │             │
│  └─────────────────────┘    └─────────────────────┘             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 2: Set Up RDS (PostgreSQL Database)

### Step 2.1: Create Security Group for RDS

```bash
# Create security group
aws ec2 create-security-group \
  --group-name bms-rds-sg \
  --description "Security group for BMS RDS" \
  --vpc-id vpc-xxx

# Allow PostgreSQL port from private subnets
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxx \
  --protocol tcp \
  --port 5432 \
  --cidr 10.0.0.0/16
```

### Step 2.2: Create RDS Subnet Group

1. Go to RDS → Subnet groups → Create
2. Name: `bms-db-subnet-group`
3. VPC: `bms-vpc`
4. Add private subnets

### Step 2.3: Create RDS Instance

**Using AWS Console:**

1. Go to RDS → Create database
2. Choose:
   - Engine: PostgreSQL
   - Version: 15.x
   - Template: **Free tier** (for learning)
   - DB instance identifier: `bms-database`
   - Master username: `postgres`
   - Master password: (save this securely!)
   - DB instance class: `db.t3.micro` (free tier)
   - Storage: 20 GB
   - VPC: `bms-vpc`
   - Subnet group: `bms-db-subnet-group`
   - Public access: **No**
   - VPC security group: `bms-rds-sg`
   - Database name: `bms_db`
3. Create database (takes 5-10 minutes)

### Step 2.4: Note the Endpoint

After creation, note the endpoint:
```
Endpoint: bms-database.xxxx.ap-south-1.rds.amazonaws.com
Port: 5432
```

---

## Phase 3: Set Up ElastiCache (Redis)

### Step 3.1: Create Security Group for Redis

```bash
# Create security group
aws ec2 create-security-group \
  --group-name bms-redis-sg \
  --description "Security group for BMS Redis" \
  --vpc-id vpc-xxx

# Allow Redis port from private subnets
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxx \
  --protocol tcp \
  --port 6379 \
  --cidr 10.0.0.0/16
```

### Step 3.2: Create ElastiCache Subnet Group

1. Go to ElastiCache → Subnet groups → Create
2. Name: `bms-redis-subnet-group`
3. VPC: `bms-vpc`
4. Add private subnets

### Step 3.3: Create Redis Cluster

**Using AWS Console:**

1. Go to ElastiCache → Create cluster → Redis
2. Choose:
   - Cluster mode: **Disabled** (simpler for learning)
   - Name: `bms-redis`
   - Node type: `cache.t3.micro` (free tier eligible)
   - Number of replicas: 0 (for free tier)
   - Subnet group: `bms-redis-subnet-group`
   - Security group: `bms-redis-sg`
3. Create

### Step 3.4: Note the Endpoint

```
Primary Endpoint: bms-redis.xxxx.cache.amazonaws.com
Port: 6379
```

---

## Phase 4: Set Up SQS (Message Queue)

### Step 4.1: Create SQS Queue

```bash
# Create standard queue
aws sqs create-queue \
  --queue-name bms-notifications-queue \
  --attributes '{
    "VisibilityTimeout": "300",
    "MessageRetentionPeriod": "86400"
  }'
```

**Or via Console:**

1. Go to SQS → Create queue
2. Type: Standard
3. Name: `bms-notifications-queue`
4. Keep defaults
5. Create queue

### Step 4.2: Note the Queue URL

```
Queue URL: https://sqs.ap-south-1.amazonaws.com/123456789/bms-notifications-queue
```

---

## Phase 5: Modify Your Next.js Code

Now we need to modify your code to use Redis and PostgreSQL instead of in-memory storage.

### Step 5.1: Install Required Packages

```bash
cd /Users/rishabh/Desktop/bms_clone
npm install ioredis pg @aws-sdk/client-sqs
npm install -D @types/pg
```

### Step 5.2: Create Database Connection

Create `src/lib/db.ts`:

```typescript
import { Pool } from 'pg';

// Create connection pool
const pool = new Pool({
  host: process.env.DATABASE_HOST,
  port: parseInt(process.env.DATABASE_PORT || '5432'),
  database: process.env.DATABASE_NAME,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  max: 20, // Maximum number of connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

export default pool;
```

### Step 5.3: Create Redis Connection

Create `src/lib/redis.ts`:

```typescript
import Redis from 'ioredis';

const redis = new Redis({
  host: process.env.REDIS_HOST,
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  // Enable if using ElastiCache with TLS
  // tls: process.env.NODE_ENV === 'production' ? {} : undefined,
});

redis.on('error', (err) => {
  console.error('Redis connection error:', err);
});

redis.on('connect', () => {
  console.log('Connected to Redis');
});

export default redis;
```

### Step 5.4: Create SQS Client

Create `src/lib/sqs.ts`:

```typescript
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

const sqs = new SQSClient({
  region: process.env.AWS_REGION || 'ap-south-1',
});

const QUEUE_URL = process.env.SQS_QUEUE_URL;

export async function sendNotification(type: string, data: Record<string, unknown>) {
  if (!QUEUE_URL) {
    console.warn('SQS_QUEUE_URL not configured');
    return;
  }

  const command = new SendMessageCommand({
    QueueUrl: QUEUE_URL,
    MessageBody: JSON.stringify({ type, data, timestamp: new Date().toISOString() }),
    MessageAttributes: {
      Type: {
        DataType: 'String',
        StringValue: type,
      },
    },
  });

  try {
    await sqs.send(command);
  } catch (error) {
    console.error('Failed to send SQS message:', error);
  }
}

export default sqs;
```

### Step 5.5: Create Database Schema

Create `src/lib/schema.sql`:

```sql
-- Run this SQL in your RDS database

-- Movies table
CREATE TABLE IF NOT EXISTS movies (
    movie_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    about TEXT,
    thumbnail_url TEXT,
    rating DECIMAL(3,1),
    duration_mins INTEGER,
    age_rating VARCHAR(10),
    release_date DATE,
    language VARCHAR(50),
    format VARCHAR(20),
    genres TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Theatres table
CREATE TABLE IF NOT EXISTS theatres (
    theatre_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    address TEXT,
    geo_lat DECIMAL(10,8),
    geo_lng DECIMAL(11,8),
    cancellation_available BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shows table (partitioned by date for performance)
CREATE TABLE IF NOT EXISTS shows (
    show_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    movie_id UUID NOT NULL REFERENCES movies(movie_id),
    theatre_id UUID NOT NULL REFERENCES theatres(theatre_id),
    start_time TIMESTAMPTZ NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'AVAILABLE',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_shows_movie_date ON shows(movie_id, start_time);
CREATE INDEX idx_shows_theatre ON shows(theatre_id, start_time);

-- Orders table
CREATE TABLE IF NOT EXISTS orders (
    order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    show_id UUID NOT NULL REFERENCES shows(show_id),
    seat_ids TEXT[] NOT NULL,
    customer_name VARCHAR(255),
    customer_email VARCHAR(255),
    customer_phone VARCHAR(20),
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PAYMENT_PENDING',
    ticket_code VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ
);

CREATE INDEX idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX idx_orders_show_status ON orders(show_id, status);

-- Seats configuration table
CREATE TABLE IF NOT EXISTS seat_layouts (
    layout_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    theatre_id UUID NOT NULL REFERENCES theatres(theatre_id),
    screen_name VARCHAR(50) NOT NULL,
    row_label VARCHAR(5) NOT NULL,
    seat_numbers INTEGER[] NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert sample data
INSERT INTO movies (movie_id, title, about, thumbnail_url, rating, duration_mins, age_rating, release_date, language, format, genres)
VALUES
    ('550e8400-e29b-41d4-a716-446655440001', 'Avatar: Fire and Ash', 'Epic continuation...', 'https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?w=400', 8.7, 192, 'UA', '2025-12-17', 'English', '2D', ARRAY['Action', 'Adventure', 'Sci-Fi']),
    ('550e8400-e29b-41d4-a716-446655440002', 'The Dark Knight Returns', 'Batman returns...', 'https://images.unsplash.com/photo-1509347528160-9a9e33742cdb?w=400', 9.1, 165, 'UA', '2025-12-15', 'English', '2D', ARRAY['Action', 'Drama', 'Crime'])
ON CONFLICT (movie_id) DO NOTHING;

INSERT INTO theatres (theatre_id, name, address, geo_lat, geo_lng, cancellation_available)
VALUES
    ('660e8400-e29b-41d4-a716-446655440001', 'PVR Orion Mall', 'Orion Mall, Bangalore', 12.9914, 77.5573, true),
    ('660e8400-e29b-41d4-a716-446655440002', 'INOX Garuda Mall', 'Garuda Mall, Bangalore', 12.9704, 77.6099, false)
ON CONFLICT (theatre_id) DO NOTHING;
```

### Step 5.6: Replace Memory Store with Redis/PostgreSQL

Create new `src/lib/productionStore.ts`:

```typescript
import redis from './redis';
import pool from './db';
import { sendNotification } from './sqs';
import type { Hold, Order, HoldStatus, OrderStatus } from './types';

const HOLD_TTL_SECONDS = 5 * 60; // 5 minutes
const ORDER_TTL_SECONDS = 5 * 60; // 5 minutes

// ==================== Seat Locking with Redis ====================

/**
 * Atomic seat locking using Redis
 * Key pattern: seat_lock:{showId}:{seatId}
 * Value: {userId}:{holdId}
 */

// Lua script for atomic multi-seat locking
const LOCK_SEATS_SCRIPT = `
local showId = ARGV[1]
local userId = ARGV[2]
local holdId = ARGV[3]
local ttl = tonumber(ARGV[4])
local numSeats = #KEYS

-- Phase 1: Check all seats are available
for i, seatId in ipairs(KEYS) do
    local key = "seat_lock:" .. showId .. ":" .. seatId
    local existing = redis.call('GET', key)
    if existing then
        local existingUserId = string.match(existing, "^([^:]+)")
        if existingUserId ~= userId then
            return {err = "CONFLICT", seat = seatId, holder = existingUserId}
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
`;

// Lua script for releasing seats
const RELEASE_SEATS_SCRIPT = `
local showId = ARGV[1]
local userId = ARGV[2]

for i, seatId in ipairs(KEYS) do
    local key = "seat_lock:" .. showId .. ":" .. seatId
    local existing = redis.call('GET', key)
    if existing then
        local existingUserId = string.match(existing, "^([^:]+)")
        if existingUserId == userId then
            redis.call('DEL', key)
        end
    end
end

return {ok = true}
`;

export async function lockSeats(
  showId: string,
  userId: string,
  seatIds: string[],
  holdId: string
): Promise<{ success: boolean; error?: string; conflictingSeat?: string }> {
  try {
    const result = await redis.eval(
      LOCK_SEATS_SCRIPT,
      seatIds.length,
      ...seatIds,
      showId,
      userId,
      holdId,
      HOLD_TTL_SECONDS.toString()
    ) as { ok?: boolean; err?: string; seat?: string };

    if (result.err === 'CONFLICT') {
      return {
        success: false,
        error: `Seat ${result.seat} is already taken`,
        conflictingSeat: result.seat
      };
    }

    return { success: true };
  } catch (error) {
    console.error('Redis lock error:', error);
    return { success: false, error: 'Failed to lock seats' };
  }
}

export async function releaseSeats(
  showId: string,
  userId: string,
  seatIds: string[]
): Promise<void> {
  try {
    await redis.eval(
      RELEASE_SEATS_SCRIPT,
      seatIds.length,
      ...seatIds,
      showId,
      userId
    );
  } catch (error) {
    console.error('Redis release error:', error);
  }
}

export async function getLockedSeatsForShow(showId: string): Promise<string[]> {
  const pattern = `seat_lock:${showId}:*`;
  const keys = await redis.keys(pattern);

  return keys.map(key => {
    const parts = key.split(':');
    return parts[parts.length - 1]!;
  });
}

// ==================== Hold Management ====================

export async function createHold(
  showId: string,
  userId: string,
  seatIds: string[],
  quantity: number
): Promise<{ hold?: Hold; error?: string }> {
  const holdId = crypto.randomUUID();

  // First, try to lock seats in Redis
  const lockResult = await lockSeats(showId, userId, seatIds, holdId);

  if (!lockResult.success) {
    return { error: lockResult.error };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + HOLD_TTL_SECONDS * 1000);

  // Store hold metadata in Redis (for fast lookups)
  const hold: Hold = {
    holdId,
    showId,
    userId,
    seatIds,
    quantity,
    status: 'HELD',
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  await redis.setex(
    `hold:${holdId}`,
    HOLD_TTL_SECONDS,
    JSON.stringify(hold)
  );

  return { hold };
}

export async function getHold(holdId: string): Promise<Hold | null> {
  const data = await redis.get(`hold:${holdId}`);

  if (!data) {
    return null;
  }

  const hold = JSON.parse(data) as Hold;

  // Check if expired
  if (new Date(hold.expiresAt) < new Date()) {
    hold.status = 'EXPIRED';
  }

  return hold;
}

export async function releaseHold(
  holdId: string,
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const hold = await getHold(holdId);

  if (!hold) {
    return { success: false, error: 'Hold not found' };
  }

  if (hold.userId !== userId) {
    return { success: false, error: 'Unauthorized' };
  }

  // Release seats in Redis
  await releaseSeats(hold.showId, userId, hold.seatIds);

  // Delete hold metadata
  await redis.del(`hold:${holdId}`);

  return { success: true };
}

// ==================== Order Management (PostgreSQL) ====================

export async function createOrder(
  holdId: string,
  userId: string,
  customer: { name: string; email: string; phone: string }
): Promise<{ order?: Order; error?: string }> {
  const hold = await getHold(holdId);

  if (!hold) {
    return { error: 'Hold not found or expired' };
  }

  if (hold.userId !== userId) {
    return { error: 'Unauthorized' };
  }

  if (hold.status !== 'HELD') {
    return { error: `Cannot create order from hold with status: ${hold.status}` };
  }

  // Get show price from database
  const showResult = await pool.query(
    'SELECT price FROM shows WHERE show_id = $1',
    [hold.showId]
  );

  if (showResult.rows.length === 0) {
    return { error: 'Show not found' };
  }

  const price = showResult.rows[0].price;
  const amount = price * hold.quantity;
  const orderId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ORDER_TTL_SECONDS * 1000);

  // Insert order into PostgreSQL
  const insertResult = await pool.query(
    `INSERT INTO orders (
      order_id, user_id, show_id, seat_ids,
      customer_name, customer_email, customer_phone,
      amount, status, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      orderId,
      userId,
      hold.showId,
      hold.seatIds,
      customer.name,
      customer.email,
      customer.phone,
      amount,
      'PAYMENT_PENDING',
      expiresAt,
    ]
  );

  const orderRow = insertResult.rows[0];

  const order: Order = {
    orderId: orderRow.order_id,
    holdId,
    userId,
    showId: hold.showId,
    movieId: '', // Will be populated from join
    theatreId: '', // Will be populated from join
    seatIds: hold.seatIds,
    customer,
    amount,
    status: 'PAYMENT_PENDING',
    createdAt: orderRow.created_at,
    expiresAt: orderRow.expires_at,
  };

  // Send notification to SQS
  await sendNotification('order.created', {
    orderId,
    userId,
    showId: hold.showId,
    amount,
  });

  return { order };
}

export async function getOrder(orderId: string): Promise<Order | null> {
  const result = await pool.query(
    `SELECT o.*, s.movie_id, s.theatre_id
     FROM orders o
     JOIN shows s ON o.show_id = s.show_id
     WHERE o.order_id = $1`,
    [orderId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  // Check if expired
  let status = row.status;
  if (status === 'PAYMENT_PENDING' && new Date(row.expires_at) < new Date()) {
    status = 'EXPIRED';
    await pool.query(
      'UPDATE orders SET status = $1 WHERE order_id = $2',
      ['EXPIRED', orderId]
    );
  }

  return {
    orderId: row.order_id,
    holdId: '', // Not stored in DB
    userId: row.user_id,
    showId: row.show_id,
    movieId: row.movie_id,
    theatreId: row.theatre_id,
    seatIds: row.seat_ids,
    customer: {
      name: row.customer_name,
      email: row.customer_email,
      phone: row.customer_phone,
    },
    amount: parseFloat(row.amount),
    status,
    ticketCode: row.ticket_code,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export async function confirmOrderPayment(
  orderId: string,
  userId: string
): Promise<{ order?: Order; error?: string }> {
  const order = await getOrder(orderId);

  if (!order) {
    return { error: 'Order not found' };
  }

  if (order.userId !== userId) {
    return { error: 'Unauthorized' };
  }

  if (order.status !== 'PAYMENT_PENDING') {
    return { error: `Cannot confirm payment for order with status: ${order.status}` };
  }

  const ticketCode = `BMS-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  await pool.query(
    `UPDATE orders
     SET status = 'CONFIRMED', ticket_code = $1, confirmed_at = NOW()
     WHERE order_id = $2`,
    [ticketCode, orderId]
  );

  // Make seats permanently booked (remove from Redis, add to DB)
  // In production, you'd also update a seats table

  // Send confirmation notification
  await sendNotification('order.confirmed', {
    orderId,
    userId,
    ticketCode,
    email: order.customer.email,
    phone: order.customer.phone,
  });

  return {
    order: {
      ...order,
      status: 'CONFIRMED',
      ticketCode,
    },
  };
}
```

### Step 5.7: Update API Routes to Use Production Store

Update `src/app/api/v1/holds/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createHoldSchema } from "@/lib/schemas";
import { createHold } from "@/lib/productionStore"; // Changed import
import type { HoldResponse } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: { message: "Authentication required" } },
        { status: 401 }
      );
    }

    const body = await request.json();
    const parseResult = createHoldSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: {
            message: "Invalid request body",
            details: parseResult.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const { showId, seatIds, quantity } = parseResult.data;

    if (seatIds.length !== quantity) {
      return NextResponse.json(
        { error: { message: "Number of seats must match quantity" } },
        { status: 400 }
      );
    }

    const result = await createHold(showId, session.user.id, seatIds, quantity);

    if (result.error) {
      return NextResponse.json(
        { error: { message: result.error } },
        { status: 409 }
      );
    }

    const hold = result.hold!;
    const response: HoldResponse = {
      holdId: hold.holdId,
      showId: hold.showId,
      seatIds: hold.seatIds,
      status: hold.status,
      expiresAt: hold.expiresAt,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Error creating hold:", error);
    return NextResponse.json(
      { error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}
```

---

## Phase 6: Containerize Your App (Docker)

### Step 6.1: Create Dockerfile

Create `Dockerfile` in project root:

```dockerfile
# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --only=production

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# Set environment for build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# Stage 3: Runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy necessary files
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
```

### Step 6.2: Update next.config.js for Standalone Output

```javascript
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  output: 'standalone', // Required for Docker
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
};

export default config;
```

### Step 6.3: Create .dockerignore

```
node_modules
.next
.git
*.md
.env*
Dockerfile
docker-compose.yml
```

### Step 6.4: Build and Test Docker Image Locally

```bash
# Build the image
docker build -t bms-clone:latest .

# Run locally to test
docker run -p 3000:3000 \
  -e DATABASE_HOST=host.docker.internal \
  -e DATABASE_PORT=5432 \
  -e DATABASE_NAME=bms_db \
  -e DATABASE_USER=postgres \
  -e DATABASE_PASSWORD=yourpassword \
  -e REDIS_HOST=host.docker.internal \
  -e REDIS_PORT=6379 \
  bms-clone:latest
```

---

## Phase 7: Set Up ECR (Container Registry)

### Step 7.1: Create ECR Repository

```bash
# Create repository
aws ecr create-repository \
  --repository-name bms-clone \
  --image-scanning-configuration scanOnPush=true \
  --region ap-south-1

# Note the repository URI
# Example: 123456789.dkr.ecr.ap-south-1.amazonaws.com/bms-clone
```

### Step 7.2: Push Docker Image to ECR

```bash
# Get login token
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin 123456789.dkr.ecr.ap-south-1.amazonaws.com

# Tag your image
docker tag bms-clone:latest 123456789.dkr.ecr.ap-south-1.amazonaws.com/bms-clone:latest

# Push to ECR
docker push 123456789.dkr.ecr.ap-south-1.amazonaws.com/bms-clone:latest
```

---

## Phase 8: Set Up ECS Fargate

### Step 8.1: Create ECS Cluster

```bash
aws ecs create-cluster \
  --cluster-name bms-cluster \
  --capacity-providers FARGATE FARGATE_SPOT \
  --default-capacity-provider-strategy capacityProvider=FARGATE,weight=1
```

### Step 8.2: Create Task Execution Role

Create IAM role that ECS uses to pull images and write logs:

```bash
# Create trust policy
cat > ecs-trust-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ecs-tasks.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

# Create role
aws iam create-role \
  --role-name ecsTaskExecutionRole \
  --assume-role-policy-document file://ecs-trust-policy.json

# Attach policy
aws iam attach-role-policy \
  --role-name ecsTaskExecutionRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
```

### Step 8.3: Create Task Definition

Create `task-definition.json`:

```json
{
  "family": "bms-task",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::123456789:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "bms-container",
      "image": "123456789.dkr.ecr.ap-south-1.amazonaws.com/bms-clone:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {"name": "NODE_ENV", "value": "production"},
        {"name": "DATABASE_HOST", "value": "bms-database.xxx.rds.amazonaws.com"},
        {"name": "DATABASE_PORT", "value": "5432"},
        {"name": "DATABASE_NAME", "value": "bms_db"},
        {"name": "REDIS_HOST", "value": "bms-redis.xxx.cache.amazonaws.com"},
        {"name": "REDIS_PORT", "value": "6379"},
        {"name": "SQS_QUEUE_URL", "value": "https://sqs.ap-south-1.amazonaws.com/xxx/bms-notifications-queue"}
      ],
      "secrets": [
        {
          "name": "DATABASE_USER",
          "valueFrom": "arn:aws:secretsmanager:ap-south-1:xxx:secret:bms/db-credentials:username::"
        },
        {
          "name": "DATABASE_PASSWORD",
          "valueFrom": "arn:aws:secretsmanager:ap-south-1:xxx:secret:bms/db-credentials:password::"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/bms-task",
          "awslogs-region": "ap-south-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:3000/api/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3
      }
    }
  ]
}
```

### Step 8.4: Register Task Definition

```bash
aws ecs register-task-definition --cli-input-json file://task-definition.json
```

### Step 8.5: Create ECS Security Group

```bash
aws ec2 create-security-group \
  --group-name bms-ecs-sg \
  --description "Security group for BMS ECS tasks" \
  --vpc-id vpc-xxx

# Allow inbound from ALB
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxx \
  --protocol tcp \
  --port 3000 \
  --source-group sg-alb-xxx  # ALB security group
```

### Step 8.6: Create ECS Service

```bash
aws ecs create-service \
  --cluster bms-cluster \
  --service-name bms-service \
  --task-definition bms-task:1 \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-private-1,subnet-private-2],securityGroups=[sg-ecs-xxx],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:xxx,containerName=bms-container,containerPort=3000"
```

---

## Phase 9: Set Up Application Load Balancer

### Step 9.1: Create ALB Security Group

```bash
aws ec2 create-security-group \
  --group-name bms-alb-sg \
  --description "Security group for BMS ALB" \
  --vpc-id vpc-xxx

# Allow HTTP/HTTPS from internet
aws ec2 authorize-security-group-ingress \
  --group-id sg-xxx \
  --protocol tcp \
  --port 80 \
  --cidr 0.0.0.0/0

aws ec2 authorize-security-group-ingress \
  --group-id sg-xxx \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0
```

### Step 9.2: Create Target Group

```bash
aws elbv2 create-target-group \
  --name bms-target-group \
  --protocol HTTP \
  --port 3000 \
  --vpc-id vpc-xxx \
  --target-type ip \
  --health-check-path /api/health \
  --health-check-interval-seconds 30 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3
```

### Step 9.3: Create Application Load Balancer

```bash
aws elbv2 create-load-balancer \
  --name bms-alb \
  --subnets subnet-public-1 subnet-public-2 \
  --security-groups sg-alb-xxx \
  --scheme internet-facing \
  --type application
```

### Step 9.4: Create Listener

```bash
aws elbv2 create-listener \
  --load-balancer-arn arn:aws:elasticloadbalancing:xxx:xxx:loadbalancer/app/bms-alb/xxx \
  --protocol HTTP \
  --port 80 \
  --default-actions Type=forward,TargetGroupArn=arn:aws:elasticloadbalancing:xxx:xxx:targetgroup/bms-target-group/xxx
```

---

## Phase 10: Set Up API Gateway

### Step 10.1: Create HTTP API

```bash
aws apigatewayv2 create-api \
  --name bms-api \
  --protocol-type HTTP \
  --cors-configuration AllowOrigins="*",AllowMethods="*",AllowHeaders="*"
```

### Step 10.2: Create VPC Link

```bash
aws apigatewayv2 create-vpc-link \
  --name bms-vpc-link \
  --subnet-ids subnet-private-1 subnet-private-2 \
  --security-group-ids sg-xxx
```

### Step 10.3: Create Integration

```bash
aws apigatewayv2 create-integration \
  --api-id xxx \
  --integration-type HTTP_PROXY \
  --integration-uri arn:aws:elasticloadbalancing:xxx:xxx:listener/app/bms-alb/xxx/xxx \
  --integration-method ANY \
  --connection-type VPC_LINK \
  --connection-id xxx \
  --payload-format-version 1.0
```

### Step 10.4: Create Routes

```bash
# Catch-all route
aws apigatewayv2 create-route \
  --api-id xxx \
  --route-key 'ANY /{proxy+}' \
  --target integrations/xxx
```

### Step 10.5: Create Stage and Deploy

```bash
aws apigatewayv2 create-stage \
  --api-id xxx \
  --stage-name prod \
  --auto-deploy
```

---

## Phase 11: Environment Variables & Secrets

### Step 11.1: Store Secrets in Secrets Manager

```bash
# Store database credentials
aws secretsmanager create-secret \
  --name bms/db-credentials \
  --secret-string '{"username":"postgres","password":"your-secure-password"}'

# Store Auth.js secret
aws secretsmanager create-secret \
  --name bms/auth-secret \
  --secret-string '{"secret":"your-nextauth-secret"}'
```

### Step 11.2: Create .env.production

```env
# Database
DATABASE_HOST=bms-database.xxx.ap-south-1.rds.amazonaws.com
DATABASE_PORT=5432
DATABASE_NAME=bms_db

# Redis
REDIS_HOST=bms-redis.xxx.cache.amazonaws.com
REDIS_PORT=6379

# SQS
SQS_QUEUE_URL=https://sqs.ap-south-1.amazonaws.com/xxx/bms-notifications-queue
AWS_REGION=ap-south-1

# Auth
NEXTAUTH_URL=https://your-api-gateway-url.execute-api.ap-south-1.amazonaws.com
NEXTAUTH_SECRET=your-secret

# App
NEXT_PUBLIC_APP_URL=https://your-api-gateway-url.execute-api.ap-south-1.amazonaws.com
```

---

## Phase 12: Testing & Monitoring

### Step 12.1: Create Health Check Endpoint

Create `src/app/api/health/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import redis from '@/lib/redis';

export async function GET() {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      database: 'unknown',
      redis: 'unknown',
    },
  };

  try {
    // Check database
    await pool.query('SELECT 1');
    health.services.database = 'healthy';
  } catch (error) {
    health.services.database = 'unhealthy';
    health.status = 'degraded';
  }

  try {
    // Check Redis
    await redis.ping();
    health.services.redis = 'healthy';
  } catch (error) {
    health.services.redis = 'unhealthy';
    health.status = 'degraded';
  }

  const statusCode = health.status === 'healthy' ? 200 : 503;
  return NextResponse.json(health, { status: statusCode });
}
```

### Step 12.2: Set Up CloudWatch Alarms

```bash
# High CPU alarm
aws cloudwatch put-metric-alarm \
  --alarm-name bms-high-cpu \
  --alarm-description "ECS CPU > 80%" \
  --metric-name CPUUtilization \
  --namespace AWS/ECS \
  --statistic Average \
  --period 300 \
  --threshold 80 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=ClusterName,Value=bms-cluster Name=ServiceName,Value=bms-service \
  --evaluation-periods 2 \
  --alarm-actions arn:aws:sns:xxx:xxx:bms-alerts
```

### Step 12.3: Set Up Auto Scaling

```bash
# Register scalable target
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/bms-cluster/bms-service \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 2 \
  --max-capacity 10

# Create scaling policy
aws application-autoscaling put-scaling-policy \
  --service-namespace ecs \
  --resource-id service/bms-cluster/bms-service \
  --scalable-dimension ecs:service:DesiredCount \
  --policy-name bms-cpu-scaling \
  --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{
    "TargetValue": 70.0,
    "PredefinedMetricSpecification": {
      "PredefinedMetricType": "ECSServiceAverageCPUUtilization"
    },
    "ScaleOutCooldown": 60,
    "ScaleInCooldown": 120
  }'
```

---

## Cost Estimation

### Free Tier (12 months)

| Service | Free Tier | Your Usage | Cost |
|---------|-----------|------------|------|
| RDS (db.t3.micro) | 750 hrs/month | 720 hrs | $0 |
| ElastiCache (cache.t3.micro) | 750 hrs/month | 720 hrs | $0 |
| ECS Fargate | None | 2 tasks | ~$30/month |
| ALB | 750 hrs + 15 LCU | Low traffic | ~$20/month |
| API Gateway | 1M requests | Low traffic | ~$1/month |
| Data Transfer | 100 GB out | Low traffic | ~$5/month |
| **Total (Free Tier)** | | | **~$56/month** |

### Production (After Free Tier)

| Service | Specification | Monthly Cost |
|---------|--------------|--------------|
| RDS (db.t3.small) | Multi-AZ | ~$50 |
| ElastiCache (cache.t3.small) | 1 node | ~$25 |
| ECS Fargate | 2-10 tasks | ~$50-200 |
| ALB | Based on LCU | ~$30 |
| API Gateway | Per request | ~$10 |
| **Total (Production)** | | **~$165-315/month** |

---

## Quick Reference Commands

```bash
# Deploy new version
docker build -t bms-clone:v2 .
docker tag bms-clone:v2 123456789.dkr.ecr.ap-south-1.amazonaws.com/bms-clone:v2
docker push 123456789.dkr.ecr.ap-south-1.amazonaws.com/bms-clone:v2
aws ecs update-service --cluster bms-cluster --service bms-service --force-new-deployment

# Check logs
aws logs tail /ecs/bms-task --follow

# Check service status
aws ecs describe-services --cluster bms-cluster --services bms-service

# Scale manually
aws ecs update-service --cluster bms-cluster --service bms-service --desired-count 4

# Connect to RDS (from EC2 bastion)
psql -h bms-database.xxx.rds.amazonaws.com -U postgres -d bms_db
```

---

## Next Steps After Deployment

1. **Add CloudFront CDN** for static assets and API caching
2. **Set up Route 53** for custom domain
3. **Add SSL certificate** via ACM
4. **Implement CI/CD** with GitHub Actions or CodePipeline
5. **Add WAF** for security
6. **Set up multi-region** for global scaling

---

## Troubleshooting

### Common Issues

1. **ECS tasks keep stopping**
   - Check CloudWatch logs: `/ecs/bms-task`
   - Verify security groups allow traffic
   - Check health check endpoint works

2. **Can't connect to RDS**
   - Verify security group allows port 5432
   - Check VPC subnets are correct
   - Ensure ECS tasks are in same VPC

3. **Redis connection timeout**
   - Check security group allows port 6379
   - Verify ElastiCache subnet group includes ECS subnets

4. **504 Gateway Timeout**
   - Increase ALB idle timeout
   - Check ECS task health
   - Verify target group health check
