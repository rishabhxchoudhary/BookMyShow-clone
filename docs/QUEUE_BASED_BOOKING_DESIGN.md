# Queue-Based Seat Booking Architecture

> **Status**: Planning Document (Not Implemented)
> **Author**: Development Team
> **Last Updated**: December 2025

## Overview

This document outlines a queue-based architecture for handling high-concurrency seat bookings. This approach is recommended when scaling beyond 50,000+ concurrent users or for handling "flash sale" scenarios (e.g., popular movie premieres).

## Current Architecture vs Queue-Based

### Current: Redis Atomic Locking
```
User A ──┐
         ├──► Redis Lua Script ──► Success/Fail (immediate)
User B ──┘    (atomic check+lock)
```
- **Capacity**: ~10,000-50,000 concurrent users
- **Latency**: ~50-100ms
- **Limitation**: Single Redis bottleneck

### Proposed: Queue-Based Serial Processing
```
User A ──┐                     ┌──────────────┐
         ├──► SQS FIFO Queue ──► Single Worker ──► Process serially
User B ──┘    (per show)       │   per show   │
User C ──┘                     └──────────────┘
                                      │
                                      ▼
                               Notify via WebSocket/Push
```
- **Capacity**: Unlimited concurrent requests
- **Latency**: ~1-5 seconds (async)
- **Advantage**: Zero race conditions, fair ordering

---

## Architecture Design

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         QUEUE-BASED BOOKING FLOW                         │
└─────────────────────────────────────────────────────────────────────────┘

1. User Request
   │
   ▼
┌─────────────────────┐
│   API Gateway       │
│   /holds (POST)     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐     ┌─────────────────────┐
│  HoldsFunction      │────►│  SQS FIFO Queue     │
│  (Enqueue Request)  │     │  (per show or       │
│                     │     │   MessageGroupId)   │
└──────────┬──────────┘     └──────────┬──────────┘
           │                           │
           ▼                           ▼
┌─────────────────────┐     ┌─────────────────────┐
│  Return to User:    │     │  BookingWorker      │
│  {                  │     │  Lambda (FIFO)      │
│    requestId: xxx,  │     │                     │
│    status: QUEUED,  │     │  - Process 1 by 1   │
│    position: 47     │     │  - Check seats      │
│  }                  │     │  - Book or reject   │
└─────────────────────┘     └──────────┬──────────┘
                                       │
                                       ▼
                            ┌─────────────────────┐
                            │  Notify User        │
                            │  - WebSocket        │
                            │  - Push notification│
                            │  - Polling endpoint │
                            └─────────────────────┘
```

### Components

#### 1. SQS FIFO Queue
- **Queue Type**: FIFO (First-In-First-Out)
- **Message Group**: `showId` (ensures per-show ordering)
- **Deduplication**: `requestId` (prevents duplicate processing)
- **Visibility Timeout**: 30 seconds
- **Message Retention**: 1 hour

#### 2. Booking Worker Lambda
- **Trigger**: SQS FIFO Queue
- **Concurrency**: 1 per MessageGroupId (per show)
- **Processing**: Serial, one request at a time per show
- **Timeout**: 30 seconds

#### 3. Notification Service
- **Options**: WebSocket (API Gateway), Push Notifications, Polling
- **Recommended**: WebSocket for real-time UX

---

## Database Schema Changes

### New Table: `booking_requests`

```sql
CREATE TABLE booking_requests (
    request_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       VARCHAR(255) NOT NULL,
    show_id       UUID NOT NULL REFERENCES shows(show_id),
    seat_ids      TEXT[] NOT NULL,
    status        VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
                  -- QUEUED: In queue, waiting
                  -- PROCESSING: Being processed
                  -- SUCCESS: Seats booked
                  -- FAILED: Seats unavailable
                  -- EXPIRED: Request timed out
    queue_position INTEGER,
    result_message TEXT,
    hold_id       UUID,              -- Created on success
    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at  TIMESTAMP WITH TIME ZONE,
    expires_at    TIMESTAMP WITH TIME ZONE  -- Request expiry (e.g., 5 min)
);

