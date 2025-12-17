import re
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

class ValidationError(Exception):
    """Custom validation error"""
    pass

class BMSValidator:
    """Validation utilities for BMS Lambda functions"""
    
    @staticmethod
    def validate_uuid(value: str) -> bool:
        """Validate UUID format"""
        uuid_pattern = r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        return bool(re.match(uuid_pattern, value.lower()))
    
    @staticmethod
    def validate_email(email: str) -> bool:
        """Validate email format"""
        email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
        return bool(re.match(email_pattern, email))
    
    @staticmethod
    def validate_phone(phone: str) -> bool:
        """Validate phone number (Indian format)"""
        phone_pattern = r'^[6-9]\d{9}$'  # Indian mobile number
        return bool(re.match(phone_pattern, phone.replace('+91', '').replace(' ', '').replace('-', '')))
    
    @staticmethod
    def validate_seat_ids(seat_ids: List[str]) -> bool:
        """Validate seat ID format (e.g., A1, B12)"""
        seat_pattern = r'^[A-Z]\d{1,2}$'
        return all(re.match(seat_pattern, seat_id) for seat_id in seat_ids)
    
    @staticmethod
    def validate_hold_request(data: Dict[str, Any]) -> None:
        """Validate hold creation request"""
        required_fields = ['showId', 'seatIds', 'quantity']
        
        for field in required_fields:
            if field not in data:
                raise ValidationError(f"Missing required field: {field}")
        
        if not BMSValidator.validate_uuid(data['showId']):
            raise ValidationError("Invalid showId format")
        
        if not isinstance(data['seatIds'], list) or len(data['seatIds']) == 0:
            raise ValidationError("seatIds must be a non-empty list")
        
        if not BMSValidator.validate_seat_ids(data['seatIds']):
            raise ValidationError("Invalid seat ID format")
        
        if data['quantity'] != len(data['seatIds']):
            raise ValidationError("Quantity must match number of seat IDs")
        
        if data['quantity'] > 10:  # MAX_SEATS_PER_BOOKING
            raise ValidationError("Cannot book more than 10 seats")
    
    @staticmethod
    def validate_order_request(data: Dict[str, Any]) -> None:
        """Validate order creation request"""
        required_fields = ['holdId', 'customer']
        
        for field in required_fields:
            if field not in data:
                raise ValidationError(f"Missing required field: {field}")
        
        if not BMSValidator.validate_uuid(data['holdId']):
            raise ValidationError("Invalid holdId format")
        
        customer = data['customer']
        customer_required = ['name', 'email', 'phone']
        
        for field in customer_required:
            if field not in customer:
                raise ValidationError(f"Missing customer field: {field}")
        
        if not BMSValidator.validate_email(customer['email']):
            raise ValidationError("Invalid email format")
        
        if not BMSValidator.validate_phone(customer['phone']):
            raise ValidationError("Invalid phone number format")
    
    @staticmethod
    def validate_date_format(date_str: str) -> bool:
        """Validate date format (YYYY-MM-DD)"""
        try:
            datetime.strptime(date_str, '%Y-%m-%d')
            return True
        except ValueError:
            return False