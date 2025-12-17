import boto3
import json
from typing import Dict, Any
from datetime import datetime, timezone

from utils.config import config
from utils.logger import BMSLogger

logger = BMSLogger(__name__)

class SQSService:
    """SQS service for event processing"""
    
    def __init__(self):
        self.sqs = boto3.client('sqs', region_name=config.AWS_REGION)
        self.queue_url = config.SQS_QUEUE_URL
    
    def send_event(self, event_type: str, data: Dict[str, Any]) -> bool:
        """Send event to SQS queue"""
        try:
            message = {
                'eventType': event_type,
                'timestamp': datetime.now(timezone.utc).isoformat(),
                'data': data
            }
            
            response = self.sqs.send_message(
                QueueUrl=self.queue_url,
                MessageBody=json.dumps(message),
                MessageAttributes={
                    'eventType': {
                        'StringValue': event_type,
                        'DataType': 'String'
                    }
                }
            )
            
            logger.info("Event sent to SQS", extra={
                'event_type': event_type,
                'message_id': response['MessageId'],
                'data': data
            })
            
            return True
            
        except Exception as e:
            logger.error("Failed to send event to SQS", error=e, extra={
                'event_type': event_type,
                'data': data
            })
            return False
    
    def send_order_created_event(self, order_data: Dict[str, Any]) -> bool:
        """Send order created event"""
        return self.send_event('order.created', order_data)
    
    def send_order_confirmed_event(self, order_data: Dict[str, Any]) -> bool:
        """Send order confirmed event"""
        return self.send_event('order.confirmed', order_data)
    
    def send_hold_created_event(self, hold_data: Dict[str, Any]) -> bool:
        """Send hold created event"""
        return self.send_event('hold.created', hold_data)
    
    def send_hold_released_event(self, hold_data: Dict[str, Any]) -> bool:
        """Send hold released event"""
        return self.send_event('hold.released', hold_data)
    
    def send_hold_expired_event(self, hold_data: Dict[str, Any]) -> bool:
        """Send hold expired event"""
        return self.send_event('hold.expired', hold_data)
    
    def send_show_sold_out_event(self, show_data: Dict[str, Any]) -> bool:
        """Send show sold out event"""
        return self.send_event('show.sold_out', show_data)

# Global SQS service instance
sqs_service = SQSService()