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
    \"\"\"Seats service Lambda handler\"\"\"
    try:
        # Extract HTTP method and path
        http_method = event.get('httpMethod', '')
        path = event.get('path', '')
        path_parameters = event.get('pathParameters') or {}
        query_parameters = event.get('queryStringParameters') or {}
        body = event.get('body', '')
        
        logger.info(f\"Seats service request\", extra={
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
            return create_error_response(404, \"Not Found\")
            
    except Exception as e:
        logger.error(\"Unhandled error in seats service\", error=e)
        return create_error_response(500, \"Internal Server Error\")

def get_seatmap(show_id: str) -> Dict[str, Any]:
    \"\"\"Get seat layout and availability for a show\"\"\"
    try:
        # Validate show ID
        if not BMSValidator.validate_uuid(show_id):
            return create_error_response(400, \"Invalid show ID format\")
        
        # Try cache first (very short TTL due to rapid changes)
        cached_seatmap = redis_service.get_cached_seat_availability(show_id)
        if cached_seatmap:
            logger.info(\"Seatmap served from cache\", extra={'show_id': show_id})
            return create_success_response(cached_seatmap)
        
        # Get show details
        show = db_service.get_show_by_id(show_id)
        if not show:
            return create_error_response(404, \"Show not found\")
        
        # Get confirmed seats from database
        confirmed_seats = db_service.get_confirmed_seats_for_show(show_id)
        
        # Get locked seats from Redis
        locked_seats = redis_service.get_locked_seats_for_show(show_id)
        
        # Mock seat layout (in production, this would come from database)
        seat_layout = generate_mock_seat_layout()
        
        # Combine unavailable seats
        unavailable_seats = list(set(confirmed_seats + locked_seats))
        
        seatmap_data = {
            \"showId\": show_id,
            \"movieTitle\": show.get('movie_title', ''),
            \"theatreName\": show.get('theatre_name', ''),
            \"startTime\": show['start_time'].isoformat() if show.get('start_time') else None,
            \"price\": float(show['price']) if show.get('price') else 0,
            \"layout\": seat_layout,
            \"unavailableSeatIds\": unavailable_seats,
            \"heldSeatIds\": locked_seats  # Specifically locked seats
        }
        
        # Cache for 10 seconds (hot data)
        redis_service.cache_seat_availability(show_id, seatmap_data, ttl=10)
        
        return create_success_response(seatmap_data)
        
    except Exception as e:
        logger.error(\"Failed to get seatmap\", error=e, extra={'show_id': show_id})
        return create_error_response(500, \"Failed to fetch seat map\")

def create_hold(body: str, user_id: str) -> Dict[str, Any]:
    \"\"\"Create a new seat hold\"\"\"
    try:
        # Parse request body
        if not body:
            return create_error_response(400, \"Request body is required\")
        
        try:
            request_data = json.loads(body)
        except json.JSONDecodeError:
            return create_error_response(400, \"Invalid JSON in request body\")
        
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
            return create_error_response(404, \"Show not found\")
        
        # Generate hold ID
        hold_id = str(uuid.uuid4())
        
        # Try to lock seats atomically in Redis
        lock_result = redis_service.lock_seats_atomic(show_id, user_id, seat_ids, hold_id)
        
        if not lock_result['success']:
            error_code = 409 if lock_result.get('error') == 'SEAT_TAKEN' else 500
            return create_error_response(error_code, lock_result.get('message', 'Failed to lock seats'))
        
        # Create hold metadata
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(seconds=config.HOLD_TTL_SECONDS)
        
        hold_data = {
            \"hold_id\": hold_id,
            \"show_id\": show_id,
            \"user_id\": user_id,
            \"seat_ids\": seat_ids,
            \"quantity\": quantity,
            \"status\": \"HELD\",
            \"created_at\": now.isoformat(),
            \"expires_at\": expires_at.isoformat(),
            \"movie_title\": show.get('movie_title', ''),
            \"theatre_name\": show.get('theatre_name', ''),
            \"start_time\": show['start_time'].isoformat() if show.get('start_time') else None,
            \"price\": float(show['price']) if show.get('price') else 0
        }
        
        # Store hold metadata in Redis
        if not redis_service.store_hold(hold_data):
            # If storing hold fails, release the seat locks
            redis_service.release_seats_atomic(show_id, user_id, seat_ids)
            return create_error_response(500, \"Failed to create hold\")
        
        # Clear seat availability cache
        redis_service._client.delete(f\"seatmap:{show_id}\")
        
        # Send event to SQS
        sqs_service.send_event('hold.created', hold_data)
        
        response_data = {
            \"holdId\": hold_id,
            \"showId\": show_id,
            \"seatIds\": seat_ids,
            \"status\": \"HELD\",
            \"expiresAt\": expires_at.isoformat()
        }
        
        logger.info(\"Hold created successfully\", extra={
            'hold_id': hold_id,
            'show_id': show_id,
            'user_id': user_id,
            'seat_ids': seat_ids
        })
        
        return create_success_response(response_data)
        
    except Exception as e:
        logger.error(\"Failed to create hold\", error=e, extra={
            'user_id': user_id,
            'request_body': body
        })
        return create_error_response(500, \"Failed to create hold\")

def get_hold(hold_id: str, user_id: str) -> Dict[str, Any]:
    \"\"\"Get hold details\"\"\"
    try:
        # Validate hold ID
        if not BMSValidator.validate_uuid(hold_id):
            return create_error_response(400, \"Invalid hold ID format\")
        
        # Get hold from Redis
        hold_data = redis_service.get_hold(hold_id)
        if not hold_data:
            return create_error_response(404, \"Hold not found or expired\")
        
        # Check if user owns the hold
        if hold_data.get('user_id') != user_id:
            return create_error_response(403, \"Unauthorized\")
        
        # Check if hold is expired
        expires_at = datetime.fromisoformat(hold_data['expires_at'].replace('Z', '+00:00'))
        if datetime.now(timezone.utc) > expires_at:
            hold_data['status'] = 'EXPIRED'
        
        response_data = {
            \"holdId\": hold_data['hold_id'],
            \"showId\": hold_data['show_id'],
            \"seatIds\": hold_data['seat_ids'],
            \"status\": hold_data['status'],
            \"expiresAt\": hold_data['expires_at'],
            \"createdAt\": hold_data['created_at']
        }
        
        return create_success_response(response_data)
        
    except Exception as e:
        logger.error(\"Failed to get hold\", error=e, extra={
            'hold_id': hold_id,
            'user_id': user_id
        })
        return create_error_response(500, \"Failed to get hold\")

def update_hold(hold_id: str, body: str, user_id: str) -> Dict[str, Any]:
    \"\"\"Update hold with new seats\"\"\"
    try:
        # Validate hold ID
        if not BMSValidator.validate_uuid(hold_id):
            return create_error_response(400, \"Invalid hold ID format\")
        
        # Parse request body
        if not body:
            return create_error_response(400, \"Request body is required\")
        
        try:
            request_data = json.loads(body)
        except json.JSONDecodeError:
            return create_error_response(400, \"Invalid JSON in request body\")
        
        # Validate request
        required_fields = ['seatIds', 'quantity']
        for field in required_fields:
            if field not in request_data:
                return create_error_response(400, f\"Missing required field: {field}\")
        
        new_seat_ids = request_data['seatIds']
        new_quantity = request_data['quantity']
        
        if not BMSValidator.validate_seat_ids(new_seat_ids):
            return create_error_response(400, \"Invalid seat ID format\")
        
        if new_quantity != len(new_seat_ids):
            return create_error_response(400, \"Quantity must match number of seat IDs\")
        
        # Get existing hold
        hold_data = redis_service.get_hold(hold_id)
        if not hold_data:
            return create_error_response(404, \"Hold not found or expired\")
        
        # Check ownership
        if hold_data.get('user_id') != user_id:
            return create_error_response(403, \"Unauthorized\")
        
        # Check if hold is still active
        if hold_data.get('status') != 'HELD':
            return create_error_response(400, f\"Cannot update hold with status: {hold_data.get('status')}\")
        
        show_id = hold_data['show_id']
        old_seat_ids = hold_data['seat_ids']
        
        # Release old seats
        redis_service.release_seats_atomic(show_id, user_id, old_seat_ids)
        
        # Try to lock new seats
        lock_result = redis_service.lock_seats_atomic(show_id, user_id, new_seat_ids, hold_id)
        
        if not lock_result['success']:
            # If new lock fails, try to restore old lock
            redis_service.lock_seats_atomic(show_id, user_id, old_seat_ids, hold_id)
            error_code = 409 if lock_result.get('error') == 'SEAT_TAKEN' else 500
            return create_error_response(error_code, lock_result.get('message', 'Failed to update seats'))
        
        # Update hold data
        hold_data['seat_ids'] = new_seat_ids
        hold_data['quantity'] = new_quantity
        # Reset expiration
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=config.HOLD_TTL_SECONDS)
        hold_data['expires_at'] = expires_at.isoformat()
        
        # Store updated hold
        if not redis_service.store_hold(hold_data):
            return create_error_response(500, \"Failed to update hold\")
        
        # Clear cache
        redis_service._client.delete(f\"seatmap:{show_id}\")
        
        response_data = {
            \"holdId\": hold_id,
            \"showId\": show_id,
            \"seatIds\": new_seat_ids,
            \"status\": \"HELD\",
            \"expiresAt\": expires_at.isoformat()
        }
        
        logger.info(\"Hold updated successfully\", extra={
            'hold_id': hold_id,
            'user_id': user_id,
            'old_seats': old_seat_ids,
            'new_seats': new_seat_ids
        })
        
        return create_success_response(response_data)
        
    except Exception as e:
        logger.error(\"Failed to update hold\", error=e, extra={
            'hold_id': hold_id,
            'user_id': user_id
        })
        return create_error_response(500, \"Failed to update hold\")

def release_hold(hold_id: str, user_id: str) -> Dict[str, Any]:
    \"\"\"Release a hold and free up seats\"\"\"
    try:
        # Validate hold ID
        if not BMSValidator.validate_uuid(hold_id):
            return create_error_response(400, \"Invalid hold ID format\")
        
        # Get hold data
        hold_data = redis_service.get_hold(hold_id)
        if not hold_data:
            return create_error_response(404, \"Hold not found or expired\")
        
        # Check ownership
        if hold_data.get('user_id') != user_id:
            return create_error_response(403, \"Unauthorized\")
        
        # Check if hold can be released
        if hold_data.get('status') != 'HELD':
            return create_error_response(400, f\"Cannot release hold with status: {hold_data.get('status')}\")
        
        show_id = hold_data['show_id']
        seat_ids = hold_data['seat_ids']
        
        # Release seats atomically
        release_result = redis_service.release_seats_atomic(show_id, user_id, seat_ids)
        
        if not release_result['success']:
            return create_error_response(500, \"Failed to release seats\")
        
        # Update hold status
        hold_data['status'] = 'RELEASED'
        redis_service.store_hold(hold_data)  # Store with remaining TTL
        
        # Clear cache
        redis_service._client.delete(f\"seatmap:{show_id}\")
        
        # Send event
        sqs_service.send_event('hold.released', hold_data)
        
        logger.info(\"Hold released successfully\", extra={
            'hold_id': hold_id,
            'user_id': user_id,
            'seat_ids': seat_ids
        })
        
        return create_success_response({
            \"message\": \"Hold released successfully\",
            \"releasedSeats\": release_result.get('released', [])
        })
        
    except Exception as e:
        logger.error(\"Failed to release hold\", error=e, extra={
            'hold_id': hold_id,
            'user_id': user_id
        })
        return create_error_response(500, \"Failed to release hold\")

def generate_mock_seat_layout() -> List[Dict[str, Any]]:
    \"\"\"Generate mock seat layout (in production, this would come from database)\"\"\"
    layout = []
    for row in ['A', 'B', 'C', 'D', 'E']:
        for seat_num in range(1, 9):  # 8 seats per row
            layout.append({
                \"seatId\": f\"{row}{seat_num}\",
                \"row\": row,
                \"number\": seat_num,
                \"type\": \"regular\"  # could be \"premium\", \"disabled\", etc.
            })
    return layout

def create_success_response(data: Any) -> Dict[str, Any]:
    \"\"\"Create successful API response\"\"\"
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
    \"\"\"Create error API response\"\"\"
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