# 🧪 Comprehensive Test Cases - Seat Booking Edge Cases & Data Flow Analysis

## Test Case Overview

Based on code analysis, here are critical scenarios and their data flow through PostgreSQL `orders` table and Redis:

---

## 📊 Data Structure Summary

### PostgreSQL `orders` Table
```sql
CREATE TABLE orders (
    order_id       UUID PRIMARY KEY,
    user_id        VARCHAR(255) NOT NULL,
    show_id        UUID NOT NULL,
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
```

### Redis Data Structures
```
# Seat locks (TTL: 300s)
seat_lock:{showId}:{seatId} = "{userId}:{holdId}"

# Hold metadata (TTL: 300s) 
hold:{holdId} = {hold_data_json}

# Seat availability cache (TTL: 10s)
seatmap:{showId} = {availability_data_json}
```

---

## 🎯 Test Cases & Data Flow Analysis

### **Test Case 1: Normal Successful Booking**
**Scenario:** User selects seats → creates hold → creates order → pays successfully

| Step | Orders Table | Redis | Notes |
|------|-------------|-------|-------|
| 1. Create Hold | No entry | `seat_lock:show1:A1 = "user123:hold456"` <br> `hold:hold456 = {...}` | Seats locked atomically |
| 2. Create Order | `INSERT order123 status='PAYMENT_PENDING' expires_at=now+5min` | `hold:hold456` deleted <br> seat locks remain | Hold converted to order |
| 3. Confirm Payment | `UPDATE order123 status='CONFIRMED' ticket_code='BMS12345'` | `seat_lock:show1:A1` deleted | Seats permanently booked |

**Result:** ✅ Order confirmed, seats booked permanently

---

### **Test Case 2: User Abandons After Creating Order**
**Scenario:** User creates order but closes browser/app without paying

| Timeline | Orders Table | Redis | Impact |
|----------|-------------|-------|---------|
| T+0min | `INSERT order123 status='PAYMENT_PENDING' expires_at=T+5min` | `seat_lock:show1:A1 = "user123:hold456"` | Order created |
| T+5min | Order remains `PAYMENT_PENDING` | `seat_lock:show1:A1` **expires & deleted** | ⚠️ **CRITICAL ISSUE** |
| T+6min | Someone requests seatmap | Order still exists but seat lock gone | Seat appears available! |

**🚨 PROBLEM IDENTIFIED:**
- **Orders table:** Has `PAYMENT_PENDING` order with expired `expires_at`
- **Redis:** Seat lock expired and deleted automatically
- **Seat availability logic:** Only checks `status='CONFIRMED'` orders, not expired pending orders
- **Impact:** Seat becomes available for booking again, potential double-booking

**Current Seat Availability Query:**
```python
# In db_service.py:155
def get_confirmed_seats_for_show(self, show_id: str) -> List[str]:
    query = """
    SELECT seat_ids FROM orders 
    WHERE show_id = %s AND status = 'CONFIRMED'  # ⚠️ Ignores PAYMENT_PENDING
    """
```

---

### **Test Case 3: Payment Fails During Processing**
**Scenario:** User clicks pay, but payment gateway returns error

| Step | Orders Table | Redis | Issue |
|------|-------------|-------|--------|
| 1. Order Created | `status='PAYMENT_PENDING'` | Seat locks active | Normal state |
| 2. Payment Fails | Order remains `PAYMENT_PENDING` | Seat locks remain active | No cleanup mechanism |
| 3. TTL Expires (5min) | Order still exists | Seat locks **auto-expire** | Same issue as Test Case 2 |

**🚨 PROBLEM:** No failure handling for payment errors

---

### **Test Case 4: Hold Expires Before Order Creation**
**Scenario:** User selects seats but takes too long to fill order form

| Timeline | Orders Table | Redis | User Experience |
|----------|-------------|-------|------------------|
| T+0min | No entry | `hold:hold456` created with TTL=300s | Hold created |
| T+5min | No entry | `hold:hold456` **expires & deleted** | Hold expired |
| T+6min User submits order | No entry | No hold found | `404: Hold not found or expired` |

**✅ HANDLED CORRECTLY:** User gets clear error message

---

### **Test Case 5: Concurrent Booking Attempt**
**Scenario:** Two users try to book same seats simultaneously

| Timeline | User A | User B | Orders Table | Redis | Result |
|----------|--------|--------|-------------|-------|---------|
| T+0s | Creates hold A1 | - | - | `seat_lock:show1:A1 = "userA:holdA"` | A gets seat |
| T+1s | - | Tries hold A1 | - | Lock exists for userA | B gets `SEAT_TAKEN` error |
| T+30s | Creates order | - | `INSERT orderA PAYMENT_PENDING` | `hold:holdA` deleted | A has order |
| T+60s | Confirms payment | - | `UPDATE orderA CONFIRMED` | `seat_lock:show1:A1` deleted | ✅ A wins |

**✅ HANDLED CORRECTLY:** Atomic locking prevents race conditions

---

### **Test Case 6: Order Expires During Payment Processing**
**Scenario:** User initiates payment but payment takes longer than 5 minutes

