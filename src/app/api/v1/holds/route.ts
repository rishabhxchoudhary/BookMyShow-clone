import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createHoldSchema } from "@/lib/schemas";

const LAMBDA_HOLDS_URL = process.env.LAMBDA_HOLDS_URL || 'https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod';

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

    // Forward request to Lambda holds service
    const lambdaResponse = await fetch(`${LAMBDA_HOLDS_URL}/holds`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': session.user.id,
      },
      body: JSON.stringify({
        showId,
        seatIds,
        quantity,
      }),
    });

    const data = await lambdaResponse.json();

    if (!lambdaResponse.ok) {
      return NextResponse.json(
        { error: data.error || { message: "Failed to create hold" } },
        { status: lambdaResponse.status }
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("Error creating hold:", error);
    return NextResponse.json(
      { error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}
