# BookMyShow Clone

A movie ticket booking application built with Next.js 15, TypeScript, and shadcn/ui.

## Features

- Browse recommended and trending movies
- View movie details with cast and crew information
- Select showtime and theatre
- Interactive seat selection with 5-minute hold
- Order summary with mock payment confirmation

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **UI Components**: shadcn/ui
- **Authentication**: Auth.js v5 (NextAuth)
- **Validation**: Zod
- **Data**: In-memory mock data

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your Google OAuth credentials

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

### Environment Variables

```env
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
AUTH_SECRET=your_auth_secret
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Project Structure

```
src/
├── app/
│   ├── api/v1/              # API Route Handlers
│   │   ├── movies/          # Movie endpoints
│   │   ├── shows/           # Show endpoints
│   │   ├── holds/           # Hold endpoints
│   │   └── orders/          # Order endpoints
│   ├── movies/              # Movie pages
│   ├── seat-layout/         # Seat selection page
│   ├── order-summary/       # Order summary page
│   └── page.tsx             # Home page
├── components/
│   ├── ui/                  # shadcn/ui components
│   ├── Header.tsx           # Navigation header
│   └── MovieCard.tsx        # Movie card component
├── lib/
│   ├── types.ts             # TypeScript types
│   ├── schemas.ts           # Zod validation schemas
│   ├── mockData.ts          # Static mock data
│   ├── memoryStore.ts       # In-memory state management
│   └── utils.ts             # Utility functions
└── server/
    └── auth/                # Auth.js configuration
```

## API Endpoints

### Movies

#### List Movies
```bash
GET /api/v1/movies?category=recommended|trending&limit=20

# Example
curl "http://localhost:3000/api/v1/movies?category=recommended&limit=10"
```

#### Get Movie Details
```bash
GET /api/v1/movies/{movieId}

# Example
curl "http://localhost:3000/api/v1/movies/550e8400-e29b-41d4-a716-446655440001"
```

#### Get Movie Availability
```bash
GET /api/v1/movies/{movieId}/availability?from=YYYY-MM-DD&to=YYYY-MM-DD

# Example
curl "http://localhost:3000/api/v1/movies/550e8400-e29b-41d4-a716-446655440001/availability?from=2025-12-17&to=2025-12-24"
```

#### Get Shows for a Date
```bash
GET /api/v1/movies/{movieId}/shows?date=YYYY-MM-DD

# Example
curl "http://localhost:3000/api/v1/movies/550e8400-e29b-41d4-a716-446655440001/shows?date=2025-12-17"
```

### Shows

#### Get Seat Map
```bash
GET /api/v1/shows/{showId}/seatmap

# Example
curl "http://localhost:3000/api/v1/shows/770e8400-e29b-41d4-a716-446655440001/seatmap"
```

### Holds (Authentication Required)

#### Create Hold
```bash
POST /api/v1/holds
Content-Type: application/json

{
  "showId": "770e8400-e29b-41d4-a716-446655440001",
  "seatIds": ["A1", "A2"],
  "quantity": 2
}

# Example with cookie auth
curl -X POST "http://localhost:3000/api/v1/holds" \
  -H "Content-Type: application/json" \
  -H "Cookie: authjs.session-token=YOUR_SESSION_TOKEN" \
  -d '{"showId":"770e8400-e29b-41d4-a716-446655440001","seatIds":["A1","A2"],"quantity":2}'
```

#### Get Hold
```bash
GET /api/v1/holds/{holdId}

# Example
curl "http://localhost:3000/api/v1/holds/{holdId}" \
  -H "Cookie: authjs.session-token=YOUR_SESSION_TOKEN"
```

#### Update Hold
```bash
PATCH /api/v1/holds/{holdId}
Content-Type: application/json

{
  "seatIds": ["A3", "A4"],
  "quantity": 2
}
```

#### Release Hold
```bash
POST /api/v1/holds/{holdId}/release

# Example
curl -X POST "http://localhost:3000/api/v1/holds/{holdId}/release" \
  -H "Cookie: authjs.session-token=YOUR_SESSION_TOKEN"
```

### Orders (Authentication Required)

#### Create Order
```bash
POST /api/v1/orders
Content-Type: application/json

{
  "holdId": "your-hold-id",
  "customer": {
    "name": "John Doe",
    "email": "john@example.com",
    "phone": "9876543210"
  }
}
```

#### Get Order
```bash
GET /api/v1/orders/{orderId}
```

#### Confirm Payment
```bash
POST /api/v1/orders/{orderId}/confirm-payment

# Returns confirmed order with ticket code
```

## Status Models

### Hold Status
- `HELD` - Seats are locked for the user
- `EXPIRED` - Hold has expired (5 minutes)
- `RELEASED` - User released the hold

### Order Status
- `PAYMENT_PENDING` - Awaiting payment
- `CONFIRMED` - Payment successful, tickets issued
- `FAILED` - Payment failed
- `EXPIRED` - Payment window expired
- `CANCELLED` - Order cancelled

## Mock Data

The application includes mock data for:
- 2 movies (Avatar: Fire and Ash, The Dark Knight Returns)
- 2 theatres (PVR Orion Mall, INOX Garuda Mall)
- Shows for the next 7 days
- 40 seats in 5 rows (A-E, 8 seats each)

## Business Rules

1. **Seat Holds**: Seats are held for 5 minutes. If not converted to an order, they are automatically released.
2. **Seat Conflicts**: If a requested seat is already held by another user, the API returns a 409 Conflict.
3. **Order Expiration**: Orders expire 5 minutes after creation if payment is not confirmed.
4. **Single Price**: All seats have the same price for simplicity.

## Scripts

```bash
npm run dev        # Start development server
npm run build      # Build for production
npm run start      # Start production server
npm run lint       # Run ESLint
npm run typecheck  # Run TypeScript type checking
```

## License

MIT
