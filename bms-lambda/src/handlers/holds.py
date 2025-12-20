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
    """Holds service Lambda handler"""
    try:
        # Extract HTTP method and path
        http_method = event.get('httpMethod', '')
        path = event.get('path', '')
        path_parameters = event.get('pathParameters') or {}
        body = event.get('body', '')
        
        logger.info(f"Holds service request", extra={
            'method': http_method,
            'path': path,
            'path_params': path_parameters
        })
        
        # Extract user info from authorization
        headers = event.get('headers', {})
        user_id = headers.get('x-user-id', 'test-user-123')  # In production: decode JWT
        
        # Route the request
        if path == '/holds' and http_method == 'POST':
            return create_hold(body, user_id)
        elif path.startswith('/holds/') and not path.endswith('/') and http_method == 'GET':
            hold_id = path_parameters.get('holdId')
            return get_hold(hold_id, user_id)
        elif path.startswith('/holds/') and path.endswith('/release') and http_method == 'POST':
            hold_id = path_parameters.get('holdId')
            return release_hold(hold_id, user_id)
        else:
            return create_error_response(404, "Not Found")
            
    except Exception as e:
        logger.error("Unhandled error in holds service", error=e)
        return create_error_response(500, "Internal Server Error")

def create_hold(body: str, user_id: str) -> Dict[str, Any]:
    """Create seat hold with optimistic locking"""
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
        
        # Validate show exists
        show = db_service.get_show_by_id(show_id)
        if not show:
            return create_error_response(404, "Show not found")
        
        # Check if show is still bookable (not started)
        show_time = show.get('start_time')
        if show_time and datetime.now(timezone.utc) >= show_time:
            return create_error_response(400, "Cannot book seats for a show that has already started")
        
        # Get permanently unavailable seats for this show (broken, maintenance)
        permanently_unavailable = get_permanently_unavailable_seats(show_id)

        # Get confirmed seats from database (already booked)
        confirmed_seats = db_service.get_confirmed_seats_for_show(show_id)

        # Combine all unavailable seats
        all_unavailable = set(permanently_unavailable + confirmed_seats)

        # Check if any requested seats are unavailable
        unavailable_seats = [seat for seat in seat_ids if seat in all_unavailable]
        if unavailable_seats:
            # Check if they're confirmed (already booked) vs permanently unavailable
            booked_seats = [s for s in unavailable_seats if s in confirmed_seats]
            if booked_seats:
                return create_error_response(409, f"Seats already booked: {', '.join(booked_seats)}")
            return create_error_response(400, f"Seats are unavailable: {', '.join(unavailable_seats)}")
        
        # Generate hold ID
        hold_id = str(uuid.uuid4())
        
        # Attempt atomic seat locking using Redis Lua script
        lock_result = redis_service.lock_seats_atomic(show_id, user_id, seat_ids, hold_id)
        
        if not lock_result.get('success'):
            error_type = lock_result.get('error', 'UNKNOWN_ERROR')
            
            if error_type == 'SEAT_TAKEN':
                taken_seat = lock_result.get('seat', '')
                return create_error_response(409, f"Seat {taken_seat} is no longer available")
            else:
                logger.error("Failed to lock seats", extra={
                    'lock_result': lock_result,
                    'show_id': show_id,
                    'user_id': user_id,
                    'seat_ids': seat_ids
                })
                return create_error_response(500, "Failed to reserve seats. Please try again.")
        
        # Prepare hold data
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(seconds=config.HOLD_TTL_SECONDS)
        
        hold_data = {
            'hold_id': hold_id,
            'show_id': show_id,
            'user_id': user_id,
            'seat_ids': seat_ids,
            'quantity': quantity,
            'status': 'HELD',
            'created_at': now.isoformat(),
            'expires_at': expires_at.isoformat()
        }
        
        # Store hold metadata in Redis
        success = redis_service.store_hold(hold_data)
        if not success:
            # Compensation: release the seat locks if hold storage fails
            redis_service.release_seats_atomic(show_id, user_id, seat_ids)
            return create_error_response(500, "Failed to create hold")
        
        # Clear seat availability cache
        redis_service.delete_key(f"seatmap:{show_id}")
        
        # Send hold created event to SQS for analytics/notifications
        event_data = {
            'hold_id': hold_id,
            'user_id': user_id,
            'show_id': show_id,
            'seat_ids': seat_ids,
            'expires_at': expires_at.isoformat(),
            'movie_title': show.get('movie_title', ''),
            'theatre_name': show.get('theatre_name', '')
        }
        
        try:
            sqs_service.send_hold_created_event(event_data)
        except Exception as e:
            # Non-critical failure - don't fail the whole request
            logger.warning("Failed to send hold created event", error=e)
        
        # Prepare response
        response_data = {
            "holdId": hold_id,
            "showId": show_id,
            "seatIds": seat_ids,
            "status": "HELD",
            "expiresAt": expires_at.isoformat()
        }
        
        logger.info("Hold created successfully", extra={
            'hold_id': hold_id,
            'user_id': user_id,
            'show_id': show_id,
            'seat_count': len(seat_ids)
        })
        
        return create_success_response(response_data)
        
    except Exception as e:
        logger.error("Failed to create hold", error=e, extra={
            'user_id': user_id,
            'request_body': body
        })
        return create_error_response(500, "Failed to create hold")

