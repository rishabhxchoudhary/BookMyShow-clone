import type { Hold, Order } from "./types";
import { getShowById, getMovieById, permanentlyUnavailableSeats } from "./mockData";

// ==================== In-Memory Storage ====================

const holds = new Map<string, Hold>();
const orders = new Map<string, Order>();

// Hold expiration time in milliseconds (10 minutes as per requirement)
const HOLD_TTL_MS = 10 * 60 * 1000;
// Order payment expiration time in milliseconds (5 minutes)
const ORDER_TTL_MS = 5 * 60 * 1000;

// ==================== Booking Queue System ====================
// Partitioned queues by showId and seat tier (A-E = tier1, F-Z = tier2)

interface QueuedBooking {
  id: string;
  showId: string;
  userId: string;
  seatIds: string[];
  quantity: number;
  tier: "tier1" | "tier2";
  timestamp: number;
  resolve: (result: { hold?: Hold; error?: string }) => void;
}

// Queues partitioned by showId and tier
const bookingQueues = new Map<string, QueuedBooking[]>();
const processingLocks = new Map<string, boolean>();

function getQueueKey(showId: string, tier: "tier1" | "tier2"): string {
  return `${showId}:${tier}`;
}

function getSeatTier(seatId: string): "tier1" | "tier2" {
  const row = seatId.charAt(0).toUpperCase();
  // A-E = tier1 (premium/front), F-Z = tier2 (regular/back)
  return row <= "E" ? "tier1" : "tier2";
}

function getPrimaryTier(seatIds: string[]): "tier1" | "tier2" {
  // Determine queue based on majority of seats
  const tier1Count = seatIds.filter(s => getSeatTier(s) === "tier1").length;
  return tier1Count >= seatIds.length / 2 ? "tier1" : "tier2";
}