CREATE INDEX idx_booking_requests_user ON booking_requests(user_id, created_at DESC);
CREATE INDEX idx_booking_requests_status ON booking_requests(show_id, status);
```

---

## API Changes

### 1. Create Hold (Modified)

**Endpoint**: `POST /holds`

**Current Response** (Synchronous):
```json
{
  "holdId": "xxx",
  "status": "HELD",
  "seatIds": ["A1", "A2"]
}
```

**New Response** (Asynchronous):
```json
{
  "requestId": "abc-123",
  "status": "QUEUED",
  "queuePosition": 47,
  "estimatedWaitSeconds": 30,
  "message": "Your request is being processed"
}
```

### 2. Check Request Status (New)

**Endpoint**: `GET /booking-requests/{requestId}`

**Response**:
```json
{
  "requestId": "abc-123",
  "status": "SUCCESS",
  "holdId": "hold-xxx",
  "seatIds": ["A1", "A2"],
  "expiresAt": "2025-12-17T16:00:00Z"
}
```

Or if failed:
```json
{
  "requestId": "abc-123",
  "status": "FAILED",
  "message": "Seats A1 no longer available",
  "availableAlternatives": ["A3", "A4", "B1", "B2"]
}
```

### 3. WebSocket Connection (New)

**Endpoint**: `wss://api.../ws?userId={userId}`

**Server Push Message**:
```json
{
  "type": "BOOKING_RESULT",
  "requestId": "abc-123",
  "status": "SUCCESS",
  "holdId": "hold-xxx"
}
```

---

## Implementation Plan

### Phase 1: Infrastructure Setup (Day 1)
- [ ] Create SQS FIFO Queue with MessageGroupId support
- [ ] Create `booking_requests` table
- [ ] Set up CloudWatch alarms for queue depth

### Phase 2: Backend Changes (Day 2-3)
- [ ] Modify `holds.py` to enqueue instead of direct processing
- [ ] Create `booking_worker.py` Lambda for queue processing
- [ ] Add `GET /booking-requests/{requestId}` endpoint
- [ ] Update SAM template with new resources

### Phase 3: Notification System (Day 3-4)
- [ ] Set up API Gateway WebSocket API
- [ ] Create connection management (DynamoDB for connection IDs)
- [ ] Implement push notification on booking result

### Phase 4: Frontend Changes (Day 4-5)
- [ ] Update `SeatSelectorLambda.tsx` for async flow
- [ ] Add WebSocket client for real-time updates
- [ ] Implement polling fallback
- [ ] Add queue position UI component

### Phase 5: Testing & Rollout (Day 5-6)
- [ ] Load testing with Artillery/k6
- [ ] A/B rollout (feature flag)
- [ ] Monitor queue metrics
- [ ] Full rollout

---

## Code Examples

### 1. Enqueue Booking Request

```python
# holds.py - Modified create_hold function

import boto3
import json
import uuid

sqs = boto3.client('sqs')
BOOKING_QUEUE_URL = os.environ['BOOKING_QUEUE_URL']

def create_hold(body: str, user_id: str) -> Dict[str, Any]:
    """Enqueue hold request for async processing"""

    request_data = json.loads(body)
    show_id = request_data['showId']
    seat_ids = request_data['seatIds']

    # Generate unique request ID
    request_id = str(uuid.uuid4())

    # Quick validation (fast fail for obvious errors)
    show = db_service.get_show_by_id(show_id)
    if not show:
        return create_error_response(404, "Show not found")

    # Get queue position estimate
    queue_position = get_queue_position(show_id)

    # Enqueue the request
    sqs.send_message(
        QueueUrl=BOOKING_QUEUE_URL,
        MessageBody=json.dumps({
            'request_id': request_id,
            'user_id': user_id,
            'show_id': show_id,
            'seat_ids': seat_ids,
            'created_at': datetime.now(timezone.utc).isoformat()
        }),
        MessageGroupId=show_id,  # FIFO per show
        MessageDeduplicationId=request_id
    )

    # Store request in database for status tracking
    db_service.create_booking_request({
        'request_id': request_id,
        'user_id': user_id,
        'show_id': show_id,
        'seat_ids': seat_ids,
        'status': 'QUEUED',
        'queue_position': queue_position
    })

    return create_success_response({
        'requestId': request_id,
        'status': 'QUEUED',
        'queuePosition': queue_position,
        'estimatedWaitSeconds': queue_position * 2,  # ~2 sec per request
        'message': 'Your booking request is being processed'
    })
```

