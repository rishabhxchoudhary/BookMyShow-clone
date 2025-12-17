# BMS Lambda Functions

This directory contains the AWS Lambda functions for the BookMyShow clone backend services.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    BMS LAMBDA ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  API Gateway → Lambda Functions → RDS + Redis + SQS            │
│                                                                 │
│  Functions:                                                     │
│  • bms-movies-service    (GET movies, shows)                   │
│  • bms-seats-service     (seat locking, holds)                 │
│  • bms-orders-service    (order creation, payment)             │
│  • bms-events-processor  (SQS event handling)                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Prerequisites

1. **AWS CLI** configured with appropriate permissions
2. **SAM CLI** installed
3. **Docker** for container builds
4. **RDS PostgreSQL** instance running
5. **ElastiCache Redis** cluster running
6. **SQS queues** created

## Setup

### 1. Environment Variables

Copy the example environment file:
```bash
cp env.json.example env.json
```

Update `env.json` with your actual values:
- RDS endpoint and credentials
- Redis endpoint
- SQS queue URLs

### 2. SAM Configuration

Copy the SAM config template:
```bash
cp samconfig.toml.example samconfig.toml
```

Update with your AWS settings:
- S3 bucket for deployments
- AWS region
- Stack name
- Parameter values

## Build and Deploy

### Build
```bash
# Make build script executable
chmod +x build.sh

# Build Lambda functions
./build.sh
```

### Deploy
```bash
# Make deploy script executable
chmod +x deploy.sh

# Deploy to AWS
./deploy.sh
```

### First-time deployment
If you don't have `samconfig.toml`, run:
```bash
sam deploy --guided
```

## Local Testing

### Start API Gateway locally
```bash
# Start all functions
sam local start-api --env-vars env.json

# Test specific function
sam local invoke MoviesFunction --event events/get-movies.json
```

### Test individual Lambda functions
```bash
# Test movies service
curl http://localhost:3000/movies

# Test movie details
curl http://localhost:3000/movies/{movie-id}

# Test seat availability
curl http://localhost:3000/shows/{show-id}/seatmap
```

## API Endpoints

Once deployed, your API Gateway will expose:

### Movies Service
- `GET /movies` - List movies
- `GET /movies/{movieId}` - Movie details
- `GET /movies/{movieId}/shows` - Movie shows by date

### Seats Service
- `GET /shows/{showId}/seatmap` - Seat availability
- `POST /holds` - Create seat hold
- `GET /holds/{holdId}` - Get hold status
- `PUT /holds/{holdId}` - Update hold
- `DELETE /holds/{holdId}` - Release hold

### Orders Service
- `POST /orders` - Create order
- `GET /orders/{orderId}` - Get order details
- `POST /orders/{orderId}/confirm-payment` - Confirm payment

## Environment Variables

| Variable | Description | Example |
|----------|-------------|----------|
| `DATABASE_HOST` | RDS PostgreSQL endpoint | `bms-db.xyz.us-east-1.rds.amazonaws.com` |
| `DATABASE_PORT` | Database port | `5432` |
| `DATABASE_NAME` | Database name | `bms_production` |
| `DATABASE_USER` | Database username | `bms_user` |
| `DATABASE_PASSWORD` | Database password | `SecurePassword123!` |
| `REDIS_HOST` | ElastiCache endpoint | `bms-redis.xyz.cache.amazonaws.com` |
| `REDIS_PORT` | Redis port | `6379` |
| `SQS_QUEUE_URL` | SQS events queue URL | `https://sqs.us-east-1.amazonaws.com/123/bms-events` |
| `HOLD_TTL_SECONDS` | Seat hold duration | `300` (5 minutes) |
| `ORDER_TTL_SECONDS` | Payment timeout | `300` (5 minutes) |

## Monitoring

### CloudWatch Logs
Each Lambda function creates its own log group:
- `/aws/lambda/bms-movies-service`
- `/aws/lambda/bms-seats-service`
- `/aws/lambda/bms-orders-service`
- `/aws/lambda/bms-events-processor`

### CloudWatch Metrics
Monitor:
- Lambda duration
- Error rates
- Invocation counts
- Throttles

### Custom Metrics
The application logs structured JSON for:
- Business events (holds, orders)
- Performance metrics
- Error tracking

## Troubleshooting

### Common Issues

1. **Database Connection Failed**
   - Check RDS security groups allow Lambda access
   - Verify DATABASE_* environment variables
   - Ensure RDS is in same VPC or accessible

2. **Redis Connection Failed**
   - Check ElastiCache security groups
   - Verify REDIS_* environment variables
   - Ensure Redis is accessible from Lambda

3. **SQS Permission Denied**
   - Check Lambda execution role has SQS permissions
   - Verify SQS_QUEUE_URL is correct

### Debug Locally
```bash
# Run with debug logging
SAM_CLI_DEBUG=1 sam local start-api --env-vars env.json

# Test specific function with event
sam local invoke SeatsFunction --event events/create-hold.json --env-vars env.json
```

### View Logs
```bash
# Stream CloudWatch logs
sam logs --stack-name bms-lambda-stack --tail

# View specific function logs
aws logs tail /aws/lambda/bms-movies-service --follow
```

## Production Considerations

1. **Security**
   - Store secrets in AWS Secrets Manager
   - Use VPC endpoints for RDS/Redis
   - Enable encryption in transit/at rest

2. **Performance**
   - Use connection pooling for databases
   - Implement proper caching strategies
   - Monitor cold starts

3. **Reliability**
   - Set up dead letter queues
   - Implement circuit breakers
   - Add retry logic with exponential backoff

4. **Monitoring**
   - Set up CloudWatch alarms
   - Implement distributed tracing
   - Use structured logging

## Cost Optimization

- Use provisioned concurrency for critical functions
- Right-size memory allocation
- Implement efficient connection pooling
- Use reserved capacity for RDS/Redis
- Monitor and optimize Lambda duration