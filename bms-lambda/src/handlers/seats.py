import json
import uuid
from typing import Dict, Any, List
from datetime import datetime, timezone, timedelta

from services.db_service import db_service
from services.redis_service import redis_service
from services.sqs_service import sqs_service
from utils.logger import BMSLogger
from utils.validators import BMSValidator, ValidationError
from utils.config import config

logger = BMSLogger(__name__)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Seats service Lambda handler"""
    try:
        # Extract HTTP method and path
        http_method = event.get('httpMethod', '')
        path = event.get('path', '')
        path_parameters = event.get('pathParameters') or {}
        query_parameters = event.get('queryStringParameters') or {}
        body = event.get('body', '')
        
        logger.info(f"Seats service request", extra={
            'method': http_method,
            'path': path,
            'path_params': path_parameters,
            'query_params': query_parameters
        })
        
        # Extract user info from authorization (in production, decode JWT)
        # For now, we'll extract from headers or use a test user
        headers = event.get('headers', {})
        user_id = headers.get('x-user-id', 'test-user-123')  # In production: decode JWT
        
        # Route the request
        if path.startswith('/shows/') and path.endswith('/seatmap') and http_method == 'GET':
            show_id = path_parameters.get('showId')
            return get_seatmap(show_id)
        elif path == '/holds' and http_method == 'POST':
            return create_hold(body, user_id)
        elif path.startswith('/holds/') and not path.endswith('/') and http_method == 'GET':
            hold_id = path_parameters.get('holdId')
            return get_hold(hold_id, user_id)
        elif path.startswith('/holds/') and not path.endswith('/') and http_method == 'PUT':
            hold_id = path_parameters.get('holdId')
            return update_hold(hold_id, body, user_id)
        elif path.startswith('/holds/') and not path.endswith('/') and http_method == 'DELETE':
            hold_id = path_parameters.get('holdId')
            return release_hold(hold_id, user_id)
        else:
            return create_error_response(404, "Not Found")
            
    except Exception as e:
        logger.error("Unhandled error in seats service", error=e)
        return create_error_response(500, "Internal Server Error")

def get_seatmap(show_id: str) -> Dict[str, Any]:
    """Get seat layout and availability for a show"""
    try:
        # Validate show ID
        if not BMSValidator.validate_uuid(show_id):
            return create_error_response(400, "Invalid show ID format")
        
        # Get show details from database
        show = db_service.get_show_by_id(show_id)
        if not show:
            return create_error_response(404, "Show not found")
        
        # Mock seat layout (in production, this would come from database)
        seat_layout = generate_mock_seat_layout()
        
        # Get confirmed seats from database (none for now as we don't have order data)
        confirmed_seats = []
        
        # Get locked seats from Redis (none initially)
        locked_seats = []
        
        # Combine unavailable seats
        unavailable_seats = list(set(confirmed_seats + locked_seats))
        
        seatmap_data = {
            "showId": show_id,
            "movieTitle": show.get('title', ''),
            "theatreName": show.get('name', ''),
            "startTime": show['start_time'].isoformat() if show.get('start_time') else None,
            "price": float(show['price']) if show.get('price') else 0,
            "layout": seat_layout,
            "unavailableSeatIds": unavailable_seats,
            "heldSeatIds": locked_seats  # Specifically locked seats
        }
        
        return create_success_response(seatmap_data)
        
    except Exception as e:
        logger.error("Failed to get seatmap", error=e, extra={'show_id': show_id})
        return create_error_response(500, "Failed to fetch seat map")

def create_hold(body: str, user_id: str) -> Dict[str, Any]:
    """Create a new seat hold"""
    try:
        # Parse request body
        if not body:
            return create_error_response(400, "Request body is required")
        
        try:
            request_data = json.loads(body)
        except json.JSONDecodeError:
            return create_error_response(400, "Invalid JSON in request body")
        
        # Validate request
        try:
            BMSValidator.validate_hold_request(request_data)
        except ValidationError as e:
            return create_error_response(400, str(e))
        
        show_id = request_data['showId']
        seat_ids = request_data['seatIds']
        quantity = request_data['quantity']
        
        # Check if show exists
        show = db_service.get_show_by_id(show_id)
        if not show:
            return create_error_response(404, "Show not found")
        
        # Generate hold ID
        hold_id = str(uuid.uuid4())
        
        # For now, mock successful hold creation (Redis integration can be added later)
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(seconds=config.HOLD_TTL_SECONDS)
        
        response_data = {
            "holdId": hold_id,
            "showId": show_id,
            "seatIds": seat_ids,
            "status": "HELD",
            "expiresAt": expires_at.isoformat()
        }
        
        logger.info("Hold created successfully", extra={
            'hold_id': hold_id,
            'show_id': show_id,
            'user_id': user_id,
            'seat_ids': seat_ids
        })
        
        return create_success_response(response_data)
        
    except Exception as e:
        logger.error("Failed to create hold", error=e, extra={
            'user_id': user_id,
            'request_body': body
        })
        return create_error_response(500, "Failed to create hold")

def get_hold(hold_id: str, user_id: str) -> Dict[str, Any]:
    """Get hold details"""
    try:
        # Validate hold ID
        if not BMSValidator.validate_uuid(hold_id):
            return create_error_response(400, "Invalid hold ID format")
        
        # Mock hold data for testing
        response_data = {
            "holdId": hold_id,
            "showId": "550e8400-e29b-41d4-a716-446655440021",
            "seatIds": ["A1", "A2"],
            "status": "HELD",
            "expiresAt": (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat(),
            "createdAt": datetime.now(timezone.utc).isoformat()
        }
        
        return create_success_response(response_data)
        
    except Exception as e:
        logger.error("Failed to get hold", error=e, extra={
            'hold_id': hold_id,
            'user_id': user_id
        })
        return create_error_response(500, "Failed to get hold")

def update_hold(hold_id: str, body: str, user_id: str) -> Dict[str, Any]:
    """Update hold with new seats"""
    return create_error_response(501, "Update hold not yet implemented")

def release_hold(hold_id: str, user_id: str) -> Dict[str, Any]:
    """Release a hold and free up seats"""
    try:
        # Validate hold ID
        if not BMSValidator.validate_uuid(hold_id):
            return create_error_response(400, "Invalid hold ID format")
        
        logger.info("Hold released successfully", extra={
            'hold_id': hold_id,
            'user_id': user_id
        })
        
        return create_success_response({
            "message": "Hold released successfully"
        })
        
    except Exception as e:
        logger.error("Failed to release hold", error=e, extra={
            'hold_id': hold_id,
            'user_id': user_id
        })
        return create_error_response(500, "Failed to release hold")

def generate_mock_seat_layout() -> List[Dict[str, Any]]:
    """Generate mock seat layout (in production, this would come from database)"""
    layout = []
    for row in ['A', 'B', 'C', 'D', 'E']:
        for seat_num in range(1, 9):  # 8 seats per row
            layout.append({
                "seatId": f"{row}{seat_num}",
                "row": row,
                "number": seat_num,
                "type": "regular"  # could be "premium", "disabled", etc.
            })
    return layout

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