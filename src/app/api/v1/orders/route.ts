import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createOrderSchema } from "@/lib/schemas";
import { createOrder, getHold } from "@/lib/memoryStore";
import { getShowById, getMovieById, getTheatreById } from "@/lib/mockData";
import type { OrderResponse } from "@/lib/types";

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
    const parseResult = createOrderSchema.safeParse(body);

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

    const { holdId, customer } = parseResult.data;

    const result = createOrder(holdId, session.user.id, customer);

    if (result.error) {
      const status = result.error === "Unauthorized" ? 403 :
                     result.error === "Hold not found" ? 404 : 409;
      return NextResponse.json(
        { error: { message: result.error } },
        { status }
      );
    }

    const order = result.order!;
    const hold = getHold(order.holdId)!;

    // Try to get show/movie/theatre from mock data, use defaults if from Lambda
    const show = getShowById(hold.showId);
    const movie = show ? getMovieById(show.movieId) : undefined;
    const theatre = show ? getTheatreById(show.theatreId) : undefined;

    const response: OrderResponse = {
      orderId: order.orderId,
      status: order.status,
      movie: {
        movieId: movie?.movieId ?? order.movieId,
        title: movie?.title ?? "Movie",
      },
      theatre: {
        theatreId: theatre?.theatreId ?? order.theatreId,
        name: theatre?.name ?? "Theatre",
      },
      show: {
        showId: show?.showId ?? hold.showId,
        startTime: show?.startTime ?? new Date().toISOString(),
      },
      seats: order.seatIds,
      amount: order.amount,
      expiresAt: order.expiresAt,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Error creating order:", error);
    return NextResponse.json(
      { error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}
