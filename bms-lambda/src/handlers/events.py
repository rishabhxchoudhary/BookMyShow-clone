import json
from typing import Dict, Any, List

from utils.logger import BMSLogger
from utils.config import config

logger = BMSLogger(__name__)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    \"\"\"Events processor Lambda handler for SQS events\"\"\"
    try:
        # Process SQS records
        records = event.get('Records', [])
        
        logger.info(f\"Processing {len(records)} SQS events\")
        
        for record in records:
            try:
                process_event_record(record)
            except Exception as e:
                logger.error(\"Failed to process event record\", error=e, extra={
                    'record': record
                })
                # In production, failed events would go to DLQ
                # For now, we continue processing other records
                continue
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': f'Processed {len(records)} events successfully'
            })
        }
        
    except Exception as e:
        logger.error(\"Unhandled error in events processor\", error=e)
        raise  # Re-raise to trigger Lambda retry mechanism

def process_event_record(record: Dict[str, Any]) -> None:
    \"\"\"Process individual SQS event record\"\"\"
    try:
        # Parse SQS message
        message_body = record.get('body', '')
        if not message_body:
            logger.warning(\"Empty message body\", extra={'record': record})
            return
        
        try:
            event_data = json.loads(message_body)
        except json.JSONDecodeError as e:
            logger.error(\"Failed to parse event JSON\", error=e, extra={
                'message_body': message_body
            })
            return
        
        event_type = event_data.get('eventType')
        data = event_data.get('data', {})
        timestamp = event_data.get('timestamp')
        
        logger.info(f\"Processing event: {event_type}\", extra={
            'event_type': event_type,
            'timestamp': timestamp,
            'data_keys': list(data.keys()) if isinstance(data, dict) else 'not_dict'
        })
        
        # Route event to appropriate handler
        if event_type == 'hold.created':
            handle_hold_created(data)
        elif event_type == 'hold.released':
            handle_hold_released(data)
        elif event_type == 'hold.expired':
            handle_hold_expired(data)
        elif event_type == 'order.created':
            handle_order_created(data)
        elif event_type == 'order.confirmed':
            handle_order_confirmed(data)
        elif event_type == 'show.sold_out':
            handle_show_sold_out(data)
        else:
            logger.warning(f\"Unknown event type: {event_type}\", extra={
                'event_data': event_data
            })
        
    except Exception as e:
        logger.error(\"Failed to process event record\", error=e, extra={
            'record': record
        })
        raise

def handle_hold_created(data: Dict[str, Any]) -> None:
    \"\"\"Handle hold created event\"\"\"
    try:
        hold_id = data.get('hold_id')
        user_id = data.get('user_id')
        seat_ids = data.get('seat_ids', [])
        movie_title = data.get('movie_title', '')
        
        logger.info(\"Processing hold created\", extra={
            'hold_id': hold_id,
            'user_id': user_id,
            'seat_count': len(seat_ids)
        })
        
        # In a real implementation, you might:
        # 1. Update analytics/metrics
        # 2. Log for business intelligence
        # 3. Trigger real-time notifications
        
        # Mock analytics update
        update_analytics('hold_created', {
            'movie_title': movie_title,
            'seat_count': len(seat_ids),
            'timestamp': data.get('created_at')
        })
        
    except Exception as e:
        logger.error(\"Failed to handle hold created event\", error=e, extra={
            'data': data
        })
        raise

