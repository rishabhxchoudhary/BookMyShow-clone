import { NextResponse } from "next/server";
import { getMovieById } from "@/lib/mockData";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ movieId: string }> }
) {
  try {
    const { movieId } = await params;

    const movie = getMovieById(movieId);

    if (!movie) {
      return NextResponse.json(
        { error: { message: "Movie not found" } },
        { status: 404 }
      );
    }

    return NextResponse.json(movie);
  } catch (error) {
    console.error("Error fetching movie:", error);
    return NextResponse.json(
      { error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}
