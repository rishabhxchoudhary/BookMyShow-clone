import { NextResponse } from "next/server";
import {
  getMovieById,
  getShowsForMovieOnDate,
  theatres,
} from "@/lib/mockData";
import { showsQuerySchema } from "@/lib/schemas";
import type { ShowsResponse, TheatreWithShows } from "@/lib/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ movieId: string }> }
) {
  try {
    const { movieId } = await params;
    const { searchParams } = new URL(request.url);

    const movie = getMovieById(movieId);
    if (!movie) {
      return NextResponse.json(
        { error: { message: "Movie not found" } },
        { status: 404 }
      );
    }

    const parseResult = showsQuerySchema.safeParse({
      date: searchParams.get("date"),
    });

    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: {
            message: "Invalid query parameters",
            details: parseResult.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const { date } = parseResult.data;
    const shows = getShowsForMovieOnDate(movieId, date);

    // Group shows by theatre
    const theatreMap = new Map<string, TheatreWithShows>();

    for (const theatre of theatres) {
      const theatreShows = shows.filter((s) => s.theatreId === theatre.theatreId);
      if (theatreShows.length > 0) {
        theatreMap.set(theatre.theatreId, {
          ...theatre,
          shows: theatreShows.sort(
            (a, b) =>
              new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
          ),
        });
      }
    }

    const response: ShowsResponse = {
      movieId,
      date,
      theatres: Array.from(theatreMap.values()),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching shows:", error);
    return NextResponse.json(
      { error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}
