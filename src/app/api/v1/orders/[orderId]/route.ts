import { NextResponse } from "next/server";
import { auth } from "@/auth";

const LAMBDA_ORDERS_URL = process.env.LAMBDA_ORDERS_URL || 'https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: { message: "Authentication required" } },
        { status: 401 }
      );
    }

    const { orderId } = await params;

    // Forward request to Lambda orders service
    const lambdaResponse = await fetch(`${LAMBDA_ORDERS_URL}/orders/${orderId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': session.user.id,
      },
    });

    const data = await lambdaResponse.json();

    if (!lambdaResponse.ok) {
      return NextResponse.json(
        { error: data.error || { message: "Failed to get order" } },
        { status: lambdaResponse.status }
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching order:", error);
    return NextResponse.json(
      { error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}