### 2. Booking Worker Lambda

```python
# booking_worker.py - New Lambda function

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Process booking requests from SQS FIFO queue"""

    for record in event['Records']:
        message = json.loads(record['body'])
        process_booking_request(message)

    return {'statusCode': 200}

def process_booking_request(message: Dict[str, Any]):
    """Process a single booking request (runs serially per show)"""

    request_id = message['request_id']
    user_id = message['user_id']
    show_id = message['show_id']
    seat_ids = message['seat_ids']

    # Update status to PROCESSING
    db_service.update_booking_request(request_id, {'status': 'PROCESSING'})

    try:
        # Check seat availability (no race condition - we're the only processor)
        confirmed_seats = db_service.get_confirmed_seats_for_show(show_id)
        unavailable = [s for s in seat_ids if s in confirmed_seats]

        if unavailable:
            # Seats taken - notify failure
            db_service.update_booking_request(request_id, {
                'status': 'FAILED',
                'result_message': f'Seats unavailable: {", ".join(unavailable)}',
                'processed_at': datetime.now(timezone.utc)
            })
            notify_user(user_id, request_id, 'FAILED', f'Seats {unavailable} unavailable')
            return

        # All seats available - create hold
        hold_id = str(uuid.uuid4())

        # Lock seats in Redis (still useful for seatmap display)
        redis_service.lock_seats_atomic(show_id, user_id, seat_ids, hold_id)

        # Store hold metadata
        hold_data = {
            'hold_id': hold_id,
            'show_id': show_id,
            'user_id': user_id,
            'seat_ids': seat_ids,
            'status': 'HELD',
            'expires_at': (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
        }
        redis_service.store_hold(hold_data)

        # Update request status
        db_service.update_booking_request(request_id, {
            'status': 'SUCCESS',
            'hold_id': hold_id,
            'processed_at': datetime.now(timezone.utc)
        })

        # Notify user of success
        notify_user(user_id, request_id, 'SUCCESS', hold_id=hold_id)

    except Exception as e:
        logger.error(f"Failed to process booking request: {e}")
        db_service.update_booking_request(request_id, {
            'status': 'FAILED',
            'result_message': 'Internal error, please try again',
            'processed_at': datetime.now(timezone.utc)
        })
        notify_user(user_id, request_id, 'FAILED', 'Internal error')

def notify_user(user_id: str, request_id: str, status: str, message: str = None, hold_id: str = None):
    """Notify user via WebSocket or store for polling"""

    # Option 1: WebSocket push
    connection_id = get_websocket_connection(user_id)
    if connection_id:
        send_websocket_message(connection_id, {
            'type': 'BOOKING_RESULT',
            'requestId': request_id,
            'status': status,
            'holdId': hold_id,
            'message': message
        })

    # Option 2: Store for polling (always do this as fallback)
    # The booking_requests table already has the status
```

### 3. SAM Template Additions

