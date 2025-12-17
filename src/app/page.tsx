import { MovieCard } from "@/components/MovieCard";
import type { MovieListResponse } from "@/lib/types";

async function getMovies(category: "recommended" | "trending"): Promise<MovieListResponse> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const res = await fetch(`${baseUrl}/api/v1/movies?category=${category}&limit=10`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error("Failed to fetch movies");
  }

  return res.json();
}

export default async function HomePage() {
  const [recommended, trending] = await Promise.all([
    getMovies("recommended"),
    getMovies("trending"),
  ]);

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Recommended Movies */}
      <section className="mb-12">
        <h2 className="mb-6 text-2xl font-bold">Recommended Movies</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {recommended.items.map((movie) => (
            <MovieCard key={movie.movieId} movie={movie} />
          ))}
        </div>
      </section>

      {/* Trending Movies */}
      <section>
        <h2 className="mb-6 text-2xl font-bold">Trending Now</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {trending.items.map((movie) => (
            <MovieCard key={movie.movieId} movie={movie} />
          ))}
        </div>
      </section>
    </div>
  );
}
