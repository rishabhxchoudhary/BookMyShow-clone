import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { bmsAPI, type MovieDetailsResponse } from "@/lib/api-client";
import type { Movie } from "@/lib/types";

async function getMovie(movieId: string): Promise<Movie | null> {
  try {
    const response = await bmsAPI.getMovieById(movieId) as MovieDetailsResponse;

    const movie: Movie = {
      movieId: response.movie_id,
      title: response.title,
      about: response.about,
      thumbnailUrl: response.thumbnail_url || "https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?w=400&h=600&fit=crop",
      rating: parseFloat(response.rating || "0"),
      durationMins: response.duration_mins,
      ageRating: response.age_rating || "PG-13",
      releaseDate: response.release_date,
      language: response.language,
      format: response.format,
      genres: response.genres || [],
      cast: [],
      crew: [],
    };

    return movie;
  } catch (error) {
    console.error('Failed to fetch movie from Lambda API:', error);
    return null;
  }
}

function formatDuration(mins: number): string {
  const hours = Math.floor(mins / 60);
  const minutes = mins % 60;
  return `${hours}h ${minutes}m`;
}

export default async function MovieDetailPage({
  params,
}: {
  params: Promise<{ movieId: string }>;
}) {
  const { movieId } = await params;
  const movie = await getMovie(movieId);

  if (!movie) {
    notFound();
  }

  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      {/* Hero Section */}
      <div className="relative w-full overflow-hidden bg-gradient-to-b from-[#1a1a2e] to-[#2d2d44]">
        <div className="absolute inset-0">
          <Image
            src={movie.thumbnailUrl}
            alt={movie.title}
            fill
            className="object-cover opacity-20 blur-sm"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#1a1a2e] via-[#1a1a2e]/80 to-transparent" />
        </div>

        <div className="container relative mx-auto px-4 py-8 md:py-12">
          <div className="flex flex-col md:flex-row gap-6 md:gap-8">
            {/* Movie Poster */}
            <div className="relative mx-auto md:mx-0 h-[280px] w-[190px] md:h-[350px] md:w-[240px] shrink-0 overflow-hidden rounded-lg shadow-2xl">
              <Image
                src={movie.thumbnailUrl}
                alt={movie.title}
                fill
                className="object-cover"
              />
              {/* Rating Badge on Poster */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-3">
                <div className="flex items-center gap-1.5">
                  <svg className="h-4 w-4 text-[#dc3558]" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                  </svg>
                  <span className="text-sm font-bold text-white">{movie.rating}/10</span>
                </div>
              </div>
            </div>

            {/* Movie Info */}
            <div className="flex flex-col justify-center text-center md:text-left">
              <h1 className="text-2xl md:text-4xl font-bold text-white mb-3">
                {movie.title}
              </h1>

              {/* Meta Info */}
              <div className="flex flex-wrap items-center justify-center md:justify-start gap-2 mb-4">
                <span className="px-2 py-1 bg-white/10 rounded text-sm text-white">
                  {formatDuration(movie.durationMins)}
                </span>
                <span className="px-2 py-1 bg-white/10 rounded text-sm text-white">
                  {movie.ageRating}
                </span>
                <span className="px-2 py-1 bg-white/10 rounded text-sm text-white">
                  {movie.language}
                </span>
              </div>

              {/* Genres */}
              <div className="flex flex-wrap justify-center md:justify-start gap-2 mb-4">
                {movie.genres.map((genre) => (
                  <span key={genre} className="px-3 py-1 border border-white/30 rounded-full text-sm text-white/90">
                    {genre}
                  </span>
                ))}
              </div>

              {/* Release Date */}
              <p className="text-sm text-white/70 mb-6">
                Release Date: {movie.releaseDate} | {movie.format}
              </p>

              {/* Book Button */}
              <div className="flex justify-center md:justify-start">
                <Link href={`/movies/${movieId}/buytickets/${today}`}>
                  <Button size="lg" className="bg-[#dc3558] hover:bg-[#c42a4a] text-white px-8 py-6 text-lg font-semibold rounded-lg shadow-lg">
                    Book Tickets
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* About Section */}
      <div className="container mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="text-xl font-bold text-[#1a1a2e] mb-4">About the movie</h2>
          <p className="text-gray-600 leading-relaxed">
            {movie.about || "No description available for this movie."}
          </p>
        </div>
      </div>
    </div>
  );
}
