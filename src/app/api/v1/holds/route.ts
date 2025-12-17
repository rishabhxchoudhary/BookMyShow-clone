import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createHoldSchema } from "@/lib/schemas";
import { createHold } from "@/lib/memoryStore";
import type { HoldResponse } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: { message: "Authentication required" } },
        { status: 401 }
      );
    }

    const body = await request.json();
    const parseResult = createHoldSchema.safeParse(body);

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

    const { showId, seatIds, quantity } = parseResult.data;

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

    const result = createHold(showId, session.user.id, seatIds, quantity);

    if (result.error) {
      return NextResponse.json(
        { error: { message: result.error } },
        { status: 409 }
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

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Error creating hold:", error);
    return NextResponse.json(
      { error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}
