import { NextResponse } from "next/server";

const LAMBDA_SEATS_URL = process.env.LAMBDA_SEATS_URL || 'https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ showId: string }> }
) {
  try {
    const { showId } = await params;

    // Forward request directly to Lambda seats service
    // The Lambda service now handles all seat state (Redis-based holds and database-based confirmed seats)
    const lambdaResponse = await fetch(`${LAMBDA_SEATS_URL}/shows/${showId}/seatmap`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await lambdaResponse.json();

    if (!lambdaResponse.ok) {
      return NextResponse.json(
        { error: data.error || { message: "Failed to get seatmap" } },
        { status: lambdaResponse.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching seatmap:", error);
    return NextResponse.json(
      { error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}
