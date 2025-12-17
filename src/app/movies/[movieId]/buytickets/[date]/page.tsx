import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { bmsAPI } from "@/lib/api-client";
import type { Movie, AvailabilityResponse, ShowsResponse, Show, ShowStatus } from "@/lib/types";

// Map Lambda API status to frontend ShowStatus
function mapShowStatus(lambdaStatus: string): ShowStatus {
  switch (lambdaStatus.toLowerCase()) {
    case 'active':
      return 'AVAILABLE';
    case 'filling_fast':
      return 'FILLING_FAST';
    case 'almost_full':
      return 'ALMOST_FULL';
    default:
      return 'AVAILABLE';
  }
}

async function getMovie(movieId: string): Promise<Movie | null> {
  try {
    const response = await bmsAPI.getMovieById(movieId) as { title: string; language?: string; format?: string; age_rating?: string } | null;
    if (!response) return null;
    return {
      movieId,
      title: response.title,
      about: "",
      thumbnailUrl: "",
      rating: 0,
      durationMins: 0,
      ageRating: response.age_rating || "PG-13",
      releaseDate: "",
      language: response.language || "English",
      format: response.format || "2D",
      genres: [],
    };
  } catch (error) {
    console.error('Error fetching movie:', error);
    return null;
  }
}

async function getAvailability(movieId: string): Promise<AvailabilityResponse> {
  // Generate the next 7 days as available dates for now
  // TODO: Implement proper availability API in Lambda backend
  const availableDates: string[] = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
    availableDates.push(d.toISOString().split("T")[0]!);
  }
  
  return {
    movieId,
    availableDates
  };
}

interface LambdaShowsResponse {
  movieId: string;
  date: string;
  theatres: Array<{
    theatreId: string;
    name: string;
    address: string;
    geo?: { lat: number; lng: number };
    cancellationAvailable: boolean;
    shows: Array<{
      showId: string;
      startTime: string;
      price: number;
      status: string;
    }>;
  }>;
}

async function getShows(movieId: string, date: string): Promise<ShowsResponse> {
  try {
    const response = await bmsAPI.getMovieShows(movieId, date) as LambdaShowsResponse;

    // Transform the response to match frontend expectations
    const transformedResponse: ShowsResponse = {
      movieId: response.movieId,
      date: response.date,
      theatres: response.theatres.map((theatre) => ({
        theatreId: theatre.theatreId,
        name: theatre.name,
        address: theatre.address,
        geo: theatre.geo ?? { lat: 0, lng: 0 },
        cancellationAvailable: theatre.cancellationAvailable,
        shows: theatre.shows.map((show) => ({
          showId: show.showId,
          movieId: movieId,
          theatreId: theatre.theatreId,
          startTime: show.startTime,
          price: show.price,
          status: mapShowStatus(show.status)
        }))
      }))
    };

    return transformedResponse;
  } catch (error) {
    console.error('Error fetching shows:', error);
    throw new Error("Failed to fetch shows");
  }
}

function formatDate(dateStr: string): { day: string; date: string; month: string } {
  const date = new Date(dateStr);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return {
    day: days[date.getDay()]!,
    date: date.getDate().toString(),
    month: months[date.getMonth()]!,
  };
}

function formatShowTime(startTime: string): string {
  const date = new Date(startTime);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function getStatusBadge(status: Show["status"]) {
  switch (status) {
    case "AVAILABLE":
      return <span className="text-xs text-green-600 font-medium">Available</span>;
    case "FILLING_FAST":
      return <span className="text-xs text-orange-500 font-medium">Filling Fast</span>;
    case "ALMOST_FULL":
      return <span className="text-xs text-red-500 font-medium">Almost Full</span>;
  }
}

export default async function BuyTicketsPage({
  params,
}: {
  params: Promise<{ movieId: string; date: string }>;
}) {
  const { movieId, date } = await params;

  const [movie, availability, shows] = await Promise.all([
    getMovie(movieId),
    getAvailability(movieId),
    getShows(movieId, date),
  ]);

  if (!movie) {
    notFound();
  }

  // Generate all dates for the next 7 days
  const allDates: string[] = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
    allDates.push(d.toISOString().split("T")[0]!);
  }

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      {/* Header */}
      <div className="bg-white border-b shadow-sm">
        <div className="container mx-auto px-4 py-4">
          <h1 className="text-xl font-bold text-[#1a1a2e]">{movie.title}</h1>
          <p className="text-sm text-gray-500">
            {movie.language} | {movie.format} | {movie.ageRating}
          </p>
        </div>
      </div>

      {/* Date Selector */}
      <div className="bg-white border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
            {allDates.map((d) => {
              const formatted = formatDate(d);
              const isAvailable = availability.availableDates.includes(d);
              const isSelected = d === date;

              return (
                <Link
                  key={d}
                  href={isAvailable ? `/movies/${movieId}/buytickets/${d}` : "#"}
                  className={`shrink-0 ${!isAvailable ? "pointer-events-none" : ""}`}
                >
                  <div
                    className={`flex w-16 flex-col items-center rounded-lg p-2 transition-all ${
                      isSelected
                        ? "bg-[#dc3558] text-white shadow-md"
                        : isAvailable
                          ? "bg-white border border-gray-200 hover:border-[#dc3558] hover:text-[#dc3558]"
                          : "bg-gray-100 text-gray-400 cursor-not-allowed"
                    }`}
                  >
                    <span className="text-xs font-medium uppercase">{formatted.day}</span>
                    <span className="text-xl font-bold">{formatted.date}</span>
                    <span className="text-xs uppercase">{formatted.month}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Theatre Listings */}
      <div className="container mx-auto px-4 py-6">
        <div className="space-y-4">
          {shows.theatres.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm p-8 text-center">
              <svg className="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-gray-500">No shows available for this date.</p>
            </div>
          ) : (
            shows.theatres.map((theatre) => (
              <div key={theatre.theatreId} className="bg-white rounded-lg shadow-sm overflow-hidden">
                <div className="p-4 border-b">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-[#1a1a2e]">{theatre.name}</h3>
                      <p className="text-sm text-gray-500 mt-1">{theatre.address}</p>
                    </div>
                    {theatre.cancellationAvailable && (
                      <span className="text-xs text-green-600 font-medium bg-green-50 px-2 py-1 rounded">
                        Cancellation Available
                      </span>
                    )}
                  </div>
                </div>
                <div className="p-4">
                  <div className="flex flex-wrap gap-3">
                    {theatre.shows.map((show) => (
                      <Link
                        key={show.showId}
                        href={`/seat-layout/${movieId}/${theatre.theatreId}/${show.showId}/${date}`}
                      >
                        <Button
                          variant="outline"
                          className="h-auto py-3 px-4 border-green-500 hover:bg-green-50 flex flex-col items-center min-w-[90px]"
                        >
                          <span className="font-semibold text-green-600">
                            {formatShowTime(show.startTime)}
                          </span>
                          <span className="text-xs text-gray-500 mt-1">
                            Rs. {show.price}
                          </span>
                          <div className="mt-1">
                            {getStatusBadge(show.status)}
                          </div>
                        </Button>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
