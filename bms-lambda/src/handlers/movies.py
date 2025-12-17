import json
from typing import Dict, Any, List
from datetime import datetime, timezone

from services.db_service import db_service
from services.redis_service import redis_service
from utils.logger import BMSLogger
from utils.validators import BMSValidator, ValidationError

logger = BMSLogger(__name__)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Movies service Lambda handler"""
    try:
        # Extract HTTP method and path
        http_method = event.get('httpMethod', '')
        path = event.get('path', '')
        path_parameters = event.get('pathParameters') or {}
        query_parameters = event.get('queryStringParameters') or {}
        
        logger.info(f"Movies service request", extra={
            'method': http_method,
            'path': path,
            'path_params': path_parameters,
            'query_params': query_parameters
        })
        
        # Route the request
        if path == '/movies' and http_method == 'GET':
            return get_movies(query_parameters)
        elif path.startswith('/movies/') and path.endswith('/shows') and http_method == 'GET':
            movie_id = path_parameters.get('movieId')
            return get_movie_shows(movie_id, query_parameters)
        elif path.startswith('/movies/') and http_method == 'GET':
            movie_id = path_parameters.get('movieId')
            return get_movie_details(movie_id)
        else:
            return create_error_response(404, "Not Found")
            
    except Exception as e:
        logger.error("Unhandled error in movies service", error=e)
        return create_error_response(500, "Internal Server Error")

def get_movies(query_params: Dict[str, str]) -> Dict[str, Any]:
    """Get paginated list of movies"""
    try:
        # Parse pagination parameters
        limit = min(int(query_params.get('limit', 20)), 100)  # Max 100
        offset = int(query_params.get('offset', 0))
        
        # Try to get from cache first
        cache_key = f"movies:list:{limit}:{offset}"
        
        # Get movies from database
        movies = db_service.get_movies(limit=limit, offset=offset)
        
        # Format response
        response_data = {
            "movies": movies,
            "pagination": {
                "limit": limit,
                "offset": offset,
                "hasMore": len(movies) == limit
            }
        }
        
        # Cache the response briefly
        redis_service._client.setex(
            cache_key, 
            300,  # 5 minutes
            json.dumps(response_data, default=str)
        )
        
        return create_success_response(response_data)
        
    except Exception as e:
        logger.error("Failed to get movies", error=e)
        return create_error_response(500, "Failed to fetch movies")

def get_movie_details(movie_id: str) -> Dict[str, Any]:
    """Get detailed movie information"""
    try:
        # Validate movie ID format
        if not BMSValidator.validate_uuid(movie_id):
            return create_error_response(400, "Invalid movie ID format")
        
        # Try cache first
        cache_key = f"movie:details:{movie_id}"
        cached_movie = redis_service._client.get(cache_key)
        
        if cached_movie:
            logger.info("Movie details served from cache", extra={'movie_id': movie_id})
            return create_success_response(json.loads(cached_movie))
        
        # Get from database
        movie = db_service.get_movie_by_id(movie_id)
        
        if not movie:
            return create_error_response(404, "Movie not found")
        
        # Cache for 1 hour
        redis_service._client.setex(
            cache_key,
            3600,  # 1 hour
            json.dumps(movie, default=str)
        )
        
        return create_success_response(movie)
        
    except Exception as e:
        logger.error("Failed to get movie details", error=e, extra={'movie_id': movie_id})
        return create_error_response(500, "Failed to fetch movie details")

def get_movie_shows(movie_id: str, query_params: Dict[str, str]) -> Dict[str, Any]:
    """Get shows for a movie on specific date"""
    try:
        # Validate movie ID
        if not BMSValidator.validate_uuid(movie_id):
            return create_error_response(400, "Invalid movie ID format")
        
        # Validate date parameter
        date = query_params.get('date')
        if not date:
            return create_error_response(400, "Date parameter is required")
        
        if not BMSValidator.validate_date_format(date):
            return create_error_response(400, "Invalid date format. Use YYYY-MM-DD")
        
        # Try cache first
        cache_key = f"movie:shows:{movie_id}:{date}"
        cached_shows = redis_service._client.get(cache_key)
        
        if cached_shows:
            logger.info("Movie shows served from cache", extra={
                'movie_id': movie_id,
                'date': date
            })
            return create_success_response(json.loads(cached_shows))
        
        # Get shows from database
        shows = db_service.get_shows_by_movie_and_date(movie_id, date)
        
        # Group shows by theatre
        theatres = {}
        for show in shows:
            theatre_id = show['theatre_id']
            
            if theatre_id not in theatres:
                theatres[theatre_id] = {
                    "theatreId": theatre_id,
                    "name": show['theatre_name'],
                    "address": show['address'],
                    "geo": {
                        "lat": float(show['geo_lat']) if show['geo_lat'] else None,
                        "lng": float(show['geo_lng']) if show['geo_lng'] else None
                    },
                    "cancellationAvailable": show['cancellation_available'],
                    "shows": []
                }
            
            theatres[theatre_id]["shows"].append({
                "showId": show['show_id'],
                "startTime": show['start_time'].isoformat() if show['start_time'] else None,
                "price": float(show['price']) if show['price'] else None,
                "status": show['status']
            })
        
        response_data = {
            "movieId": movie_id,
            "date": date,
            "theatres": list(theatres.values())
        }
        
        # Cache for 1 minute (shows can change frequently)
        redis_service._client.setex(
            cache_key,
            60,  # 1 minute
            json.dumps(response_data, default=str)
        )
        
        return create_success_response(response_data)
        
    except Exception as e:
        logger.error("Failed to get movie shows", error=e, extra={
            'movie_id': movie_id,
            'date': query_params.get('date')
        })
        return create_error_response(500, "Failed to fetch movie shows")

def create_success_response(data: Any) -> Dict[str, Any]:
    """Create successful API response"""
    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        },
        'body': json.dumps(data, default=str)
    }

def create_error_response(status_code: int, message: str) -> Dict[str, Any]:
    """Create error API response"""
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        'body': json.dumps({
            'error': {
                'message': message,
                'timestamp': datetime.now(timezone.utc).isoformat()
            }
        })
    }