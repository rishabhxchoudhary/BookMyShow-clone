import { NextResponse } from "next/server";
import { movies } from "@/lib/mockData";
import { movieListQuerySchema } from "@/lib/schemas";
import type { MovieCard, MovieListResponse } from "@/lib/types";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const parseResult = movieListQuerySchema.safeParse({
      category: searchParams.get("category") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      cursor: searchParams.get("cursor") ?? undefined,
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

    const { category, limit } = parseResult.data;

    // Filter movies based on category (mock: all movies are both recommended and trending)
    let filteredMovies = movies;

    // For demo purposes, if trending is requested, reverse the order
    if (category === "trending") {
      filteredMovies = [...movies].reverse();
    }

    // Map to MovieCard format
    const items: MovieCard[] = filteredMovies.slice(0, limit).map((movie) => ({
      movieId: movie.movieId,
      title: movie.title,
      thumbnailUrl: movie.thumbnailUrl,
      rating: movie.rating,
      genres: movie.genres,
      durationMins: movie.durationMins,
    }));

    const response: MovieListResponse = {
      items,
      nextCursor: null, // No pagination for mock data
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching movies:", error);
    return NextResponse.json(
      { error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}
