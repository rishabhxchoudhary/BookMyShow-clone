import { SeatSelectorLambda } from "@/components/SeatSelectorLambda";

export default async function SeatLayoutPage({
  params,
}: {
  params: Promise<{ movieId: string; theatreId: string; showId: string; date: string }>;
}) {
  const { movieId, theatreId, showId, date } = await params;

  return (
    <SeatSelectorLambda 
      showId={showId}
      movieId={movieId}
      theatreId={theatreId}
      date={date}
    />
  );
}

