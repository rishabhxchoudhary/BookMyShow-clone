import type {
  Movie,
  Theatre,
  Show,
  SeatLayout,
  ShowStatus,
} from "./types";

// ==================== Helper Functions ====================

function getDateString(daysFromNow: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().split("T")[0]!;
}

function getShowTime(dateStr: string, hours: number, minutes: number): string {
  return `${dateStr}T${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:00+05:30`;
}

// ==================== Movies ====================

export const movies: Movie[] = [
  {
    movieId: "550e8400-e29b-41d4-a716-446655440001",
    title: "Avatar: Fire and Ash",
    about:
      "The epic continuation of James Cameron's Avatar saga. Jake Sully and Neytiri must protect their family and the Na'vi people from a new threat that emerges from the volcanic regions of Pandora. As ancient prophecies come to life, they discover secrets that could change the fate of their world forever.",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?w=400&h=600&fit=crop",
    rating: 8.7,
    durationMins: 192,
    ageRating: "UA",
    releaseDate: "2025-12-17",
    language: "English",
    format: "2D",
    genres: ["Action", "Adventure", "Sci-Fi"],
    cast: [
      {
        name: "Sam Worthington",
        role: "Jake Sully",
        imageUrl:
          "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop",
      },
      {
        name: "Zoe Saldana",
        role: "Neytiri",
        imageUrl:
          "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&h=150&fit=crop",
      },
      {
        name: "Sigourney Weaver",
        role: "Kiri",
        imageUrl:
          "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150&h=150&fit=crop",
      },
      {
        name: "Stephen Lang",
        role: "Colonel Quaritch",
        imageUrl:
          "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&h=150&fit=crop",
      },
    ],
    crew: [
      {
        name: "James Cameron",
        role: "Director",
        imageUrl:
          "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&h=150&fit=crop",
      },
      {
        name: "Jon Landau",
        role: "Producer",
        imageUrl:
          "https://images.unsplash.com/photo-1519345182560-3f2917c472ef?w=150&h=150&fit=crop",
      },
    ],
  },
  {
    movieId: "550e8400-e29b-41d4-a716-446655440002",
    title: "The Dark Knight Returns",
    about:
      "After a decade of peace, Gotham faces its darkest hour yet. Bruce Wayne must don the cape once more as a new criminal mastermind threatens to tear apart everything he built. With old allies and new enemies, Batman must confront his past to save the future.",
    thumbnailUrl:
      "https://images.unsplash.com/photo-1509347528160-9a9e33742cdb?w=400&h=600&fit=crop",
    rating: 9.1,
    durationMins: 165,
    ageRating: "UA",
    releaseDate: "2025-12-15",
    language: "English",
    format: "2D",
    genres: ["Action", "Drama", "Crime"],
    cast: [
      {
        name: "Robert Pattinson",
        role: "Bruce Wayne / Batman",
        imageUrl:
          "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&h=150&fit=crop",
      },
      {
        name: "Zoe Kravitz",
        role: "Selina Kyle",
        imageUrl:
          "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&h=150&fit=crop",
      },
      {
        name: "Colin Farrell",
        role: "Oswald Cobblepot",
        imageUrl:
          "https://images.unsplash.com/photo-1507591064344-4c6ce005b128?w=150&h=150&fit=crop",
      },
    ],
    crew: [
      {
        name: "Matt Reeves",
        role: "Director",
        imageUrl:
          "https://images.unsplash.com/photo-1560250097-0b93528c311a?w=150&h=150&fit=crop",
      },
      {
        name: "Dylan Clark",
        role: "Producer",
        imageUrl:
          "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&h=150&fit=crop",
      },
    ],
  },
];

// ==================== Theatres ====================

export const theatres: Theatre[] = [
  {
    theatreId: "660e8400-e29b-41d4-a716-446655440001",
    name: "PVR Orion Mall",
    address: "Orion Mall, Dr. Rajkumar Road, Rajajinagar, Bangalore",
    geo: { lat: 12.9914, lng: 77.5573 },
    cancellationAvailable: true,
  },
  {
    theatreId: "660e8400-e29b-41d4-a716-446655440002",
    name: "INOX Garuda Mall",
    address: "Garuda Mall, Magrath Road, Ashok Nagar, Bangalore",
    geo: { lat: 12.9704, lng: 77.6099 },
    cancellationAvailable: false,
  },
];

// ==================== Shows ====================

function generateShows(): Show[] {
  const shows: Show[] = [];
  const statuses: ShowStatus[] = ["AVAILABLE", "FILLING_FAST", "ALMOST_FULL"];
  const times = [
    { hours: 10, minutes: 30 },
    { hours: 14, minutes: 0 },
    { hours: 17, minutes: 30 },
    { hours: 21, minutes: 0 },
  ];

  let showCounter = 1;

  // Generate shows for the next 7 days
  for (let day = 0; day < 7; day++) {
    const dateStr = getDateString(day);

    for (const movie of movies) {
      for (const theatre of theatres) {
        // Not all time slots available on all days
        const availableTimes = times.filter((_, idx) => (day + idx) % 3 !== 2);

        for (const time of availableTimes) {
          shows.push({
            showId: `770e8400-e29b-41d4-a716-4466554400${showCounter.toString().padStart(2, "0")}`,
            movieId: movie.movieId,
            theatreId: theatre.theatreId,
            startTime: getShowTime(dateStr, time.hours, time.minutes),
            price: theatre.theatreId.endsWith("01") ? 280 : 320,
            status: statuses[showCounter % 3]!,
          });
          showCounter++;
        }
      }
    }
  }

  return shows;
}

export const shows: Show[] = generateShows();

// ==================== Seat Layout ====================

export const seatLayout: SeatLayout = {
  rows: [
    {
      rowLabel: "A",
      seats: ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"],
    },
    {
      rowLabel: "B",
      seats: ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8"],
    },
    {
      rowLabel: "C",
      seats: ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"],
    },
    {
      rowLabel: "D",
      seats: ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8"],
    },
    {
      rowLabel: "E",
      seats: ["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8"],
    },
  ],
};

// Permanently unavailable seats (e.g., broken, reserved for staff)
export const permanentlyUnavailableSeats: string[] = ["A4", "C6", "E8"];

// ==================== Helper Functions for Data Access ====================

export function getMovieById(movieId: string): Movie | undefined {
  return movies.find((m) => m.movieId === movieId);
}

export function getTheatreById(theatreId: string): Theatre | undefined {
  return theatres.find((t) => t.theatreId === theatreId);
}

export function getShowById(showId: string): Show | undefined {
  return shows.find((s) => s.showId === showId);
}

export function getShowsForMovieOnDate(
  movieId: string,
  date: string
): Show[] {
  return shows.filter(
    (s) => s.movieId === movieId && s.startTime.startsWith(date)
  );
}

export function getAvailableDatesForMovie(
  movieId: string,
  from: string,
  to: string
): string[] {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  const availableDates = new Set<string>();

  for (const show of shows) {
    if (show.movieId !== movieId) continue;
    const showDate = show.startTime.split("T")[0]!;
    const showDateObj = new Date(showDate);
    if (showDateObj >= fromDate && showDateObj <= toDate) {
      availableDates.add(showDate);
    }
  }

  return Array.from(availableDates).sort();
}

export function getAllSeats(): string[] {
  return seatLayout.rows.flatMap((row) => row.seats);
}
