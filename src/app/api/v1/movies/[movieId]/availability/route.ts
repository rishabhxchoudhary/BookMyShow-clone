import { NextResponse } from "next/server";
import { getMovieById, getAvailableDatesForMovie } from "@/lib/mockData";
import { availabilityQuerySchema } from "@/lib/schemas";
import type { AvailabilityResponse } from "@/lib/types";

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

    const parseResult = availabilityQuerySchema.safeParse({
      from: searchParams.get("from"),
      to: searchParams.get("to"),
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

    const { from, to } = parseResult.data;
    const availableDates = getAvailableDatesForMovie(movieId, from, to);

    const response: AvailabilityResponse = {
      movieId,
      availableDates,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching availability:", error);
    return NextResponse.json(
      { error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}
