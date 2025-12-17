import { z } from "zod";

// ==================== Request Schemas ====================

export const createHoldSchema = z.object({
  showId: z.string().uuid(),
  seatIds: z.array(z.string()).min(1).max(10),
  quantity: z.number().int().min(1).max(10),
});

export const updateHoldSchema = z.object({
  seatIds: z.array(z.string()).min(1).max(10),
  quantity: z.number().int().min(1).max(10),
});

export const customerSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().regex(/^\d{10}$/, "Phone must be 10 digits"),
});

export const createOrderSchema = z.object({
  holdId: z.string().uuid(),
  customer: customerSchema,
});

// ==================== Query Schemas ====================

export const movieListQuerySchema = z.object({
  category: z.enum(["recommended", "trending"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

export const availabilityQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
});

export const showsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
});

// ==================== Type Exports ====================

export type CreateHoldInput = z.infer<typeof createHoldSchema>;
export type UpdateHoldInput = z.infer<typeof updateHoldSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type CustomerInput = z.infer<typeof customerSchema>;
export type MovieListQuery = z.infer<typeof movieListQuerySchema>;
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
export type ShowsQuery = z.infer<typeof showsQuerySchema>;
