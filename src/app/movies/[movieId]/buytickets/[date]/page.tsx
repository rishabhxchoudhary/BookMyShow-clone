import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    const movie = await bmsAPI.getMovieById(movieId);
    return movie;
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

async function getShows(movieId: string, date: string): Promise<ShowsResponse> {
  try {
    const response = await bmsAPI.getMovieShows(movieId, date);
    
    // Transform the response to match frontend expectations
    const transformedResponse: ShowsResponse = {
      movieId: response.movieId,
      date: response.date,
      theatres: response.theatres.map((theatre: any) => ({
        theatreId: theatre.theatreId,
        name: theatre.name,
        address: theatre.address,
        geo: theatre.geo,
        cancellationAvailable: theatre.cancellationAvailable,
        shows: theatre.shows.map((show: any) => ({
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
      return <Badge variant="success" className="text-xs">Available</Badge>;
    case "FILLING_FAST":
      return <Badge variant="warning" className="text-xs">Filling Fast</Badge>;
    case "ALMOST_FULL":
      return <Badge variant="destructive" className="text-xs">Almost Full</Badge>;
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
    <div className="container mx-auto px-4 py-6">
      {/* Movie Title */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{movie.title}</h1>
        <p className="text-sm text-muted-foreground">
          {movie.language} | {movie.format} | {movie.ageRating}
        </p>
      </div>

      {/* Date Selector */}
      <div className="mb-8">
        <div className="flex gap-2 overflow-x-auto pb-2">
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
                  className={`flex w-16 flex-col items-center rounded-lg border p-2 transition-colors ${
                    isSelected
                      ? "border-rose-600 bg-rose-600 text-white"
                      : isAvailable
                        ? "border-border hover:border-rose-600"
                        : "border-border bg-muted text-muted-foreground opacity-50"
                  }`}
                >
                  <span className="text-xs font-medium">{formatted.day}</span>
                  <span className="text-lg font-bold">{formatted.date}</span>
                  <span className="text-xs">{formatted.month}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Theatre Listings */}
      <div className="space-y-4">
        {shows.theatres.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground">No shows available for this date.</p>
            </CardContent>
          </Card>
        ) : (
          shows.theatres.map((theatre) => (
            <Card key={theatre.theatreId}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{theatre.name}</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {theatre.address}
                    </p>
                  </div>
                  {theatre.cancellationAvailable && (
                    <Badge variant="outline" className="shrink-0 text-green-600">
                      Cancellation Available
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
                  {theatre.shows.map((show) => (
                    <Link
                      key={show.showId}
                      href={`/seat-layout/${movieId}/${theatre.theatreId}/${show.showId}/${date}`}
                    >
                      <Button
                        variant="outline"
                        className="group relative h-auto flex-col items-start gap-1 py-2"
                      >
                        <span className="font-semibold text-green-600 group-hover:text-green-700">
                          {formatShowTime(show.startTime)}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Rs. {show.price}
                        </span>
                        <div className="mt-1">
                          {getStatusBadge(show.status)}
                        </div>
                      </Button>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