```yaml
# template.yaml additions

Resources:
  # FIFO Queue for booking requests
  BookingQueue:
    Type: AWS::SQS::Queue
    Properties:
      QueueName: bms-booking-queue.fifo
      FifoQueue: true
      ContentBasedDeduplication: false
      VisibilityTimeout: 30
      MessageRetentionPeriod: 3600  # 1 hour

  # Booking Worker Lambda
  BookingWorkerFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: bms-booking-worker
      Handler: handlers/booking_worker.lambda_handler
      Runtime: python3.11
      Timeout: 30
      MemorySize: 512
      ReservedConcurrentExecutions: 100  # Limit concurrent workers
      Events:
        SQSEvent:
          Type: SQS
          Properties:
            Queue: !GetAtt BookingQueue.Arn
            BatchSize: 1  # Process one at a time for FIFO ordering

  # WebSocket API for notifications
  BookingWebSocketApi:
    Type: AWS::ApiGatewayV2::Api
    Properties:
      Name: bms-booking-websocket
      ProtocolType: WEBSOCKET
      RouteSelectionExpression: "$request.body.action"
```

---

## Frontend Changes

### React Component Updates

```tsx
// SeatSelectorLambda.tsx - Modified booking flow

const [bookingStatus, setBookingStatus] = useState<'idle' | 'queued' | 'processing' | 'success' | 'failed'>('idle');
const [queuePosition, setQueuePosition] = useState<number | null>(null);
const [requestId, setRequestId] = useState<string | null>(null);

// WebSocket connection for real-time updates
useEffect(() => {
  const ws = new WebSocket(`wss://api.../ws?userId=${userId}`);

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'BOOKING_RESULT' && data.requestId === requestId) {
      if (data.status === 'SUCCESS') {
        setBookingStatus('success');
        // Navigate to order page with holdId
        router.push(`/order/${data.holdId}`);
      } else {
        setBookingStatus('failed');
        setError(data.message);
      }
    }
  };

  return () => ws.close();
}, [requestId]);

const handleBookSeats = async () => {
  setBookingStatus('queued');

  const response = await fetch('/api/v1/holds', {
    method: 'POST',
    body: JSON.stringify({ showId, seatIds, quantity: selectedSeats.length })
  });

  const data = await response.json();

  if (data.requestId) {
    setRequestId(data.requestId);
    setQueuePosition(data.queuePosition);
    // Now waiting for WebSocket notification...
  }
};

// UI for queue status
{bookingStatus === 'queued' && (
  <div className="text-center p-4 bg-yellow-50 rounded-lg">
    <div className="animate-pulse">Processing your request...</div>
    <p className="text-sm text-gray-600 mt-2">
      Queue position: {queuePosition}
    </p>
    <p className="text-xs text-gray-500">
      Estimated wait: {queuePosition * 2} seconds
    </p>
  </div>
)}
```

---

## Monitoring & Alerts

### CloudWatch Metrics

| Metric | Threshold | Alert |
|--------|-----------|-------|
| Queue Depth | > 1000 | Warning |
| Queue Depth | > 5000 | Critical |
| Message Age | > 60 seconds | Warning |
| Worker Errors | > 1% | Critical |
| Processing Time | > 5 seconds | Warning |

### Dashboard Queries

```sql
-- Queue backlog by show
SELECT show_id, COUNT(*) as pending
FROM booking_requests
WHERE status = 'QUEUED'
GROUP BY show_id
ORDER BY pending DESC;

-- Success rate
SELECT
  status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 2) as percentage
FROM booking_requests
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY status;
```

---

## Rollback Plan

If issues arise:
1. Feature flag: `QUEUE_BASED_BOOKING=false`
2. Direct processing fallback in `holds.py`
3. Queue draining Lambda to process remaining messages

---

## Cost Estimation

| Resource | Estimated Monthly Cost |
|----------|----------------------|
| SQS FIFO Queue | $5-20 (1M requests) |
| Worker Lambda | $10-50 (depends on volume) |
| WebSocket API | $5-20 |
| DynamoDB (connections) | $5-10 |
| **Total** | **$25-100/month** |

---

## References

- [AWS SQS FIFO Queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues.html)
- [API Gateway WebSocket APIs](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api.html)
- [Lambda with SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)

---

**This document is for planning purposes. Implementation should be done when scaling requirements exceed current Redis-based approach capacity (~50K concurrent users).**
