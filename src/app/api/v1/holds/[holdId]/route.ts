import { NextResponse } from "next/server";
import { auth } from "@/auth";

const LAMBDA_HOLDS_URL = process.env.LAMBDA_HOLDS_URL || 'https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod';

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

    // Forward request to Lambda holds service
    const lambdaResponse = await fetch(`${LAMBDA_HOLDS_URL}/holds/${holdId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': session.user.id,
      },
    });

    const data = await lambdaResponse.json();

    if (!lambdaResponse.ok) {
      return NextResponse.json(
        { error: data.error || { message: "Failed to get hold" } },
        { status: lambdaResponse.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching hold:", error);
    return NextResponse.json(
      { error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}

// Note: PATCH/UPDATE for holds is no longer supported in the new Redis-based architecture
// Holds are immutable once created. To change seats, release and create new hold.
