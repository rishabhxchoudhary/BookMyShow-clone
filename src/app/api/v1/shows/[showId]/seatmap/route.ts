import { NextResponse } from "next/server";
import { getHeldSeatIdsForShow, getConfirmedSeatIdsForShow } from "@/lib/memoryStore";
import { bmsAPI, type SeatmapResponse } from "@/lib/api-client";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ showId: string }> }
) {
  try {
    const { showId } = await params;

    // Fetch base seatmap from Lambda API
    const lambdaSeatmap = await bmsAPI.getSeatmap(showId) as SeatmapResponse;

    // Get locally held and confirmed seats
    const localHeldSeats = getHeldSeatIdsForShow(showId);
    const localConfirmedSeats = getConfirmedSeatIdsForShow(showId);

    // Merge Lambda unavailable seats with local holds/confirmed seats
    const allUnavailable = [
      ...new Set([
        ...lambdaSeatmap.unavailableSeatIds,
        ...localConfirmedSeats,
      ])
    ];

    const allHeld = [
      ...new Set([
        ...lambdaSeatmap.heldSeatIds,
        ...localHeldSeats,
      ])
    ];

    // Return combined seatmap
    const response = {
      ...lambdaSeatmap,
      unavailableSeatIds: allUnavailable,
      heldSeatIds: allHeld,
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
