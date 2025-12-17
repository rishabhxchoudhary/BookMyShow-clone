import Link from "next/link";
import Image from "next/image";
import type { MovieCard as MovieCardType } from "@/lib/types";

interface MovieCardProps {
  movie: MovieCardType;
}

export function MovieCard({ movie }: MovieCardProps) {
  return (
    <Link href={`/movies/${movie.movieId}`} className="group block">
      <div className="relative overflow-hidden rounded-lg shadow-md transition-all duration-300 group-hover:shadow-xl group-hover:-translate-y-1">
        <div className="relative aspect-[2/3] overflow-hidden bg-gray-100">
          <Image
            src={movie.thumbnailUrl}
            alt={movie.title}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            sizes="(max-width: 768px) 50vw, (max-width: 1200px) 33vw, 20vw"
          />
          {/* Rating Badge */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent px-3 pb-3 pt-10">
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-1 rounded bg-[#1a1a2e]/90 px-1.5 py-0.5">
                <svg className="h-3 w-3 text-[#dc3558]" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                </svg>
                <span className="text-xs font-semibold text-white">{movie.rating}/10</span>
              </div>
            </div>
          </div>
        </div>
        {/* Movie Info */}
        <div className="bg-white p-3">
          <h3 className="line-clamp-1 text-sm font-semibold text-[#1a1a2e] group-hover:text-[#dc3558] transition-colors">
            {movie.title}
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            {movie.genres.slice(0, 2).join(" / ")}
          </p>
        </div>
      </div>
    </Link>
  );
}
