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

def get_seat_layout_for_theatre(theatre_id: str) -> Dict[str, Any]:
    """Get seat layout for a theatre (mock implementation)"""
    # In production, this would come from a theatre configuration table
    return {
        "rows": [
            {
                "rowId": "A",
                "seats": [
                    {"seatId": "A1", "type": "regular"},
                    {"seatId": "A2", "type": "regular"},
                    {"seatId": "A3", "type": "regular"},
                    {"seatId": "A4", "type": "regular"},
                    {"seatId": "A5", "type": "regular"},
                    {"seatId": "A6", "type": "regular"},
                    {"seatId": "A7", "type": "regular"},
                    {"seatId": "A8", "type": "regular"},
                    {"seatId": "A9", "type": "regular"},
                    {"seatId": "A10", "type": "regular"}
                ]
            },
            {
                "rowId": "B",
                "seats": [
                    {"seatId": "B1", "type": "regular"},
                    {"seatId": "B2", "type": "regular"},
                    {"seatId": "B3", "type": "regular"},
                    {"seatId": "B4", "type": "regular"},
                    {"seatId": "B5", "type": "regular"},
                    {"seatId": "B6", "type": "regular"},
                    {"seatId": "B7", "type": "regular"},
                    {"seatId": "B8", "type": "regular"},
                    {"seatId": "B9", "type": "regular"},
                    {"seatId": "B10", "type": "regular"}
                ]
            },
            {
                "rowId": "C",
                "seats": [
                    {"seatId": "C1", "type": "premium"},
                    {"seatId": "C2", "type": "premium"},
                    {"seatId": "C3", "type": "premium"},
                    {"seatId": "C4", "type": "premium"},
                    {"seatId": "C5", "type": "premium"},
                    {"seatId": "C6", "type": "premium"},
                    {"seatId": "C7", "type": "premium"},
                    {"seatId": "C8", "type": "premium"},
                    {"seatId": "C9", "type": "premium"},
                    {"seatId": "C10", "type": "premium"}
                ]
            },
            {
                "rowId": "D",
                "seats": [
                    {"seatId": "D1", "type": "premium"},
                    {"seatId": "D2", "type": "premium"},
                    {"seatId": "D3", "type": "premium"},
                    {"seatId": "D4", "type": "premium"},
                    {"seatId": "D5", "type": "premium"},
                    {"seatId": "D6", "type": "premium"},
                    {"seatId": "D7", "type": "premium"},
                    {"seatId": "D8", "type": "premium"},
                    {"seatId": "D9", "type": "premium"},
                    {"seatId": "D10", "type": "premium"}
                ]
            }
        ],
        "totalSeats": 40,
        "priceMap": {
            "regular": 150.0,
            "premium": 250.0
        }
    }

def get_permanently_unavailable_seats(show_id: str) -> List[str]:
    """Get permanently unavailable seats (broken, maintenance, etc.)"""
    # In production, this would come from database based on theatre/show
    # For now, return some static broken seats
    return ["A5", "B10", "C15"]  # Example broken seats

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
    """Update hold with new seats"""
    return create_error_response(501, "Update hold not yet implemented")

