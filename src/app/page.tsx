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
      about: "", // Will be fetched on detail page
      thumbnailUrl: movie.thumbnail_url || "https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?w=400&h=600&fit=crop",
      rating: parseFloat(movie.rating || "0"),
      durationMins: movie.duration_mins,
      ageRating: "PG-13", // Default, can be fetched from detail API
      releaseDate: new Date().toISOString().split('T')[0], // Default
      language: "English", // Default
      format: "2D, IMAX", // Default
      genres: movie.genres,
    }));

    return { items: movies };
  } catch (error) {
    console.error('Failed to fetch movies from Lambda API:', error);
    // Fallback to empty array if API fails
    return { items: [] };
  }
}

export default async function HomePage() {
  const movies = await getMovies();

  if (movies.items.length === 0) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center py-12">
          <h2 className="text-2xl font-bold mb-4">No movies available</h2>
          <p className="text-gray-600">Please check back later or contact support if the issue persists.</p>
        </div>
      </div>
    );
  }

  // Split movies into two sections for variety
  const midpoint = Math.ceil(movies.items.length / 2);
  const recommended = movies.items.slice(0, midpoint);
  const trending = movies.items.slice(midpoint);

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Recommended Movies */}
      <section className="mb-12">
        <h2 className="mb-6 text-2xl font-bold">Recommended Movies</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {recommended.map((movie) => (
            <MovieCard key={movie.movieId} movie={movie} />
          ))}
        </div>
      </section>

      {/* Trending Movies */}
      {trending.length > 0 && (
        <section>
          <h2 className="mb-6 text-2xl font-bold">More Movies</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {trending.map((movie) => (
              <MovieCard key={movie.movieId} movie={movie} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
