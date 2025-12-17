import { NextResponse } from "next/server";
import { auth } from "@/auth";
import type { OrderResponse } from "@/lib/types";

const LAMBDA_ORDERS_URL = process.env.LAMBDA_ORDERS_URL || 'https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod';

// Transform Lambda response to frontend OrderResponse format
function transformOrderResponse(lambdaData: {
  orderId: string;
  showId: string;
  seatIds: string[];
  amount: number;
  status: string;
  movieTitle?: string;
  theatreName?: string;
  showTime?: string;
  ticketCode?: string;
  expiresAt?: string;
  movie_id?: string;
  theatre_id?: string;
}): OrderResponse {
  return {
    orderId: lambdaData.orderId,
    status: lambdaData.status as OrderResponse['status'],
    movie: {
      movieId: lambdaData.movie_id || '',
      title: lambdaData.movieTitle || 'Unknown Movie',
    },
    theatre: {
      theatreId: lambdaData.theatre_id || '',
      name: lambdaData.theatreName || 'Unknown Theatre',
    },
    show: {
      showId: lambdaData.showId,
      startTime: lambdaData.showTime || '',
    },
    seats: lambdaData.seatIds,
    amount: lambdaData.amount,
    expiresAt: lambdaData.expiresAt || '',
    ticketCode: lambdaData.ticketCode,
  };
}

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

    // Transform Lambda response to frontend format
    const transformedData = transformOrderResponse(data);

    return NextResponse.json(transformedData);
  } catch (error) {
    console.error("Error fetching order:", error);
    return NextResponse.json(
      { error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}
