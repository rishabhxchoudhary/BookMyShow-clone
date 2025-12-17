import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { bmsAPI, type MovieDetailsResponse } from "@/lib/api-client";
import type { Movie } from "@/lib/types";

async function getMovie(movieId: string): Promise<Movie | null> {
  try {
    const response = await bmsAPI.getMovieById(movieId) as MovieDetailsResponse;
    
    // Transform Lambda API response to match frontend types
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
      cast: [], // Lambda API doesn't provide cast data yet
      crew: [], // Lambda API doesn't provide crew data yet
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
    <div className="min-h-screen">
      {/* Hero Section */}
      <div className="relative h-[400px] w-full overflow-hidden bg-gradient-to-b from-gray-900 to-background">
        <div className="absolute inset-0 bg-black/50" />
        <Image
          src={movie.thumbnailUrl}
          alt={movie.title}
          fill
          className="object-cover opacity-30"
          priority
        />
        <div className="container relative mx-auto flex h-full items-end px-4 pb-8">
          <div className="flex gap-6">
            <div className="relative hidden h-[300px] w-[200px] shrink-0 overflow-hidden rounded-lg shadow-xl sm:block">
              <Image
                src={movie.thumbnailUrl}
                alt={movie.title}
                fill
                className="object-cover"
              />
            </div>
            <div className="flex flex-col justify-end text-white">
              <h1 className="text-3xl font-bold md:text-4xl">{movie.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="bg-green-600 text-white">
                  {movie.rating}/10
                </Badge>
                <span className="text-sm text-gray-300">
                  {formatDuration(movie.durationMins)}
                </span>
                <span className="text-gray-400">|</span>
                <span className="text-sm text-gray-300">{movie.ageRating}</span>
                <span className="text-gray-400">|</span>
                <span className="text-sm text-gray-300">{movie.releaseDate}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {movie.genres.map((genre) => (
                  <Badge key={genre} variant="outline" className="border-gray-400 text-gray-300">
                    {genre}
                  </Badge>
                ))}
              </div>
              <div className="mt-2 text-sm text-gray-300">
                {movie.language} | {movie.format}
              </div>
              <Link href={`/movies/${movieId}/buytickets/${today}`} className="mt-4">
                <Button size="lg" className="bg-rose-600 hover:bg-rose-700">
                  Book Tickets
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* About Section */}
      <div className="container mx-auto px-4 py-8">
        <section className="mb-8">
          <h2 className="mb-4 text-xl font-bold">About the movie</h2>
          <p className="text-muted-foreground">{movie.about}</p>
        </section>

        {/* Cast Section */}
        {movie.cast && movie.cast.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-4 text-xl font-bold">Cast</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {movie.cast.map((member) => (
                <Card key={member.name} className="overflow-hidden">
                  <div className="relative aspect-square">
                    <Image
                      src={member.imageUrl}
                      alt={member.name}
                      fill
                      className="object-cover"
                    />
                  </div>
                  <CardContent className="p-3">
                    <p className="line-clamp-1 text-sm font-medium">{member.name}</p>
                    {member.role && (
                      <p className="line-clamp-1 text-xs text-muted-foreground">
                        as {member.role}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* Crew Section */}
        {movie.crew && movie.crew.length > 0 && (
          <section>
            <h2 className="mb-4 text-xl font-bold">Crew</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {movie.crew.map((member) => (
                <Card key={member.name} className="overflow-hidden">
                  <div className="relative aspect-square">
                    <Image
                      src={member.imageUrl}
                      alt={member.name}
                      fill
                      className="object-cover"
                    />
                  </div>
                  <CardContent className="p-3">
                    <p className="line-clamp-1 text-sm font-medium">{member.name}</p>
                    <p className="line-clamp-1 text-xs text-muted-foreground">
                      {member.role}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
