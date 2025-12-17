import type { Hold, Order, HoldStatus, OrderStatus } from "./types";
import { getShowById, getMovieById, permanentlyUnavailableSeats } from "./mockData";

// ==================== In-Memory Storage ====================

const holds = new Map<string, Hold>();
const orders = new Map<string, Order>();

// Hold expiration time in milliseconds (5 minutes)
const HOLD_TTL_MS = 5 * 60 * 1000;
// Order expiration time in milliseconds (5 minutes)
const ORDER_TTL_MS = 5 * 60 * 1000;

// ==================== UUID Generator ====================

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ==================== Hold Functions ====================

function isHoldExpired(hold: Hold): boolean {
  return new Date(hold.expiresAt) < new Date();
}

function updateHoldStatusIfExpired(hold: Hold): Hold {
  if (hold.status === "HELD" && isHoldExpired(hold)) {
    hold.status = "EXPIRED";
    holds.set(hold.holdId, hold);
  }
  return hold;
}

export function getActiveHoldsForShow(showId: string): Hold[] {
  const result: Hold[] = [];
  for (const hold of holds.values()) {
    if (hold.showId === showId) {
      const updated = updateHoldStatusIfExpired(hold);
      if (updated.status === "HELD") {
        result.push(updated);
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

export function createHold(
  showId: string,
  userId: string,
  seatIds: string[],
  quantity: number
): { hold?: Hold; error?: string } {
  // Check if show exists
  const show = getShowById(showId);
  if (!show) {
    return { error: "Show not found" };
  }

  // Check for seat conflicts
  const heldSeats = getHeldSeatIdsForShow(showId, userId);
  const confirmedSeats = getConfirmedSeatIdsForShow(showId);
  const unavailableSeats = [...permanentlyUnavailableSeats, ...heldSeats, ...confirmedSeats];

  const conflicts = seatIds.filter((seat) => unavailableSeats.includes(seat));
  if (conflicts.length > 0) {
    return { error: `Seats already taken: ${conflicts.join(", ")}` };
  }

  // Release any existing hold by this user for this show
  for (const hold of holds.values()) {
    if (hold.showId === showId && hold.userId === userId && hold.status === "HELD") {
      hold.status = "RELEASED";
      holds.set(hold.holdId, hold);
    }
  }

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

export function getHold(holdId: string): Hold | undefined {
  const hold = holds.get(holdId);
  if (!hold) return undefined;
  return updateHoldStatusIfExpired(hold);
}

export function updateHold(
  holdId: string,
  userId: string,
  seatIds: string[],
  quantity: number
): { hold?: Hold; error?: string } {
  const hold = getHold(holdId);
  if (!hold) {
    return { error: "Hold not found" };
  }

  if (hold.userId !== userId) {
    return { error: "Unauthorized" };
  }

  if (hold.status !== "HELD") {
    return { error: `Cannot update hold with status: ${hold.status}` };
  }

  // Check for seat conflicts (excluding current hold's seats)
  const heldSeats = getHeldSeatIdsForShow(hold.showId, userId);
  const confirmedSeats = getConfirmedSeatIdsForShow(hold.showId);
  const unavailableSeats = [...permanentlyUnavailableSeats, ...heldSeats, ...confirmedSeats];

  const conflicts = seatIds.filter((seat) => unavailableSeats.includes(seat));
  if (conflicts.length > 0) {
    return { error: `Seats already taken: ${conflicts.join(", ")}` };
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
  const hold = getHold(holdId);
  if (!hold) {
    return { success: false, error: "Hold not found" };
  }

  if (hold.userId !== userId) {
    return { success: false, error: "Unauthorized" };
  }

  if (hold.status !== "HELD") {
    return { success: false, error: `Cannot release hold with status: ${hold.status}` };
  }

  hold.status = "RELEASED";
  holds.set(holdId, hold);
  return { success: true };
}

// ==================== Order Functions ====================

function isOrderExpired(order: Order): boolean {
  return order.status === "PAYMENT_PENDING" && new Date(order.expiresAt) < new Date();
}

function updateOrderStatusIfExpired(order: Order): Order {
  if (isOrderExpired(order)) {
    order.status = "EXPIRED";
    orders.set(order.orderId, order);

    // Also release the associated hold
    const hold = holds.get(order.holdId);
    if (hold && hold.status === "HELD") {
      hold.status = "RELEASED";
      holds.set(hold.holdId, hold);
    }
  }
  return order;
}

export function createOrder(
  holdId: string,
  userId: string,
  customer: { name: string; email: string; phone: string }
): { order?: Order; error?: string } {
  const hold = getHold(holdId);
  if (!hold) {
    return { error: "Hold not found" };
  }

  if (hold.userId !== userId) {
    return { error: "Unauthorized" };
  }

  if (hold.status !== "HELD") {
    return { error: `Cannot create order from hold with status: ${hold.status}` };
  }

  const show = getShowById(hold.showId);
  if (!show) {
    return { error: "Show not found" };
  }

  const movie = getMovieById(show.movieId);
  if (!movie) {
    return { error: "Movie not found" };
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ORDER_TTL_MS);

  const order: Order = {
    orderId: generateUUID(),
    holdId: hold.holdId,
    userId,
    showId: hold.showId,
    movieId: show.movieId,
    theatreId: show.theatreId,
    seatIds: hold.seatIds,
    customer,
    amount: show.price * hold.quantity,
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
  return updateOrderStatusIfExpired(order);
}

export function confirmOrderPayment(
  orderId: string,
  userId: string
): { order?: Order; error?: string } {
  const order = getOrder(orderId);
  if (!order) {
    return { error: "Order not found" };
  }

  if (order.userId !== userId) {
    return { error: "Unauthorized" };
  }

  if (order.status !== "PAYMENT_PENDING") {
    return { error: `Cannot confirm payment for order with status: ${order.status}` };
  }

  // Generate ticket code
  const ticketCode = `BMSCLONE-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  order.status = "CONFIRMED";
  order.ticketCode = ticketCode;
  orders.set(orderId, order);

  // Update hold status
  const hold = holds.get(order.holdId);
  if (hold) {
    // Keep hold as is but it's now associated with confirmed order
    holds.set(hold.holdId, hold);
  }

  return { order };
}

// ==================== Debug Functions ====================

export function getAllHolds(): Hold[] {
  return Array.from(holds.values());
}

export function getAllOrders(): Order[] {
  return Array.from(orders.values());
}
