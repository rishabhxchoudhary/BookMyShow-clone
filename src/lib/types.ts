// ==================== Base Types ====================

export interface CastMember {
  name: string;
  role?: string;
  imageUrl: string;
}

export interface CrewMember {
  name: string;
  role: string;
  imageUrl: string;
}

export interface Movie {
  movieId: string;
  title: string;
  about: string;
  thumbnailUrl: string;
  rating: number;
  durationMins: number;
  ageRating: string;
  releaseDate: string;
  language: string;
  format: string;
  genres: string[];
  cast: CastMember[];
  crew: CrewMember[];
}

export interface MovieCard {
  movieId: string;
  title: string;
  thumbnailUrl: string;
  rating: number;
  genres: string[];
  durationMins: number;
}

export interface Theatre {
  theatreId: string;
  name: string;
  address: string;
  geo: {
    lat: number;
    lng: number;
  };
  cancellationAvailable: boolean;
}

export type ShowStatus = "AVAILABLE" | "FILLING_FAST" | "ALMOST_FULL";

export interface Show {
  showId: string;
  movieId: string;
  theatreId: string;
  startTime: string;
  price: number;
  status: ShowStatus;
}

export interface SeatRow {
  rowLabel: string;
  seats: string[];
}

export interface SeatLayout {
  rows: SeatRow[];
}

export interface SeatMap {
  showId: string;
  theatreId: string;
  screenName: string;
  price: number;
  layout: SeatLayout;
  unavailableSeatIds: string[];
  heldSeatIds: string[];
}

// ==================== Hold Types ====================

export type HoldStatus = "HELD" | "EXPIRED" | "RELEASED";

export interface Hold {
  holdId: string;
  showId: string;
  userId: string;
  seatIds: string[];
  quantity: number;
  status: HoldStatus;
  createdAt: string;
  expiresAt: string;
}

// ==================== Order Types ====================

export type OrderStatus =
  | "PAYMENT_PENDING"
  | "CONFIRMED"
  | "FAILED"
  | "EXPIRED"
  | "CANCELLED";

export interface Customer {
  name: string;
  email: string;
  phone: string;
}

export interface Order {
  orderId: string;
  holdId: string;
  userId: string;
  showId: string;
  movieId: string;
  theatreId: string;
  seatIds: string[];
  customer: Customer;
  amount: number;
  status: OrderStatus;
  ticketCode?: string;
  createdAt: string;
  expiresAt: string;
}

// ==================== API Response Types ====================

export interface MovieListResponse {
  items: MovieCard[];
  nextCursor: string | null;
}

export interface AvailabilityResponse {
  movieId: string;
  availableDates: string[];
}

export interface TheatreWithShows extends Theatre {
  shows: Show[];
}

export interface ShowsResponse {
  movieId: string;
  date: string;
  theatres: TheatreWithShows[];
}

export interface HoldResponse {
  holdId: string;
  showId: string;
  seatIds: string[];
  status: HoldStatus;
  expiresAt: string;
}

export interface OrderResponse {
  orderId: string;
  status: OrderStatus;
  movie: {
    movieId: string;
    title: string;
  };
  theatre: {
    theatreId: string;
    name: string;
  };
  show: {
    showId: string;
    startTime: string;
  };
  seats: string[];
  amount: number;
  expiresAt: string;
  ticketCode?: string;
}

export interface ErrorResponse {
  error: {
    message: string;
    details?: unknown;
  };
}
