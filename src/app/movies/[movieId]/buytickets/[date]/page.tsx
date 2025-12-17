import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Movie, AvailabilityResponse, ShowsResponse, Show } from "@/lib/types";

async function getMovie(movieId: string): Promise<Movie | null> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/v1/movies/${movieId}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json();
}

async function getAvailability(movieId: string): Promise<AvailabilityResponse> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const today = new Date();
  const from = today.toISOString().split("T")[0];
  const to = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const res = await fetch(
    `${baseUrl}/api/v1/movies/${movieId}/availability?from=${from}&to=${to}`,
    { cache: "no-store" }
  );

  if (!res.ok) throw new Error("Failed to fetch availability");
  return res.json();
}

async function getShows(movieId: string, date: string): Promise<ShowsResponse> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/v1/movies/${movieId}/shows?date=${date}`, {
    cache: "no-store",
  });

  if (!res.ok) throw new Error("Failed to fetch shows");
  return res.json();
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
