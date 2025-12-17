import { notFound } from "next/navigation";
import type { Movie, Theatre, Show, SeatMap } from "@/lib/types";
import { SeatSelector } from "./SeatSelector";

async function getMovie(movieId: string): Promise<Movie | null> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/v1/movies/${movieId}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json();
}

async function getSeatMap(showId: string): Promise<SeatMap | null> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/v1/shows/${showId}/seatmap`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  return res.json();
}

export default async function SeatLayoutPage({
  params,
}: {
  params: Promise<{ movieId: string; theatreId: string; showId: string; date: string }>;
}) {
  const { movieId, theatreId, showId, date } = await params;

  const [movie, seatMap] = await Promise.all([
    getMovie(movieId),
    getSeatMap(showId),
  ]);

  if (!movie || !seatMap) {
    notFound();
  }

  return (
    <SeatSelector
      movie={movie}
      seatMap={seatMap}
      movieId={movieId}
      theatreId={theatreId}
      showId={showId}
      date={date}
    />
  );
}