| Timeline | Orders Table | Redis | Payment Gateway | Issue |
|----------|-------------|-------|-----------------|--------|
| T+0min | `INSERT order123 PAYMENT_PENDING expires_at=T+5min` | Seat locks active | Payment initiated | Normal |
| T+5min | Order exists but expired | Seat locks **expired** | Still processing | Seat now available! |
| T+7min | Same order | No locks | Payment succeeds | ⚠️ **DOUBLE BOOKING RISK** |

**🚨 CRITICAL PROBLEM:** Payment success after expiry can confirm an order for seats that are no longer locked

---

### **Test Case 7: Multiple Orders by Same User**
**Scenario:** User accidentally creates multiple orders for same show

| Step | Orders Table | Redis | Notes |
|------|-------------|-------|-------|
| 1. First Order | `INSERT order123 PAYMENT_PENDING seats=['A1','A2']` | Locks for A1,A2 | Normal |
| 2. User goes back, creates new order | `INSERT order456 PAYMENT_PENDING seats=['A3','A4']` | Locks for A3,A4 | Both orders exist |
| 3. TTL expires | Both orders remain | All locks expire | All seats become available |

**🚨 PROBLEM:** No cleanup of multiple pending orders per user

---

## 🔍 Current Seat Availability Logic Analysis

### How System Determines Booked Seats

**Step 1: Get Confirmed Orders (Permanent Bookings)**
```python
# seats.py:59 and holds.py:90
confirmed_seats = db_service.get_confirmed_seats_for_show(show_id)

# db_service.py:155-165
query = """
SELECT seat_ids FROM orders 
WHERE show_id = %s AND status = 'CONFIRMED'  # ⚠️ Only CONFIRMED orders
"""
```

**Step 2: Get Temporary Locks from Redis**
```python
# redis_service.py:165-180
locked_seats = redis_service.get_locked_seats_for_show(show_id)

pattern = f"seat_lock:{show_id}:*"
keys = self._client.keys(pattern)  # Get all active locks
```

**Step 3: Combine for Final Availability**
```python
# seats.py:65-71
unavailable_seats = list(set(confirmed_seats + permanently_unavailable))
# Note: locked_seats shown separately as "heldSeatIds"
```

### ⚠️ **CRITICAL GAP IDENTIFIED**

**The system DOES NOT check for:**
1. `PAYMENT_PENDING` orders that haven't expired
2. `PAYMENT_PENDING` orders that HAVE expired (should be marked EXPIRED)
3. Multiple pending orders per user

**This means:**
- When Redis locks expire (5 min TTL), seats with pending orders become available
- No background job cleans up expired orders
- No mechanism prevents double-booking of expired pending orders

---

## 🚨 Critical Issues Summary

### **Issue #1: Expired Orders Not Handled**
- **Problem:** `PAYMENT_PENDING` orders with `expires_at < NOW()` are not considered in seat availability
- **Impact:** Seats become available while order still exists
- **Risk:** Double booking possible

### **Issue #2: No Order Expiry Background Job**
- **Problem:** Orders with status `PAYMENT_PENDING` never get updated to `EXPIRED`
- **Impact:** Database fills with stale orders
- **Risk:** Data inconsistency

### **Issue #3: Payment Confirmation After Expiry**
- **Problem:** `confirm_payment` doesn't re-check seat availability
- **Impact:** Can confirm order for seats that might be taken by someone else
- **Risk:** Overselling tickets

### **Issue #4: Multiple Pending Orders Per User**
- **Problem:** No prevention of multiple active orders per user per show
- **Impact:** Resource waste, confusing UX
- **Risk:** Accidental double booking by same user

---

## 🛠️ Recommended Fixes

### **Fix #1: Enhanced Seat Availability Check**
```python
def get_unavailable_seats_for_show(self, show_id: str) -> List[str]:
    """Get all unavailable seats including pending orders"""
    query = """
    SELECT seat_ids FROM orders 
    WHERE show_id = %s 
    AND (status = 'CONFIRMED' 
         OR (status = 'PAYMENT_PENDING' AND expires_at > NOW()))
    """
    # This includes both confirmed and non-expired pending orders
```

### **Fix #2: Background Expiry Job**
```python
def expire_old_orders():
    """Background job to mark expired orders"""
    query = """
    UPDATE orders 
    SET status = 'EXPIRED' 
    WHERE status = 'PAYMENT_PENDING' 
    AND expires_at < NOW()
    """
```

### **Fix #3: Pre-Payment Validation**
```python
def confirm_payment(order_id: str, user_id: str):
    # Before confirming, re-check seat availability
    current_confirmed = get_confirmed_seats_for_show(show_id)
    if any(seat in current_confirmed for seat in order_seats):
        return error("Seats no longer available")
    # Then proceed with confirmation
```

### **Fix #4: User Order Limits**
```python
def create_order(hold_data, user_id):
    # Check existing pending orders
    existing_orders = get_pending_orders_for_user(user_id, show_id)
    if existing_orders:
        return error("You already have a pending order for this show")
```

This analysis reveals significant data consistency issues in the current implementation that could lead to double bookings and poor user experience.