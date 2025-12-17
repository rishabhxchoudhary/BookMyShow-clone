import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { confirmOrderPayment, getOrder } from "@/lib/memoryStore";
import { getShowById, getMovieById, getTheatreById } from "@/lib/mockData";
import type { OrderResponse } from "@/lib/types";

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
    const result = confirmOrderPayment(orderId, session.user.id);

    if (result.error) {
      const status = result.error === "Unauthorized" ? 403 :
                     result.error === "Order not found" ? 404 : 409;
      return NextResponse.json(
        { error: { message: result.error } },
        { status }
      );
    }

    const order = result.order!;
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
    console.error("Error confirming payment:", error);
    return NextResponse.json(
      { error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}
