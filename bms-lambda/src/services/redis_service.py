import redis
import json
from typing import List, Dict, Any, Optional, Set
from datetime import datetime, timezone, timedelta

from utils.config import config
from utils.logger import BMSLogger

logger = BMSLogger(__name__)

class RedisService:
    """Redis service for seat locking and caching"""
    
    _instance = None
    _client = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(RedisService, cls).__new__(cls)
            cls._instance._initialize_client()
        return cls._instance
    
    def _initialize_client(self):
        """Initialize Redis client"""
        try:
            self._client = redis.Redis(
                host=config.REDIS_HOST,
                port=config.REDIS_PORT,
                password=config.REDIS_PASSWORD if config.REDIS_PASSWORD else None,
                ssl=config.REDIS_TLS,
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5,
                retry_on_timeout=True
            )
            # Test connection
            self._client.ping()
            logger.info("Redis client initialized successfully")
        except Exception as e:
            logger.error("Failed to initialize Redis client", error=e)
            # Don't raise for initial deployment - let functions handle gracefully
            self._client = None
    
    def ping(self) -> bool:
        """Test Redis connection"""
        try:
            return self._client.ping()
        except Exception as e:
            logger.error("Redis ping failed", error=e)
            return False
    
    # Lua scripts for atomic operations
    LOCK_SEATS_SCRIPT = """
    local showId = ARGV[1]
    local userId = ARGV[2]
    local holdId = ARGV[3]
    local ttl = tonumber(ARGV[4])
    
    -- Phase 1: Check all seats are available
    for i, seatId in ipairs(KEYS) do
        local key = "seat_lock:" .. showId .. ":" .. seatId
        local existing = redis.call('GET', key)
        
        if existing then
            -- Parse existing lock: "userId:holdId"
            local existingUserId = string.match(existing, "^([^:]+)")
            
            -- If different user owns the lock, reject
            if existingUserId ~= userId then
                return cjson.encode({
                    success = false,
                    error = "SEAT_TAKEN",
                    seat = seatId,
                    message = "Seat " .. seatId .. " is already taken"
                })
            end
        end
    end
    
    -- Phase 2: Atomically lock all seats
    local lockValue = userId .. ":" .. holdId
    
    for i, seatId in ipairs(KEYS) do
        local key = "seat_lock:" .. showId .. ":" .. seatId
        redis.call('SET', key, lockValue, 'EX', ttl)
    end
    
    return cjson.encode({
        success = true,
        holdId = holdId,
        seats = KEYS,
        expiresIn = ttl
    })
    """
    
    RELEASE_SEATS_SCRIPT = """
    local showId = ARGV[1]
    local userId = ARGV[2]
    local released = {}
    
    for i, seatId in ipairs(KEYS) do
        local key = "seat_lock:" .. showId .. ":" .. seatId
        local existing = redis.call('GET', key)
        
        if existing then
            local existingUserId = string.match(existing, "^([^:]+)")
            
            -- Only release if user owns the lock
            if existingUserId == userId then
                redis.call('DEL', key)
                table.insert(released, seatId)
            end
        end
    end
    
    return cjson.encode({
        success = true,
        released = released
    })
    """
    
    def lock_seats_atomic(self, show_id: str, user_id: str, seat_ids: List[str], hold_id: str) -> Dict[str, Any]:
        """Atomically lock multiple seats using Lua script"""
        try:
            # Prepare keys (seat IDs)
            keys = seat_ids
            args = [show_id, user_id, hold_id, config.HOLD_TTL_SECONDS]
            
            result = self._client.eval(self.LOCK_SEATS_SCRIPT, len(keys), *(keys + args))
            return json.loads(result)
            
        except Exception as e:
            logger.error("Failed to lock seats atomically", error=e, extra={
                'show_id': show_id,
                'user_id': user_id,
                'seat_ids': seat_ids,
                'hold_id': hold_id
            })
            return {
                'success': False,
                'error': 'REDIS_ERROR',
                'message': str(e)
            }
    
    def release_seats_atomic(self, show_id: str, user_id: str, seat_ids: List[str]) -> Dict[str, Any]:
        """Atomically release multiple seats using Lua script"""
        try:
            keys = seat_ids
            args = [show_id, user_id]
            
            result = self._client.eval(self.RELEASE_SEATS_SCRIPT, len(keys), *(keys + args))
            return json.loads(result)
            
        except Exception as e:
            logger.error("Failed to release seats atomically", error=e, extra={
                'show_id': show_id,
                'user_id': user_id,
                'seat_ids': seat_ids
            })
            return {
                'success': False,
                'error': 'REDIS_ERROR',
                'message': str(e)
            }
    
    def get_locked_seats_for_show(self, show_id: str) -> List[str]:
        """Get all locked seats for a show"""
        try:
            pattern = f"seat_lock:{show_id}:*"
            keys = self._client.keys(pattern)
            
            locked_seats = []
            for key in keys:
                # Extract seat ID from key pattern
                seat_id = key.split(':')[-1]
                locked_seats.append(seat_id)
            
            return locked_seats
            
        except Exception as e:
            logger.error("Failed to get locked seats", error=e, extra={'show_id': show_id})
            return []
    
    def store_hold(self, hold_data: Dict[str, Any]) -> bool:
        """Store hold metadata in Redis"""
        try:
            key = f"hold:{hold_data['hold_id']}"
            value = json.dumps(hold_data)
            self._client.setex(key, config.HOLD_TTL_SECONDS, value)
            return True
            
        except Exception as e:
            logger.error("Failed to store hold", error=e, extra={'hold_data': hold_data})
            return False
    
    def get_hold(self, hold_id: str) -> Optional[Dict[str, Any]]:
        """Get hold data from Redis"""
        try:
            key = f"hold:{hold_id}"
            value = self._client.get(key)
            
            if value:
                return json.loads(value)
            return None
            
        except Exception as e:
            logger.error("Failed to get hold", error=e, extra={'hold_id': hold_id})
            return None
    
    def delete_hold(self, hold_id: str) -> bool:
        """Delete hold from Redis"""
        try:
            key = f"hold:{hold_id}"
            deleted = self._client.delete(key)
            return deleted > 0
            
        except Exception as e:
            logger.error("Failed to delete hold", error=e, extra={'hold_id': hold_id})
            return False
    
    def cache_seat_availability(self, show_id: str, availability_data: Dict[str, Any], ttl: int = 10) -> bool:
        """Cache seat availability data"""
        try:
            key = f"seatmap:{show_id}"
            value = json.dumps(availability_data)
            self._client.setex(key, ttl, value)
            return True
            
        except Exception as e:
            logger.error("Failed to cache seat availability", error=e)
            return False
    
    def get_cached_seat_availability(self, show_id: str) -> Optional[Dict[str, Any]]:
        """Get cached seat availability"""
        try:
            key = f"seatmap:{show_id}"
            value = self._client.get(key)
            
            if value:
                return json.loads(value)
            return None
            
        except Exception as e:
            logger.error("Failed to get cached seat availability", error=e)
            return None
    
    def set_rate_limit(self, user_id: str, endpoint: str, limit: int = 100, window: int = 60) -> bool:
        """Set rate limit for user endpoint"""
        try:
            key = f"ratelimit:{user_id}:{endpoint}"
            current = self._client.incr(key)
            
            if current == 1:
                self._client.expire(key, window)
            
            return current <= limit
            
        except Exception as e:
            logger.error("Failed to check rate limit", error=e)
            return True  # Allow request if Redis fails
    
    def cleanup_expired_holds(self) -> int:
        """Clean up expired hold metadata (utility function)"""
        try:
            pattern = "hold:*"
            keys = self._client.keys(pattern)
            expired_count = 0
            
            for key in keys:
                ttl = self._client.ttl(key)
                if ttl == -2:  # Key doesn't exist
                    expired_count += 1
            
            return expired_count
            
        except Exception as e:
            logger.error("Failed to cleanup expired holds", error=e)
            return 0

# Global Redis service instance
redis_service = RedisService()