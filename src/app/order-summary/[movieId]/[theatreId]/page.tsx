import { redirect } from "next/navigation";
import { OrderSummaryClient } from "./OrderSummaryClient";

export default async function OrderSummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ movieId: string; theatreId: string }>;
  searchParams: Promise<{ orderId?: string }>;
}) {
  const { movieId, theatreId } = await params;
  const { orderId } = await searchParams;

  if (!orderId) {
    redirect(`/movies/${movieId}`);
  }

  return (
    <OrderSummaryClient
      orderId={orderId}
      movieId={movieId}
      theatreId={theatreId}
    />
  );
}
