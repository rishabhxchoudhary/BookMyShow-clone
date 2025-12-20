import json
from typing import Dict, Any, List
from datetime import datetime, timezone

from services.db_service import db_service
from services.redis_service import redis_service
from utils.logger import BMSLogger
from utils.validators import BMSValidator

logger = BMSLogger(__name__)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Seats/Seatmap service Lambda handler"""
    try:
        # Extract HTTP method and path
        http_method = event.get('httpMethod', '')
        path = event.get('path', '')
        path_parameters = event.get('pathParameters') or {}
        
        logger.info(f"Seatmap service request", extra={
            'method': http_method,
            'path': path,
            'path_params': path_parameters
        })
        
        # Route the request - only seatmap endpoint
        if path.startswith('/shows/') and path.endswith('/seatmap') and http_method == 'GET':
            show_id = path_parameters.get('showId')
            return get_seatmap(show_id)
        else:
            return create_error_response(404, "Not Found")
            
    except Exception as e:
        logger.error("Unhandled error in seatmap service", error=e)
        return create_error_response(500, "Internal Server Error")

def get_seatmap(show_id: str) -> Dict[str, Any]:
    """Get seat layout and availability for a show"""
    try:
        # Validate show ID
        if not BMSValidator.validate_uuid(show_id):
            return create_error_response(400, "Invalid show ID format")
        
        # Check cache first
        cached_data = redis_service.get_cached_seat_availability(show_id)
        if cached_data:
            logger.info("Returning cached seatmap", extra={'show_id': show_id})
            return create_success_response(cached_data)
        
        # Get show details from database
        show = db_service.get_show_by_id(show_id)
        if not show:
            return create_error_response(404, "Show not found")
        
        # Get seat layout from database or generate mock layout
        seat_layout = get_seat_layout_for_theatre(show.get('theatre_id'))
        
        # Get confirmed seats from database (permanently booked)
        confirmed_seats = db_service.get_confirmed_seats_for_show(show_id)
        
        # Get locked seats from Redis (temporary holds)
        locked_seats = redis_service.get_locked_seats_for_show(show_id)
        
        # Get permanently unavailable seats (broken, etc.)
        permanently_unavailable = get_permanently_unavailable_seats(show_id)
        
        # Combine all unavailable seats
        unavailable_seats = list(set(confirmed_seats + permanently_unavailable))
        
        seatmap_data = {
            "showId": show_id,
            "movieTitle": show.get('movie_title', ''),
            "theatreName": show.get('theatre_name', ''),
            "startTime": show['start_time'].isoformat() if show.get('start_time') else None,
            "price": float(show['price']) if show.get('price') else 0,
            "layout": seat_layout,
            "unavailableSeatIds": unavailable_seats,
            "heldSeatIds": locked_seats  # Temporarily held by users
        }
        
        # Cache the result for 10 seconds to reduce load
        redis_service.cache_seat_availability(show_id, seatmap_data, ttl=10)
        
        return create_success_response(seatmap_data)
        
    except Exception as e:
        logger.error("Failed to get seatmap", error=e, extra={'show_id': show_id})
        return create_error_response(500, "Failed to fetch seat map")

def get_seat_layout_for_theatre(theatre_id: str) -> List[Dict[str, Any]]:
    """Get seat layout for a theatre (mock implementation)"""
    # In production, this would come from a theatre configuration table
    # Return flat array of seat objects as expected by frontend
    seats = []
    
    # Generate seats for rows A-J with 10 seats each
    for row_letter in ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']:
        for seat_num in range(1, 11):
            seats.append({
                "seatId": f"{row_letter}{seat_num}",
                "row": row_letter,
                "number": seat_num,
                "type": "regular"
            })
    
    return seats

def get_permanently_unavailable_seats(show_id: str) -> List[str]:
    """Get permanently unavailable seats (broken, maintenance, etc.)"""
    # In production, this would come from database based on theatre/show
    # For now, return some static broken seats (valid seats: A1-J10)
    return ["A5", "B10", "C8"]  # Example broken seats

def create_success_response(data: Any) -> Dict[str, Any]:
    """Create successful API response"""
    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id'
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

