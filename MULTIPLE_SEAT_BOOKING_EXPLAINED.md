# 🎬 How Multiple Seat Booking Works - Explained Simply

## 🎯 Imagine You're at a Movie Theater

Think of booking movie seats online like this:
- **Redis** = A magical notebook that remembers things for a short time
- **Lua Script** = A smart robot that does multiple tasks perfectly without mistakes
- **Multiple seats** = You want to sit with your friends, so you pick seats A5, A6, A7

---

## 📝 What Happens When You Pick 3 Seats (A5, A6, A7)?

### **Step 1: You Click "Hold These Seats"**
```javascript
// Frontend sends this to the backend:
{
  "showId": "movie123",
  "seatIds": ["A5", "A6", "A7"],
  "quantity": 3
}
```

### **Step 2: The Smart Robot (Lua Script) Springs Into Action**

**🤖 Robot's Job: "Check if ALL seats are free, then grab ALL of them at once"**

Think of it like this: Instead of checking seat A5, then A6, then A7 one by one (which might let someone steal A6 while you're checking A7), the robot does it ALL AT ONCE.

**What the Robot Does:**

```lua
-- PHASE 1: "Are ALL my seats free?"
for each seat in ["A5", "A6", "A7"]:
    key = "seat_lock:movie123:A5"  -- like a locker with this name
    who_owns_it = redis.GET(key)   -- check who has the key to this locker
    
    if someone_else_owns_it:
        return "SORRY! Seat A5 is taken by someone else"
        -- STOP EVERYTHING! Don't take any seats!
    end
end

-- PHASE 2: "Great! All seats are free. Let me grab them ALL!"
for each seat in ["A5", "A6", "A7"]:
    key = "seat_lock:movie123:A5"
    value = "john123:hold789"     -- "john owns this through hold789"
    redis.SET(key, value, expire_in_5_minutes)
end

return "SUCCESS! You got all 3 seats!"
```

---

## 🗂️ What Gets Created in Redis?

When you select **3 seats (A5, A6, A7)**, Redis creates **3 separate entries**:

```
🔐 seat_lock:movie123:A5 = "john123:hold789"  (expires in 5 min)
🔐 seat_lock:movie123:A6 = "john123:hold789"  (expires in 5 min)  
🔐 seat_lock:movie123:A7 = "john123:hold789"  (expires in 5 min)

📋 hold:hold789 = {
    "hold_id": "hold789",
    "user_id": "john123", 
    "seat_ids": ["A5", "A6", "A7"],
    "show_id": "movie123",
    "expires_at": "2025-12-17T15:30:00Z"
}  (expires in 5 min)
```

**So for 3 seats = 4 total Redis entries:**
- 3 individual seat locks (one per seat)
- 1 hold information (with all seats together)

---

## 🤔 Why Do We Need the Smart Robot (Lua Script)?

### **🚫 Without Lua Script (Bad Way):**
```python
# Checking seats one by one - DANGEROUS!
def book_seats_badly():
    for seat in ["A5", "A6", "A7"]:
        if seat_is_taken(seat):
            return "Sorry, seat taken"
        # ⚠️ GAP! Someone could steal A6 here!
        
    for seat in ["A5", "A6", "A7"]:
        lock_seat(seat)  # Too late! A6 might be gone!
```

### **✅ With Lua Script (Good Way):**
```lua
-- Check ALL seats first, THEN lock ALL seats
-- No gaps! No one can interfere!
```

**Think of it like:**
- **Bad way:** Checking if 3 parking spots are empty one by one, then trying to park 3 cars. Someone might take spot #2 while you're checking spot #3!
- **Good way:** A magic spell that checks all 3 spots AND parks all 3 cars in one instant!

---

## 🔍 How Do We Fetch "On Hold" Seats?

### **When Someone Asks "What Seats Are Held?"**

```python
def get_locked_seats_for_show(show_id):
    # Look for all keys like: "seat_lock:movie123:*"
    pattern = f"seat_lock:{show_id}:*"
    all_keys = redis.keys(pattern)
    
    locked_seats = []
    for key in all_keys:
        # Extract seat from "seat_lock:movie123:A5" -> "A5"
        seat_id = key.split(':')[-1]  # Take last part after ':'
        locked_seats.append(seat_id)
    
    return locked_seats  # ["A5", "A6", "A7", "B3", "B4"]
```

**Result:** `["A5", "A6", "A7"]` (if those are the only held seats)

---

## 🎭 Real Example: Sarah Books 2 Seats

### **Step-by-Step What Happens:**

```
1. Sarah picks seats F5, F6 for "Spider-Man" show
2. Frontend: POST /holds with {"seatIds": ["F5", "F6"]}
3. Backend generates holdId = "hold456"
4. Lua script runs:
   ✅ Check F5: seat_lock:spider123:F5 -> empty ✓
   ✅ Check F6: seat_lock:spider123:F6 -> empty ✓
   ✅ Lock F5: SET seat_lock:spider123:F5 = "sarah789:hold456" EX 300
   ✅ Lock F6: SET seat_lock:spider123:F6 = "sarah789:hold456" EX 300
5. Store hold info: SET hold:hold456 = {seat_ids: ["F5","F6"], ...} EX 300
```

### **Redis Now Contains:**
```
seat_lock:spider123:F5 = "sarah789:hold456"  ⏰ expires in 5min
seat_lock:spider123:F6 = "sarah789:hold456"  ⏰ expires in 5min
hold:hold456 = {JSON with seat info}         ⏰ expires in 5min
```

### **When Someone Else Tries F5:**
```
Tom tries to book F5:
1. Lua script checks: seat_lock:spider123:F5
2. Finds: "sarah789:hold456" 
3. Compares: "sarah789" ≠ "tom456"
4. Returns: "SORRY! Seat F5 is already taken"
```

---

## 🚀 Why This System is Smart

### **🎯 Atomic = All or Nothing**
- If ANY seat is taken → NO seats get locked
- If ALL seats are free → ALL seats get locked
- No partial bookings! No confusion!

### **⚡ Super Fast**
- Instead of 6 separate trips to Redis for 3 seats:
  - 3 trips to check + 3 trips to lock = 6 trips
- Lua script does everything in 1 trip!

### **🔒 Race Condition Safe**
- Two people clicking at exactly the same millisecond
- Only ONE person gets the seats
- The other gets a clear "seats taken" message

### **⏰ Automatic Cleanup**
- After 5 minutes, all locks disappear automatically
- No manual cleanup needed!
- Seats become available again if you don't complete booking

---

## 🎬 The Complete Journey

```
1. Pick seats: ["A5", "A6", "A7"] 
   ↓
2. Create hold (Lua script creates 4 Redis entries)
   ↓  
3. Fill customer info & create order
   ↓
4. Make payment 
   ↓
5. Payment confirmed → Delete all 4 Redis entries
   ↓
6. Create permanent record in database
```

**That's it!** The Lua script is like having a super-fast, super-reliable assistant that never makes mistakes when handling multiple seats at once! 🎉