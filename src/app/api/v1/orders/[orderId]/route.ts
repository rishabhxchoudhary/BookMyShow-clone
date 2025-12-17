import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOrder } from "@/lib/memoryStore";
import { getShowById, getMovieById, getTheatreById } from "@/lib/mockData";
import type { OrderResponse } from "@/lib/types";

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
    const order = getOrder(orderId);

    if (!order) {
      return NextResponse.json(
        { error: { message: "Order not found" } },
        { status: 404 }
      );
    }

    if (order.userId !== session.user.id) {
      return NextResponse.json(
        { error: { message: "Unauthorized" } },
        { status: 403 }
      );
    }

    const show = getShowById(order.showId)!;
    const movie = getMovieById(show.movieId)!;
    const theatre = getTheatreById(show.theatreId)!;

    const response: OrderResponse = {
      orderId: order.orderId,
      status: order.status,
      movie: {
        movieId: movie.movieId,
        title: movie.title,
      },
      theatre: {
        theatreId: theatre.theatreId,
        name: theatre.name,
      },
      show: {
        showId: show.showId,
        startTime: show.startTime,
      },
      seats: order.seatIds,
      amount: order.amount,
      expiresAt: order.expiresAt,
      ticketCode: order.ticketCode,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching order:", error);
    return NextResponse.json(
      { error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}