def get_hold(hold_id: str, user_id: str) -> Dict[str, Any]:
    """Get hold details with expiration check"""
    try:
        # Validate hold ID format
        if not BMSValidator.validate_uuid(hold_id):
            return create_error_response(400, "Invalid hold ID format")
        
        # Get hold from Redis
        hold_data = redis_service.get_hold(hold_id)
        if not hold_data:
            return create_error_response(404, "Hold not found or expired")
        
        # Check ownership
        if hold_data.get('user_id') != user_id:
            return create_error_response(403, "Unauthorized")
        
        # Check expiration (read-only check, no state modification)
        expires_at = datetime.fromisoformat(hold_data['expires_at'].replace('Z', '+00:00'))
        is_expired = datetime.now(timezone.utc) > expires_at
        
        effective_status = "EXPIRED" if is_expired else hold_data.get('status', 'HELD')
        
        response_data = {
            "holdId": hold_data['hold_id'],
            "showId": hold_data['show_id'],
            "seatIds": hold_data['seat_ids'],
            "status": effective_status,
            "createdAt": hold_data.get('created_at'),
            "expiresAt": hold_data['expires_at']
        }
        
        return create_success_response(response_data)
        
    except Exception as e:
        logger.error("Failed to get hold", error=e, extra={
            'hold_id': hold_id,
            'user_id': user_id
        })
        return create_error_response(500, "Failed to get hold")

def release_hold(hold_id: str, user_id: str) -> Dict[str, Any]:
    """Release hold and unlock seats"""
    try:
        # Validate hold ID format
        if not BMSValidator.validate_uuid(hold_id):
            return create_error_response(400, "Invalid hold ID format")
        
        # Get hold from Redis
        hold_data = redis_service.get_hold(hold_id)
        if not hold_data:
            return create_error_response(404, "Hold not found or expired")
        
        # Check ownership
        if hold_data.get('user_id') != user_id:
            return create_error_response(403, "Unauthorized")
        
        # Check if hold can be released
        if hold_data.get('status') == 'RELEASED':
            return create_error_response(400, "Hold is already released")
        
        # Check expiration
        expires_at = datetime.fromisoformat(hold_data['expires_at'].replace('Z', '+00:00'))
        if datetime.now(timezone.utc) > expires_at:
            return create_error_response(400, "Hold has already expired")
        
        # Release seats atomically
        show_id = hold_data['show_id']
        seat_ids = hold_data['seat_ids']
        
        release_result = redis_service.release_seats_atomic(show_id, user_id, seat_ids)
        
        if not release_result.get('success'):
            logger.error("Failed to release seats", extra={
                'release_result': release_result,
                'hold_id': hold_id
            })
            return create_error_response(500, "Failed to release seats")
        
        # Update hold status in Redis
        hold_data['status'] = 'RELEASED'
        redis_service.store_hold(hold_data)
        
        # Clear seat availability cache
        redis_service.delete_key(f"seatmap:{show_id}")
        
        # Send hold released event
        event_data = {
            'hold_id': hold_id,
            'user_id': user_id,
            'show_id': show_id,
            'seat_ids': seat_ids,
            'released_seats': release_result.get('released', [])
        }
        
        try:
            sqs_service.send_hold_released_event(event_data)
        except Exception as e:
            logger.warning("Failed to send hold released event", error=e)
        
        response_data = {
            "holdId": hold_id,
            "status": "RELEASED",
            "releasedSeats": release_result.get('released', []),
            "message": f"Hold released. {len(release_result.get('released', []))} seats are now available."
        }
        
        logger.info("Hold released successfully", extra={
            'hold_id': hold_id,
            'user_id': user_id,
            'released_count': len(release_result.get('released', []))
        })
        
        return create_success_response(response_data)
        
    except Exception as e:
        logger.error("Failed to release hold", error=e, extra={
            'hold_id': hold_id,
            'user_id': user_id
        })
        return create_error_response(500, "Failed to release hold")

def get_permanently_unavailable_seats(show_id: str) -> List[str]:
    """Get permanently unavailable seats for a show (broken seats, etc.)"""
    # This could be stored in database per show or configured per theatre
    # For now, return a static list similar to the memory store implementation (valid seats: A1-J10)
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