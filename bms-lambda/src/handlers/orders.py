import json
import uuid
from typing import Dict, Any
from datetime import datetime, timezone, timedelta

from services.db_service import db_service
from services.redis_service import redis_service
from services.sqs_service import sqs_service
from utils.logger import BMSLogger
from utils.validators import BMSValidator, ValidationError
from utils.config import config

logger = BMSLogger(__name__)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Orders service Lambda handler"""
    try:
        # Extract HTTP method and path
        http_method = event.get('httpMethod', '')
        path = event.get('path', '')
        path_parameters = event.get('pathParameters') or {}
        body = event.get('body', '')
        
        logger.info(f"Orders service request", extra={
            'method': http_method,
            'path': path,
            'path_params': path_parameters
        })
        
        # Extract user info from authorization
        headers = event.get('headers', {})
        user_id = headers.get('x-user-id', 'test-user-123')  # In production: decode JWT
        
        # Route the request
        if path == '/orders' and http_method == 'POST':
            return create_order(body, user_id)
        elif path.startswith('/orders/') and path.endswith('/confirm-payment') and http_method == 'POST':
            order_id = path_parameters.get('orderId')
            return confirm_payment(order_id, user_id)
        elif path.startswith('/orders/') and not path.endswith('/') and http_method == 'GET':
            order_id = path_parameters.get('orderId')
            return get_order(order_id, user_id)
        else:
            return create_error_response(404, "Not Found")
            
    except Exception as e:
        logger.error("Unhandled error in orders service", error=e)
        return create_error_response(500, "Internal Server Error")

def create_order(body: str, user_id: str) -> Dict[str, Any]:
    """Create order from hold"""
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
            BMSValidator.validate_order_request(request_data)
        except ValidationError as e:
            return create_error_response(400, str(e))
        
        hold_id = request_data['holdId']
        customer = request_data['customer']
        
        # Get hold data from Redis
        hold_data = redis_service.get_hold(hold_id)
        if not hold_data:
            return create_error_response(404, "Hold not found or expired")
        
        # Verify hold ownership
        if hold_data.get('user_id') != user_id:
            return create_error_response(403, "Unauthorized")
        
        # Check if hold is still valid
        if hold_data.get('status') != 'HELD':
            return create_error_response(400, f"Cannot create order from hold with status: {hold_data.get('status')}")
        
        # Check hold expiration
        expires_at = datetime.fromisoformat(hold_data['expires_at'].replace('Z', '+00:00'))
        if datetime.now(timezone.utc) > expires_at:
            return create_error_response(400, "Hold has expired")
        
        # Get show details
        show_id = hold_data['show_id']
        show = db_service.get_show_by_id(show_id)
        if not show:
            return create_error_response(404, "Show not found")
        
        # Calculate amount
        seat_count = len(hold_data['seat_ids'])
        price_per_seat = float(show['price']) if show.get('price') else 0
        total_amount = seat_count * price_per_seat
        
        # Generate order ID
        order_id = str(uuid.uuid4())
        
        # Prepare order data
        now = datetime.now(timezone.utc)
        order_expires_at = now + timedelta(seconds=config.ORDER_TTL_SECONDS)
        
        order_data = {
            'order_id': order_id,
            'user_id': user_id,
            'show_id': show_id,
            'seat_ids': hold_data['seat_ids'],
            'customer_name': customer['name'],
            'customer_email': customer['email'],
            'customer_phone': customer['phone'],
            'amount': total_amount,
            'status': 'PAYMENT_PENDING',
            'created_at': now,
            'expires_at': order_expires_at
        }
        
        # Begin database transaction
        try:
            # Create order in database
            created_order_id = db_service.create_order(order_data)
            
            if created_order_id != order_id:
                logger.error("Order ID mismatch", extra={
                    'expected': order_id,
                    'actual': created_order_id
                })
                return create_error_response(500, "Failed to create order")
            
            # Delete hold from Redis (seats are now "reserved" by the order)
            redis_service.delete_hold(hold_id)
            
            # Note: Seat locks remain in Redis until payment confirmation or expiration
            # This prevents double-booking during payment processing
            
            # Clear seat availability cache
            redis_service._client.delete(f"seatmap:{show_id}")
            
            # Send order created event to SQS
            event_data = {
                'order_id': order_id,
                'user_id': user_id,
                'show_id': show_id,
                'movie_title': show.get('movie_title', ''),
                'theatre_name': show.get('theatre_name', ''),
                'seat_ids': hold_data['seat_ids'],
                'amount': total_amount,
                'customer': customer,
                'expires_at': order_expires_at.isoformat()
            }
            
            sqs_service.send_order_created_event(event_data)
            
            # Prepare response
            response_data = {
                "orderId": order_id,
                "showId": show_id,
                "seatIds": hold_data['seat_ids'],
                "amount": total_amount,
                "status": "PAYMENT_PENDING",
                "customer": customer,
                "movieTitle": show.get('movie_title', ''),
                "theatreName": show.get('theatre_name', ''),
                "showTime": show['start_time'].isoformat() if show.get('start_time') else None,
                "createdAt": now.isoformat(),
                "expiresAt": order_expires_at.isoformat()
            }
            
            logger.info("Order created successfully", extra={
                'order_id': order_id,
                'user_id': user_id,
                'hold_id': hold_id,
                'amount': total_amount
            })
            
            return create_success_response(response_data)
            
        except Exception as e:
            logger.error("Failed to create order in database", error=e, extra={
                'order_data': order_data
            })
            # If database operation fails, we should restore the hold
            # This is a compensation action
            redis_service.store_hold(hold_data)
            return create_error_response(500, "Failed to create order")
            
    except Exception as e:
        logger.error("Failed to create order", error=e, extra={
            'user_id': user_id,
            'request_body': body
        })
        return create_error_response(500, "Failed to create order")

def get_order(order_id: str, user_id: str) -> Dict[str, Any]:
    """Get order details"""
    try:
        # Validate order ID
        if not BMSValidator.validate_uuid(order_id):
            return create_error_response(400, "Invalid order ID format")
        
        # Get order from database
        order = db_service.get_order_by_id(order_id)
        if not order:
            return create_error_response(404, "Order not found")
        
        # Check ownership
        if order.get('user_id') != user_id:
            return create_error_response(403, "Unauthorized")
        
        # Check if order is expired
        if order.get('status') == 'PAYMENT_PENDING':
            expires_at = order.get('expires_at')
            if expires_at and datetime.now(timezone.utc) > expires_at:
                # Update order status to expired in database
                # In production, this would be handled by a background job
                pass
        
        response_data = {
            "orderId": order['order_id'],
            "showId": order['show_id'],
            "seatIds": order['seat_ids'],
            "amount": float(order['amount']) if order.get('amount') else 0,
            "status": order['status'],
            "customer": {
                "name": order['customer_name'],
                "email": order['customer_email'],
                "phone": order['customer_phone']
            },
            "movieTitle": order.get('movie_title', ''),
            "theatreName": order.get('theatre_name', ''),
            "showTime": order['start_time'].isoformat() if order.get('start_time') else None,
            "ticketCode": order.get('ticket_code'),
            "createdAt": order['created_at'].isoformat() if order.get('created_at') else None,
            "expiresAt": order['expires_at'].isoformat() if order.get('expires_at') else None
        }
        
        return create_success_response(response_data)
        
    except Exception as e:
        logger.error("Failed to get order", error=e, extra={
            'order_id': order_id,
            'user_id': user_id
        })
        return create_error_response(500, "Failed to get order")

def confirm_payment(order_id: str, user_id: str) -> Dict[str, Any]:
    """Confirm payment and finalize booking"""
    try:
        # Validate order ID
        if not BMSValidator.validate_uuid(order_id):
            return create_error_response(400, "Invalid order ID format")
        
        # Get order from database
        order = db_service.get_order_by_id(order_id)
        if not order:
            return create_error_response(404, "Order not found")
        
        # Check ownership
        if order.get('user_id') != user_id:
            return create_error_response(403, "Unauthorized")
        
        # Check if order can be confirmed
        if order.get('status') != 'PAYMENT_PENDING':
            return create_error_response(400, f"Cannot confirm payment for order with status: {order.get('status')}")
        
        # Check if order is expired
        expires_at = order.get('expires_at')
        if expires_at and datetime.now(timezone.utc) > expires_at:
            return create_error_response(400, "Order has expired")
        
        # Generate ticket code
        ticket_code = f"BMS{order_id[:8].upper()}"
        
        # Update order status in database
        success = db_service.confirm_order_payment(order_id, ticket_code)
        
        if not success:
            return create_error_response(500, "Failed to confirm payment")
        
        # Release seat locks from Redis (seats are now permanently booked)
        show_id = order['show_id']
        seat_ids = order['seat_ids']
        redis_service.release_seats_atomic(show_id, user_id, seat_ids)
        
        # Clear seat availability cache
        redis_service._client.delete(f"seatmap:{show_id}")
        
        # Send order confirmed event
        event_data = {
            'order_id': order_id,
            'user_id': user_id,
            'ticket_code': ticket_code,
            'show_id': show_id,
            'seat_ids': seat_ids,
            'movie_title': order.get('movie_title', ''),
            'theatre_name': order.get('theatre_name', ''),
            'show_time': order['start_time'].isoformat() if order.get('start_time') else None,
            'customer': {
                'name': order['customer_name'],
                'email': order['customer_email'],
                'phone': order['customer_phone']
            },
            'amount': float(order['amount']) if order.get('amount') else 0
        }
        
        sqs_service.send_order_confirmed_event(event_data)
        
        response_data = {
            "orderId": order_id,
            "status": "CONFIRMED",
            "ticketCode": ticket_code,
            "message": "Payment confirmed successfully. Your tickets have been booked!"
        }
        
        logger.info("Payment confirmed successfully", extra={
            'order_id': order_id,
            'user_id': user_id,
            'ticket_code': ticket_code
        })
        
        return create_success_response(response_data)
        
    except Exception as e:
        logger.error("Failed to confirm payment", error=e, extra={
            'order_id': order_id,
            'user_id': user_id
        })
        return create_error_response(500, "Failed to confirm payment")

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