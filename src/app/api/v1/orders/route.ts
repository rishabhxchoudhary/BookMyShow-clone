import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createOrderSchema } from "@/lib/schemas";

const LAMBDA_ORDERS_URL = process.env.LAMBDA_ORDERS_URL || 'https://q2f547iwef.execute-api.ap-south-1.amazonaws.com/prod';

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

    // Forward request to Lambda orders service
    const lambdaResponse = await fetch(`${LAMBDA_ORDERS_URL}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': session.user.id,
      },
      body: JSON.stringify({
        holdId,
        customer,
      }),
    });

    const data = await lambdaResponse.json();

    if (!lambdaResponse.ok) {
      return NextResponse.json(
        { error: data.error || { message: "Failed to create order" } },
        { status: lambdaResponse.status }
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("Error creating order:", error);
    return NextResponse.json(
      { error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}
