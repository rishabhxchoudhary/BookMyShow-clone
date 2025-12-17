import { NextResponse } from "next/server";
import { auth } from "@/auth";
import type { OrderResponse } from "@/lib/types";

const LAMBDA_ORDERS_URL = process.env.LAMBDA_ORDERS_URL || 'https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod';

export async function POST(
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
    const lambdaResponse = await fetch(`${LAMBDA_ORDERS_URL}/orders/${orderId}/confirm-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': session.user.id,
      },
    });

    const confirmData = await lambdaResponse.json();

    if (!lambdaResponse.ok) {
      return NextResponse.json(
        { error: confirmData.error || { message: "Failed to confirm payment" } },
        { status: lambdaResponse.status }
      );
    }

    // Fetch the full order details after confirmation
    const orderResponse = await fetch(`${LAMBDA_ORDERS_URL}/orders/${orderId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': session.user.id,
      },
    });

    if (!orderResponse.ok) {
      // If we can't fetch the order, return the confirm data with status
      return NextResponse.json({
        orderId: confirmData.orderId,
        status: confirmData.status,
        ticketCode: confirmData.ticketCode,
        message: confirmData.message,
      });
    }

    const orderData = await orderResponse.json();

    // Transform to frontend format
    const transformedData: OrderResponse = {
      orderId: orderData.orderId,
      status: orderData.status as OrderResponse['status'],
      movie: {
        movieId: orderData.movie_id || '',
        title: orderData.movieTitle || 'Unknown Movie',
      },
      theatre: {
        theatreId: orderData.theatre_id || '',
        name: orderData.theatreName || 'Unknown Theatre',
      },
      show: {
        showId: orderData.showId,
        startTime: orderData.showTime || '',
      },
      seats: orderData.seatIds,
      amount: orderData.amount,
      expiresAt: orderData.expiresAt || '',
      ticketCode: orderData.ticketCode || confirmData.ticketCode,
    };

    return NextResponse.json(transformedData);
  } catch (error) {
    console.error("Error confirming payment:", error);
    return NextResponse.json(
      { error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}
