import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { releaseHold } from "@/lib/memoryStore";

export async function POST(
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
    const result = releaseHold(holdId, session.user.id);

    if (!result.success) {
      const status = result.error === "Unauthorized" ? 403 :
                     result.error === "Hold not found" ? 404 : 409;
      return NextResponse.json(
        { error: { message: result.error } },
        { status }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error releasing hold:", error);
    return NextResponse.json(
      { error: { message: "Internal server error" } },
      { status: 500 }
    );
  }
}
