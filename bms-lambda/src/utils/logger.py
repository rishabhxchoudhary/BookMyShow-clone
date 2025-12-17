import logging
import json
import traceback
from datetime import datetime
from typing import Dict, Any

# Configure logging for Lambda
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

class BMSLogger:
    """Custom logger for BMS Lambda functions with structured logging"""
    
    def __init__(self, name: str):
        self.logger = logging.getLogger(name)
    
    def info(self, message: str, extra: Dict[str, Any] = None):
        """Log info message with optional extra context"""
        log_data = {
            'timestamp': datetime.utcnow().isoformat(),
            'level': 'INFO',
            'message': message
        }
        if extra:
            log_data.update(extra)
        self.logger.info(json.dumps(log_data))
    
    def error(self, message: str, error: Exception = None, extra: Dict[str, Any] = None):
        """Log error message with exception details"""
        log_data = {
            'timestamp': datetime.utcnow().isoformat(),
            'level': 'ERROR',
            'message': message
        }
        if error:
            log_data.update({
                'error_type': type(error).__name__,
                'error_message': str(error),
                'traceback': traceback.format_exc()
            })
        if extra:
            log_data.update(extra)
        self.logger.error(json.dumps(log_data))
    
    def warning(self, message: str, extra: Dict[str, Any] = None):
        """Log warning message"""
        log_data = {
            'timestamp': datetime.utcnow().isoformat(),
            'level': 'WARNING',
            'message': message
        }
        if extra:
            log_data.update(extra)
        self.logger.warning(json.dumps(log_data))