import Link from "next/link";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { MovieCard as MovieCardType } from "@/lib/types";

interface MovieCardProps {
  movie: MovieCardType;
}

export function MovieCard({ movie }: MovieCardProps) {
  return (
    <Link href={`/movies/${movie.movieId}`}>
      <Card className="group overflow-hidden transition-all hover:shadow-lg">
        <div className="relative aspect-[2/3] overflow-hidden">
          <Image
            src={movie.thumbnailUrl}
            alt={movie.title}
            fill
            className="object-cover transition-transform group-hover:scale-105"
            sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 20vw"
          />
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="bg-green-600 text-white">
                {movie.rating}/10
              </Badge>
            </div>
          </div>
        </div>
        <CardContent className="p-3">
          <h3 className="line-clamp-1 font-semibold">{movie.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {movie.genres.slice(0, 2).join(", ")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {Math.floor(movie.durationMins / 60)}h {movie.durationMins % 60}m
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