async function processQueue(queueKey: string): Promise<void> {
  if (processingLocks.get(queueKey)) return;
  processingLocks.set(queueKey, true);

  const queue = bookingQueues.get(queueKey) || [];

  while (queue.length > 0) {
    const booking = queue.shift()!;

    // Process booking with optimistic locking
    const result = processBookingWithLock(
      booking.showId,
      booking.userId,
      booking.seatIds,
      booking.quantity
    );

    booking.resolve(result);

    // Small delay to prevent CPU hogging
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  processingLocks.set(queueKey, false);
}

// ==================== UUID Generator ====================

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ==================== Expiration Check (NO DB WRITES) ====================

function isHoldExpired(hold: Hold): boolean {
  return new Date(hold.expiresAt) < new Date();
}

function isOrderExpired(order: Order): boolean {
  return order.status === "PAYMENT_PENDING" && new Date(order.expiresAt) < new Date();
}

// Returns effective status without modifying storage
function getEffectiveHoldStatus(hold: Hold): Hold["status"] {
  if (hold.status === "HELD" && isHoldExpired(hold)) {
    return "EXPIRED";
  }
  return hold.status;
}

function getEffectiveOrderStatus(order: Order): Order["status"] {
  if (order.status === "PAYMENT_PENDING" && isOrderExpired(order)) {
    return "EXPIRED";
  }
  return order.status;
}

// ==================== Hold Functions ====================

export function getActiveHoldsForShow(showId: string): Hold[] {
  const result: Hold[] = [];
  for (const hold of holds.values()) {
    if (hold.showId === showId) {
      // Check expiration WITHOUT updating storage
      const effectiveStatus = getEffectiveHoldStatus(hold);
      if (effectiveStatus === "HELD") {
        result.push(hold);
      }
    }
  }
  return result;
}

export function getHeldSeatIdsForShow(showId: string, excludeUserId?: string): string[] {
  const activeHolds = getActiveHoldsForShow(showId);
  const heldSeats: string[] = [];
  for (const hold of activeHolds) {
    if (excludeUserId && hold.userId === excludeUserId) continue;
    heldSeats.push(...hold.seatIds);
  }
  return heldSeats;
}

export function getConfirmedSeatIdsForShow(showId: string): string[] {
  const confirmedSeats: string[] = [];
  for (const order of orders.values()) {
    if (order.showId === showId && order.status === "CONFIRMED") {
      confirmedSeats.push(...order.seatIds);
    }
  }
  return confirmedSeats;
}

export function getUnavailableSeatIdsForShow(showId: string): string[] {
  const heldSeats = getHeldSeatIdsForShow(showId);
  const confirmedSeats = getConfirmedSeatIdsForShow(showId);
  return [...new Set([...permanentlyUnavailableSeats, ...heldSeats, ...confirmedSeats])];
}

// ==================== Optimistic Locking for Seat Booking ====================

interface SeatVersion {
  version: number;
  lockedBy: string | null;
  lockedAt: number | null;
}

const seatVersions = new Map<string, SeatVersion>(); // key: `${showId}:${seatId}`

function getSeatVersionKey(showId: string, seatId: string): string {
  return `${showId}:${seatId}`;
}

function getSeatVersion(showId: string, seatId: string): SeatVersion {
  const key = getSeatVersionKey(showId, seatId);
  if (!seatVersions.has(key)) {
    seatVersions.set(key, { version: 0, lockedBy: null, lockedAt: null });
  }
  return seatVersions.get(key)!;
}

function tryAcquireSeatLock(
  showId: string,
  seatId: string,
  userId: string,
  expectedVersion: number
): { success: boolean; currentVersion: number } {
  const key = getSeatVersionKey(showId, seatId);
  const current = getSeatVersion(showId, seatId);

  // Check if seat is already locked by someone else (and not expired)
  if (current.lockedBy && current.lockedBy !== userId && current.lockedAt) {
    const lockAge = Date.now() - current.lockedAt;
    if (lockAge < HOLD_TTL_MS) {
      return { success: false, currentVersion: current.version };
    }
  }

  // Optimistic locking: check version hasn't changed
  if (current.version !== expectedVersion) {
    return { success: false, currentVersion: current.version };
  }

  // Acquire lock
  seatVersions.set(key, {
    version: current.version + 1,
    lockedBy: userId,
    lockedAt: Date.now(),
  });

  return { success: true, currentVersion: current.version + 1 };
}

function releaseSeatLock(showId: string, seatId: string, userId: string): void {
  const key = getSeatVersionKey(showId, seatId);
  const current = getSeatVersion(showId, seatId);

  if (current.lockedBy === userId) {
    seatVersions.set(key, {
      version: current.version + 1,
      lockedBy: null,
      lockedAt: null,
    });
  }
}

// ==================== Core Booking Logic with Optimistic Locking ====================

function processBookingWithLock(
  showId: string,
  userId: string,
  seatIds: string[],
  quantity: number
): { hold?: Hold; error?: string } {
  // Step 1: Get current versions for all seats
  const seatVersionsSnapshot = seatIds.map(seatId => ({
    seatId,
    version: getSeatVersion(showId, seatId).version,
  }));

  // Step 2: Check for conflicts with held/confirmed seats
  const heldSeats = getHeldSeatIdsForShow(showId, userId);
  const confirmedSeats = getConfirmedSeatIdsForShow(showId);
  const unavailableSeats = [...permanentlyUnavailableSeats, ...heldSeats, ...confirmedSeats];

  const conflicts = seatIds.filter(seat => unavailableSeats.includes(seat));
  if (conflicts.length > 0) {
    return { error: `Seats already taken: ${conflicts.join(", ")}` };
  }

  // Step 3: Try to acquire locks on all seats (optimistic locking)
  const acquiredLocks: string[] = [];

  for (const { seatId, version } of seatVersionsSnapshot) {
    const result = tryAcquireSeatLock(showId, seatId, userId, version);
    if (!result.success) {
      // Rollback acquired locks
      for (const lockedSeat of acquiredLocks) {
        releaseSeatLock(showId, lockedSeat, userId);
      }
      return { error: `Seat ${seatId} was just taken. Please try again.` };
    }
    acquiredLocks.push(seatId);
  }

  // Step 4: Create new hold (allows multiple holds per user for different tabs/sessions)
  const now = new Date();
  const expiresAt = new Date(now.getTime() + HOLD_TTL_MS);

  const hold: Hold = {
    holdId: generateUUID(),
    showId,
    userId,
    seatIds,
    quantity,
    status: "HELD",
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  holds.set(hold.holdId, hold);
  return { hold };
}

// ==================== Public API: Queue-based Hold Creation ====================

export function createHold(
  showId: string,
  userId: string,
  seatIds: string[],
  quantity: number
): { hold?: Hold; error?: string } {
  // For synchronous API compatibility, process directly with locking
  return processBookingWithLock(showId, userId, seatIds, quantity);
}

// Async version that uses queue (for high-concurrency scenarios)
export async function createHoldAsync(
  showId: string,
  userId: string,
  seatIds: string[],
  quantity: number
): Promise<{ hold?: Hold; error?: string }> {
  const tier = getPrimaryTier(seatIds);
  const queueKey = getQueueKey(showId, tier);

  return new Promise((resolve) => {
    const booking: QueuedBooking = {
      id: generateUUID(),
      showId,
      userId,
      seatIds,
      quantity,
      tier,
      timestamp: Date.now(),
      resolve,
    };

    // Add to queue
    if (!bookingQueues.has(queueKey)) {
      bookingQueues.set(queueKey, []);
    }
    bookingQueues.get(queueKey)!.push(booking);

    // Start processing queue
    processQueue(queueKey);
  });
}

// ==================== Hold Retrieval ====================

export function getHold(holdId: string): Hold | undefined {
  const hold = holds.get(holdId);
  if (!hold) return undefined;

  // Return with effective status (no storage update)
  return {
    ...hold,
    status: getEffectiveHoldStatus(hold),
  };
}

export function updateHold(
  holdId: string,
  userId: string,
  seatIds: string[],
  quantity: number
): { hold?: Hold; error?: string } {
  const hold = holds.get(holdId);
  if (!hold) {
    return { error: "Hold not found" };
  }

  if (hold.userId !== userId) {
    return { error: "Unauthorized" };
  }

  const effectiveStatus = getEffectiveHoldStatus(hold);
  if (effectiveStatus !== "HELD") {
    return { error: `Cannot update hold with status: ${effectiveStatus}` };
  }

  // Check for seat conflicts (excluding current hold's seats)
  const heldSeats = getHeldSeatIdsForShow(hold.showId, userId);
  const confirmedSeats = getConfirmedSeatIdsForShow(hold.showId);
  const unavailableSeats = [...permanentlyUnavailableSeats, ...heldSeats, ...confirmedSeats];

  const conflicts = seatIds.filter((seat) => unavailableSeats.includes(seat));
  if (conflicts.length > 0) {
    return { error: `Seats already taken: ${conflicts.join(", ")}` };
  }

  // Release old seat locks
  for (const seatId of hold.seatIds) {
    releaseSeatLock(hold.showId, seatId, userId);
  }

  // Acquire new seat locks
  for (const seatId of seatIds) {
    const version = getSeatVersion(hold.showId, seatId).version;
    tryAcquireSeatLock(hold.showId, seatId, userId, version);
  }

  // Update hold
  hold.seatIds = seatIds;
  hold.quantity = quantity;
  // Reset expiration
  hold.expiresAt = new Date(Date.now() + HOLD_TTL_MS).toISOString();

  holds.set(holdId, hold);
  return { hold };
}

export function releaseHold(
  holdId: string,
  userId: string
): { success: boolean; error?: string } {
  const hold = holds.get(holdId);
  if (!hold) {
    return { success: false, error: "Hold not found" };
  }

  if (hold.userId !== userId) {
    return { success: false, error: "Unauthorized" };
  }

  const effectiveStatus = getEffectiveHoldStatus(hold);
  if (effectiveStatus !== "HELD") {
    return { success: false, error: `Cannot release hold with status: ${effectiveStatus}` };
  }

  // Release seat locks
  for (const seatId of hold.seatIds) {
    releaseSeatLock(hold.showId, seatId, userId);
  }

  hold.status = "RELEASED";
  holds.set(holdId, hold);
  return { success: true };
}

// ==================== Order Functions ====================

// Default price per seat when show is from Lambda API (not in mock data)
const DEFAULT_SEAT_PRICE = 350;

export function createOrder(
  holdId: string,
  userId: string,
  customer: { name: string; email: string; phone: string }
): { order?: Order; error?: string } {
  const hold = holds.get(holdId);
  if (!hold) {
    return { error: "Hold not found" };
  }

  if (hold.userId !== userId) {
    return { error: "Unauthorized" };
  }

  const effectiveStatus = getEffectiveHoldStatus(hold);
  if (effectiveStatus !== "HELD") {
    return { error: `Cannot create order from hold with status: ${effectiveStatus}` };
  }

  // Try to get show from mock data, but don't fail if not found
  const show = getShowById(hold.showId);
  const price = show?.price ?? DEFAULT_SEAT_PRICE;
  const movieId = show?.movieId ?? "lambda-movie";
  const theatreId = show?.theatreId ?? "lambda-theatre";

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ORDER_TTL_MS);

  const order: Order = {
    orderId: generateUUID(),
    holdId: hold.holdId,
    userId,
    showId: hold.showId,
    movieId,
    theatreId,
    seatIds: hold.seatIds,
    customer,
    amount: price * hold.quantity,
    status: "PAYMENT_PENDING",
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  orders.set(order.orderId, order);
  return { order };
}

export function getOrder(orderId: string): Order | undefined {
  const order = orders.get(orderId);
  if (!order) return undefined;

  // Return with effective status (no storage update)
  return {
    ...order,
    status: getEffectiveOrderStatus(order),
  };
}

export function confirmOrderPayment(
  orderId: string,
  userId: string
): { order?: Order; error?: string } {
  const order = orders.get(orderId);
  if (!order) {
    return { error: "Order not found" };
  }

  if (order.userId !== userId) {
    return { error: "Unauthorized" };
  }

  const effectiveStatus = getEffectiveOrderStatus(order);
  if (effectiveStatus !== "PAYMENT_PENDING") {
    return { error: `Cannot confirm payment for order with status: ${effectiveStatus}` };
  }

  // Generate ticket code
  const ticketCode = `BMS-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  order.status = "CONFIRMED";
  order.ticketCode = ticketCode;
  orders.set(orderId, order);

  // Mark seats as permanently sold (update seat versions)
  const hold = holds.get(order.holdId);
  if (hold) {
    for (const seatId of hold.seatIds) {
      const key = getSeatVersionKey(hold.showId, seatId);
      const current = getSeatVersion(hold.showId, seatId);
      seatVersions.set(key, {
        version: current.version + 1,
        lockedBy: "SOLD",
        lockedAt: null, // Permanent
      });
    }
  }

  return { order };
}

// ==================== Utility: Get Queue Stats ====================

export function getQueueStats(): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const [key, queue] of bookingQueues.entries()) {
    stats[key] = queue.length;
  }
  return stats;
}

// ==================== Utility: Cleanup Expired (Optional Background Job) ====================

export function cleanupExpired(): { holdsCleared: number; ordersCleared: number } {
  let holdsCleared = 0;
  let ordersCleared = 0;

  // Cleanup expired holds
  for (const [holdId, hold] of holds.entries()) {
    if (getEffectiveHoldStatus(hold) === "EXPIRED") {
      // Release seat locks
      for (const seatId of hold.seatIds) {
        releaseSeatLock(hold.showId, seatId, hold.userId);
      }
      hold.status = "EXPIRED";
      holds.set(holdId, hold);
      holdsCleared++;
    }
  }

  // Cleanup expired orders
  for (const [orderId, order] of orders.entries()) {
    if (getEffectiveOrderStatus(order) === "EXPIRED") {
      order.status = "EXPIRED";
      orders.set(orderId, order);
      ordersCleared++;
    }
  }

  return { holdsCleared, ordersCleared };
}
