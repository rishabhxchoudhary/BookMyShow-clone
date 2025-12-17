import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { updateHoldSchema } from "@/lib/schemas";
import { getHold, updateHold } from "@/lib/memoryStore";
import type { HoldResponse } from "@/lib/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ holdId: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: { message: "Authentication required" } },
        { status: 401 }
      );
    }

    const { holdId } = await params;
    const hold = getHold(holdId);

    if (!hold) {
      return NextResponse.json(
        { error: { message: "Hold not found" } },
        { status: 404 }
      );
    }

    if (hold.userId !== session.user.id) {
      return NextResponse.json(
        { error: { message: "Unauthorized" } },
        { status: 403 }
      );
    }

    const response: HoldResponse = {
      holdId: hold.holdId,
      showId: hold.showId,
      seatIds: hold.seatIds,
      status: hold.status,
      expiresAt: hold.expiresAt,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching hold:", error);
    return NextResponse.json(
      { error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ holdId: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: { message: "Authentication required" } },
        { status: 401 }
      );
    }

    const { holdId } = await params;
    const body = await request.json();
    const parseResult = updateHoldSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: {
            message: "Invalid request body",
            details: parseResult.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const { seatIds, quantity } = parseResult.data;

    if (seatIds.length !== quantity) {
      return NextResponse.json(
        {
          error: {
            message: "Number of seats must match quantity",
          },
        },
        { status: 400 }
      );
    }

    const result = updateHold(holdId, session.user.id, seatIds, quantity);

    if (result.error) {
      const status = result.error === "Unauthorized" ? 403 :
                     result.error === "Hold not found" ? 404 : 409;
      return NextResponse.json(
        { error: { message: result.error } },
        { status }
      );
    }

    const hold = result.hold!;
    const response: HoldResponse = {
      holdId: hold.holdId,
      showId: hold.showId,
      seatIds: hold.seatIds,
      status: hold.status,
      expiresAt: hold.expiresAt,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error updating hold:", error);
    return NextResponse.json(
      { error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}
