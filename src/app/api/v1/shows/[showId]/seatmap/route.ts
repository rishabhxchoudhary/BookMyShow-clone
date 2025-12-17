import { NextResponse } from "next/server";
import { getShowById, seatLayout, getTheatreById } from "@/lib/mockData";
import { getUnavailableSeatIdsForShow, getHeldSeatIdsForShow } from "@/lib/memoryStore";
import type { SeatMap } from "@/lib/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ showId: string }> }
) {
  try {
    const { showId } = await params;

    const show = getShowById(showId);
    if (!show) {
      return NextResponse.json(
        { error: { message: "Show not found" } },
        { status: 404 }
      );
    }

    const theatre = getTheatreById(show.theatreId);
    if (!theatre) {
      return NextResponse.json(
        { error: { message: "Theatre not found" } },
        { status: 404 }
      );
    }

    const unavailableSeatIds = getUnavailableSeatIdsForShow(showId);
    const heldSeatIds = getHeldSeatIdsForShow(showId);

    const response: SeatMap = {
      showId,
      theatreId: show.theatreId,
      screenName: "Screen 1",
      price: show.price,
      layout: seatLayout,
      unavailableSeatIds,
      heldSeatIds,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching seatmap:", error);
    return NextResponse.json(
      { error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}