def handle_hold_released(data: Dict[str, Any]) -> None:
    \"\"\"Handle hold released event\"\"\"
    try:
        hold_id = data.get('hold_id')
        user_id = data.get('user_id')
        
        logger.info(\"Processing hold released\", extra={
            'hold_id': hold_id,
            'user_id': user_id
        })
        
        # Update analytics
        update_analytics('hold_released', {
            'hold_id': hold_id,
            'user_id': user_id
        })
        
    except Exception as e:
        logger.error(\"Failed to handle hold released event\", error=e)
        raise

def handle_hold_expired(data: Dict[str, Any]) -> None:
    \"\"\"Handle hold expired event\"\"\"
    try:
        hold_id = data.get('hold_id')
        
        logger.info(\"Processing hold expired\", extra={
            'hold_id': hold_id
        })
        
        # Update analytics - track conversion rates
        update_analytics('hold_expired', {
            'hold_id': hold_id
        })
        
    except Exception as e:
        logger.error(\"Failed to handle hold expired event\", error=e)
        raise

def handle_order_created(data: Dict[str, Any]) -> None:
    \"\"\"Handle order created event\"\"\"
    try:
        order_id = data.get('order_id')
        user_id = data.get('user_id')
        customer = data.get('customer', {})
        amount = data.get('amount', 0)
        movie_title = data.get('movie_title', '')
        
        logger.info(\"Processing order created\", extra={
            'order_id': order_id,
            'user_id': user_id,
            'amount': amount
        })
        
        # Send order confirmation email
        send_order_confirmation_email({
            'order_id': order_id,
            'customer_email': customer.get('email'),
            'customer_name': customer.get('name'),
            'movie_title': movie_title,
            'amount': amount,
            'expires_at': data.get('expires_at')
        })
        
        # Update analytics
        update_analytics('order_created', {
            'movie_title': movie_title,
            'amount': amount,
            'timestamp': data.get('created_at')
        })
        
    except Exception as e:
        logger.error(\"Failed to handle order created event\", error=e)
        raise

def handle_order_confirmed(data: Dict[str, Any]) -> None:
    \"\"\"Handle order confirmed event (payment successful)\"\"\"
    try:
        order_id = data.get('order_id')
        ticket_code = data.get('ticket_code')
        customer = data.get('customer', {})
        movie_title = data.get('movie_title', '')
        theatre_name = data.get('theatre_name', '')
        show_time = data.get('show_time')
        seat_ids = data.get('seat_ids', [])
        
        logger.info(\"Processing order confirmed\", extra={
            'order_id': order_id,
            'ticket_code': ticket_code
        })
        
        # Send ticket confirmation email
        send_ticket_confirmation_email({
            'order_id': order_id,
            'ticket_code': ticket_code,
            'customer_email': customer.get('email'),
            'customer_name': customer.get('name'),
            'movie_title': movie_title,
            'theatre_name': theatre_name,
            'show_time': show_time,
            'seat_ids': seat_ids
        })
        
        # Send SMS notification
        send_ticket_sms({
            'phone': customer.get('phone'),
            'ticket_code': ticket_code,
            'movie_title': movie_title,
            'show_time': show_time
        })
        
        # Update analytics - successful conversion
        update_analytics('order_confirmed', {
            'movie_title': movie_title,
            'theatre_name': theatre_name,
            'amount': data.get('amount', 0),
            'seat_count': len(seat_ids)
        })
        
    except Exception as e:
        logger.error(\"Failed to handle order confirmed event\", error=e)
        raise

def handle_show_sold_out(data: Dict[str, Any]) -> None:
    \"\"\"Handle show sold out event\"\"\"
    try:
        show_id = data.get('show_id')
        movie_title = data.get('movie_title', '')
        
        logger.info(\"Processing show sold out\", extra={
            'show_id': show_id,
            'movie_title': movie_title
        })
        
        # Update analytics
        update_analytics('show_sold_out', {
            'show_id': show_id,
            'movie_title': movie_title
        })
        
        # You might also:
        # 1. Update cache to mark show as sold out
        # 2. Notify admin systems
        # 3. Trigger waitlist notifications
        
    except Exception as e:
        logger.error(\"Failed to handle show sold out event\", error=e)
        raise

def send_order_confirmation_email(data: Dict[str, Any]) -> None:
    \"\"\"Send order confirmation email\"\"\"
    try:
        # In production, this would integrate with SES, SendGrid, etc.
        logger.info(\"Sending order confirmation email\", extra={
            'order_id': data.get('order_id'),
            'customer_email': data.get('customer_email')
        })
        
        # Mock email sending
        email_content = {
            'to': data.get('customer_email'),
            'subject': f\"Order Confirmation - {data.get('movie_title')}\",
            'template': 'order_confirmation',
            'data': {
                'customer_name': data.get('customer_name'),
                'order_id': data.get('order_id'),
                'movie_title': data.get('movie_title'),
                'amount': data.get('amount'),
                'expires_at': data.get('expires_at'),
                'payment_link': f\"https://bms-app.com/orders/{data.get('order_id')}/payment\"
            }
        }
        
        # In production: send via email service
        logger.info(\"Order confirmation email queued\", extra=email_content)
        
    except Exception as e:
        logger.error(\"Failed to send order confirmation email\", error=e)
        raise

def send_ticket_confirmation_email(data: Dict[str, Any]) -> None:
    \"\"\"Send ticket confirmation email with QR code\"\"\"
    try:
        logger.info(\"Sending ticket confirmation email\", extra={
            'order_id': data.get('order_id'),
            'ticket_code': data.get('ticket_code'),
            'customer_email': data.get('customer_email')
        })
        
        # Mock email sending
        email_content = {
            'to': data.get('customer_email'),
            'subject': f\"Your Tickets - {data.get('movie_title')}\",
            'template': 'ticket_confirmation',
            'data': {
                'customer_name': data.get('customer_name'),
                'ticket_code': data.get('ticket_code'),
                'movie_title': data.get('movie_title'),
                'theatre_name': data.get('theatre_name'),
                'show_time': data.get('show_time'),
                'seat_ids': data.get('seat_ids', []),
                'qr_code_url': f\"https://api.qrserver.com/v1/create-qr-code/?data={data.get('ticket_code')}\"
            }
        }
        
        logger.info(\"Ticket confirmation email queued\", extra=email_content)
        
    except Exception as e:
        logger.error(\"Failed to send ticket confirmation email\", error=e)
        raise

def send_ticket_sms(data: Dict[str, Any]) -> None:
    \"\"\"Send SMS notification with ticket details\"\"\"
    try:
        phone = data.get('phone')
        if not phone:
            return
            
        logger.info(\"Sending ticket SMS\", extra={
            'phone': phone[:4] + '****' + phone[-4:],  # Masked for logging
            'ticket_code': data.get('ticket_code')
        })
        
        # Mock SMS sending
        sms_content = {
            'to': phone,
            'message': f\"Your ticket for {data.get('movie_title')} is confirmed! \"
                      f\"Ticket Code: {data.get('ticket_code')}. \"
                      f\"Show: {data.get('show_time')}. \"
                      f\"Have a great time at the movies!\"
        }
        
        # In production: send via SNS, Twilio, etc.
        logger.info(\"Ticket SMS queued\", extra=sms_content)
        
    except Exception as e:
        logger.error(\"Failed to send ticket SMS\", error=e)
        # Don't re-raise - SMS is not critical

def update_analytics(event_type: str, data: Dict[str, Any]) -> None:
    \"\"\"Update analytics/metrics\"\"\"
    try:
        # In production, this would send to:
        # - CloudWatch metrics
        # - DataDog
        # - Analytics database
        # - Data warehouse (Redshift, BigQuery)
        
        logger.info(\"Updating analytics\", extra={
            'event_type': event_type,
            'data': data
        })
        
        # Mock analytics update
        analytics_event = {
            'timestamp': data.get('timestamp'),
            'event_type': event_type,
            'properties': data
        }
        
        # In production: send to analytics service
        logger.info(\"Analytics event recorded\", extra=analytics_event)
        
    except Exception as e:
        logger.error(\"Failed to update analytics\", error=e)
        # Don't re-raise - analytics failure shouldn't break the flow