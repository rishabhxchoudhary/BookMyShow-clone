import { MovieCard } from "@/components/MovieCard";
import { bmsAPI, type MovieListResponse as APIMovieListResponse } from "@/lib/api-client";
import type { Movie } from "@/lib/types";

async function getMovies(): Promise<{ items: Movie[] }> {
  try {
    const response = await bmsAPI.getMovies(10, 0) as APIMovieListResponse;

    // Transform Lambda API response to match frontend types
    const movies: Movie[] = response.movies.map(movie => ({
      movieId: movie.movie_id,
      title: movie.title,
      about: "",
      thumbnailUrl: movie.thumbnail_url || "https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?w=400&h=600&fit=crop",
      rating: parseFloat(movie.rating || "0"),
      durationMins: movie.duration_mins,
      ageRating: "PG-13",
      releaseDate: new Date().toISOString().split('T')[0] ?? "",
      language: "English",
      format: "2D, IMAX",
      genres: movie.genres,
    }));

    return { items: movies };
  } catch (error) {
    console.error('Failed to fetch movies from Lambda API:', error);
    return { items: [] };
  }
}

export default async function HomePage() {
  const movies = await getMovies();

  if (movies.items.length === 0) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="mb-4">
            <svg className="mx-auto h-16 w-16 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">No movies available</h2>
          <p className="text-gray-500">Please check back later or contact support if the issue persists.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      {/* Hero Banner */}
      <div className="bg-gradient-to-r from-[#1a1a2e] to-[#2d2d44] py-8">
        <div className="container mx-auto px-4">
          <h1 className="text-2xl md:text-3xl font-bold text-white mb-2">
            The best entertainment destination
          </h1>
          <p className="text-gray-300 text-sm md:text-base">
            Book your favorite movies, events, and more
          </p>
        </div>
      </div>

      {/* Movies Section */}
      <div className="container mx-auto px-4 py-8">
        <section className="mb-10">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl md:text-2xl font-bold text-[#1a1a2e]">
              Now Showing
            </h2>
            <span className="text-sm text-[#dc3558] font-medium cursor-pointer hover:underline">
              See All &rarr;
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-5">
            {movies.items.map((movie) => (
              <MovieCard key={movie.movieId} movie={movie} />
            ))}
          </div>
        </section>

        {/* Coming Soon Section */}
        <section className="py-8 border-t border-gray-200">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl md:text-2xl font-bold text-[#1a1a2e]">
              Coming Soon
            </h2>
          </div>
          <div className="bg-white rounded-lg p-8 text-center shadow-sm">
            <p className="text-gray-500">Stay tuned for upcoming releases!</p>
          </div>
        </section>
      </div>
    </div>
  );
}
