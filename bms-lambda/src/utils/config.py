import os
from urllib.parse import urlparse

class Config:
    """Configuration class for BMS Lambda functions"""
    
    # Parse DATABASE_URL if provided, otherwise use individual env vars
    database_url = os.getenv('DATABASE_URL')
    if database_url:
        parsed_db = urlparse(database_url)
        DATABASE_HOST = parsed_db.hostname or 'localhost'
        DATABASE_PORT = parsed_db.port or 5432
        DATABASE_NAME = parsed_db.path.lstrip('/') if parsed_db.path else 'bms_production'
        DATABASE_USER = parsed_db.username or 'bms_user'
        DATABASE_PASSWORD = parsed_db.password or ''
    else:
        DATABASE_HOST = os.getenv('DATABASE_HOST', 'localhost')
        DATABASE_PORT = int(os.getenv('DATABASE_PORT', '5432'))
        DATABASE_NAME = os.getenv('DATABASE_NAME', 'bms_production')
        DATABASE_USER = os.getenv('DATABASE_USER', 'bms_user')
        DATABASE_PASSWORD = os.getenv('DATABASE_PASSWORD', '')
    
    DATABASE_SSL = os.getenv('DATABASE_SSL', 'true').lower() == 'true'
    
    # Parse REDIS_URL if provided, otherwise use individual env vars
    redis_url = os.getenv('REDIS_URL')
    if redis_url:
        parsed_redis = urlparse(redis_url)
        REDIS_HOST = parsed_redis.hostname or 'localhost'
        REDIS_PORT = parsed_redis.port or 6379
        REDIS_PASSWORD = parsed_redis.password or ''
        REDIS_TLS = parsed_redis.scheme == 'rediss'
    else:
        REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
        REDIS_PORT = int(os.getenv('REDIS_PORT', '6379'))
        REDIS_TLS = os.getenv('REDIS_TLS', 'false').lower() == 'true'
        REDIS_PASSWORD = os.getenv('REDIS_PASSWORD', '')
    
    # SQS Configuration
    SQS_QUEUE_URL = os.getenv('SQS_QUEUE_URL', '')
    
    # Application Configuration
    HOLD_TTL_SECONDS = int(os.getenv('HOLD_TTL_SECONDS', '300'))  # 5 minutes
    ORDER_TTL_SECONDS = int(os.getenv('ORDER_TTL_SECONDS', '300'))  # 5 minutes
    MAX_SEATS_PER_BOOKING = int(os.getenv('MAX_SEATS_PER_BOOKING', '10'))
    
    # AWS Region
    AWS_REGION = os.getenv('AWS_REGION', 'us-east-1')
    
    @property
    def database_url(self) -> str:
        """Construct PostgreSQL connection URL"""
        ssl_mode = "require" if self.DATABASE_SSL else "disable"
        return f"postgresql://{self.DATABASE_USER}:{self.DATABASE_PASSWORD}@{self.DATABASE_HOST}:{self.DATABASE_PORT}/{self.DATABASE_NAME}?sslmode={ssl_mode}"

config = Config()