/**
 * BMS Lambda API Client
 * Connects Next.js frontend with AWS Lambda backend
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_BMS_API_URL || 'http://localhost:3000/api';

class BMSAPIError extends Error {
  constructor(
    message: string,
    public status: number,
    public endpoint: string
  ) {
    super(message);
    this.name = 'BMSAPIError';
  }
}

interface APIResponse<T> {
  data?: T;
  error?: {
    message: string;
    timestamp: string;
  };
}

class BMSAPIClient {
  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${API_BASE_URL}${endpoint}`;
    
    const config: RequestInit = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    try {
      const response = await fetch(url, config);
      const data = await response.json();

      if (!response.ok) {
        throw new BMSAPIError(
          data.error?.message || `HTTP ${response.status}`,
          response.status,
          endpoint
        );
      }

      return data;
    } catch (error) {
      if (error instanceof BMSAPIError) {
        throw error;
      }
      
      console.error(`API request failed for ${endpoint}:`, error);
      throw new BMSAPIError(
        'Network error - please check your connection',
        0,
        endpoint
      );
    }
  }

  // Movies API
  async getMovies(limit = 20, offset = 0) {
    return this.request(`/movies?limit=${limit}&offset=${offset}`);
  }

  async getMovieById(movieId: string) {
    return this.request(`/movies/${movieId}`);
  }

  async getMovieShows(movieId: string, date: string) {
    return this.request(`/movies/${movieId}/shows?date=${date}`);
  }

  // Shows API
  async getSeatmap(showId: string) {
    return this.request(`/shows/${showId}/seatmap`);
  }

  // Holds API
  async createHold(holdData: {
    showId: string;
    seatIds: string[];
    quantity: number;
  }, userId?: string) {
    return this.request('/holds', {
      method: 'POST',
      headers: {
        ...(userId && { 'x-user-id': userId }),
      },
      body: JSON.stringify(holdData),
    });
  }

  async getHold(holdId: string, userId?: string) {
    return this.request(`/holds/${holdId}`, {
      headers: {
        ...(userId && { 'x-user-id': userId }),
      },
    });
  }

  async updateHold(
    holdId: string,
    holdData: {
      seatIds: string[];
      quantity: number;
    },
    userId?: string
  ) {
    return this.request(`/holds/${holdId}`, {
      method: 'PUT',
      headers: {
        ...(userId && { 'x-user-id': userId }),
      },
      body: JSON.stringify(holdData),
    });
  }

  async releaseHold(holdId: string, userId?: string) {
    return this.request(`/holds/${holdId}`, {
      method: 'DELETE',
      headers: {
        ...(userId && { 'x-user-id': userId }),
      },
    });
  }

  // Orders API
  async createOrder(orderData: {
    holdId: string;
    customerInfo: {
      name: string;
      email: string;
      phone: string;
    };
    paymentInfo: {
      method: string;
      amount: number;
    };
  }, userId?: string) {
    return this.request('/orders', {
      method: 'POST',
      headers: {
        ...(userId && { 'x-user-id': userId }),
      },
      body: JSON.stringify(orderData),
    });
  }

  async getOrder(orderId: string, userId?: string) {
    return this.request(`/orders/${orderId}`, {
      headers: {
        ...(userId && { 'x-user-id': userId }),
      },
    });
  }

  async confirmPayment(orderId: string, paymentData: any, userId?: string) {
    return this.request(`/orders/${orderId}/confirm-payment`, {
      method: 'POST',
      headers: {
        ...(userId && { 'x-user-id': userId }),
      },
      body: JSON.stringify(paymentData),
    });
  }
}

// Export singleton instance
export const bmsAPI = new BMSAPIClient();
export { BMSAPIError };

// Type definitions for API responses
export interface MovieListResponse {
  movies: Array<{
    movie_id: string;
    title: string;
    thumbnail_url: string;
    rating: string;
    duration_mins: number;
    genres: string[];
  }>;
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export interface MovieDetailsResponse {
  movie_id: string;
  title: string;
  about: string;
  thumbnail_url: string;
  rating: string;
  duration_mins: number;
  age_rating: string;
  release_date: string;
  language: string;
  format: string;
  genres: string[];
  created_at: string;
}

export interface SeatmapResponse {
  showId: string;
  movieTitle: string;
  theatreName: string;
  startTime: string;
  price: number;
  layout: Array<{
    seatId: string;
    row: string;
    number: number;
    type: string;
  }>;
  unavailableSeatIds: string[];
  heldSeatIds: string[];
}

export interface HoldResponse {
  holdId: string;
  showId: string;
  seatIds: string[];
  status: string;
  expiresAt: string;
  createdAt?: string;
}