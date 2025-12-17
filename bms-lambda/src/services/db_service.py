import psycopg2
import psycopg2.extras
from psycopg2.pool import ThreadedConnectionPool
from typing import List, Dict, Any, Optional, Tuple
from contextlib import contextmanager
import json
from datetime import datetime, timezone

from utils.config import config
from utils.logger import BMSLogger

logger = BMSLogger(__name__)

class DatabaseService:
    """PostgreSQL database service for BMS Lambda functions"""
    
    _instance = None
    _pool = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(DatabaseService, cls).__new__(cls)
            cls._instance._initialize_pool()
        return cls._instance
    
    def _initialize_pool(self):
        """Initialize connection pool"""
        try:
            self._pool = ThreadedConnectionPool(
                minconn=1,
                maxconn=5,
                host=config.DATABASE_HOST,
                port=config.DATABASE_PORT,
                database=config.DATABASE_NAME,
                user=config.DATABASE_USER,
                password=config.DATABASE_PASSWORD,
                sslmode='require' if config.DATABASE_SSL else 'disable'
            )
            logger.info("Database connection pool initialized")
        except Exception as e:
            logger.error("Failed to initialize database pool", error=e)
            # Don't raise for initial deployment - let functions handle gracefully
            self._pool = None
    
    @contextmanager
    def get_connection(self):
        """Get database connection from pool"""
        if not self._pool:
            raise Exception("Database pool not initialized - check connection settings")
        
        conn = None
        try:
            conn = self._pool.getconn()
            yield conn
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error("Database connection error", error=e)
            raise
        finally:
            if conn and self._pool:
                self._pool.putconn(conn)
    
    def execute_query(self, query: str, params: Tuple = None) -> List[Dict[str, Any]]:
        """Execute SELECT query and return results"""
        with self.get_connection() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cursor:
                cursor.execute(query, params)
                results = cursor.fetchall()
                return [dict(row) for row in results]
    
    def execute_update(self, query: str, params: Tuple = None) -> int:
        """Execute INSERT/UPDATE/DELETE query"""
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, params)
                conn.commit()
                return cursor.rowcount
    
    def execute_transaction(self, operations: List[Tuple[str, Tuple]]) -> bool:
        """Execute multiple operations in a transaction"""
        with self.get_connection() as conn:
            try:
                with conn.cursor() as cursor:
                    for query, params in operations:
                        cursor.execute(query, params)
                conn.commit()
                return True
            except Exception as e:
                conn.rollback()
                logger.error("Transaction failed", error=e)
                raise
    
    # Movies operations
    def get_movies(self, limit: int = 20, offset: int = 0) -> List[Dict[str, Any]]:
        """Get paginated movie list"""
        query = """
        SELECT movie_id, title, thumbnail_url, rating, duration_mins, genres
        FROM movies 
        ORDER BY release_date DESC NULLS LAST
        LIMIT %s OFFSET %s
        """
        return self.execute_query(query, (limit, offset))
    
    def get_movie_by_id(self, movie_id: str) -> Optional[Dict[str, Any]]:
        """Get movie details by ID"""
        query = """
        SELECT * FROM movies WHERE movie_id = %s
        """
        results = self.execute_query(query, (movie_id,))
        return results[0] if results else None
    
    def get_shows_by_movie_and_date(self, movie_id: str, date: str) -> List[Dict[str, Any]]:
        """Get shows for a movie on specific date"""
        query = """
        SELECT s.show_id, s.start_time, s.price, s.status,
               t.theatre_id, t.name as theatre_name, t.address, 
               t.geo_lat, t.geo_lng, t.cancellation_available
        FROM shows s
        JOIN theatres t ON s.theatre_id = t.theatre_id
        WHERE s.movie_id = %s 
          AND DATE(s.start_time) = %s 
          AND s.status != 'CANCELLED'
        ORDER BY t.name, s.start_time
        """
        return self.execute_query(query, (movie_id, date))
    
    def get_show_by_id(self, show_id: str) -> Optional[Dict[str, Any]]:
        """Get show details by ID"""
        query = """
        SELECT s.*, t.name as theatre_name, m.title as movie_title
        FROM shows s
        JOIN theatres t ON s.theatre_id = t.theatre_id
        JOIN movies m ON s.movie_id = m.movie_id
        WHERE s.show_id = %s
        """
        results = self.execute_query(query, (show_id,))
        return results[0] if results else None
    
    # Orders operations
    def get_confirmed_seats_for_show(self, show_id: str) -> List[str]:
        """Get confirmed seat IDs for a show"""
        query = """
        SELECT seat_ids FROM orders 
        WHERE show_id = %s AND status = 'CONFIRMED'
        """
        results = self.execute_query(query, (show_id,))
        confirmed_seats = []
        for row in results:
            if row['seat_ids']:
                confirmed_seats.extend(row['seat_ids'])
        return confirmed_seats
    
    def create_order(self, order_data: Dict[str, Any]) -> str:
        """Create new order"""
        query = """
        INSERT INTO orders (
            order_id, hold_id, user_id, show_id, movie_id, theatre_id,
            seat_ids, customer_name, customer_email, customer_phone,
            amount, status, created_at, expires_at
        ) VALUES (
            %(order_id)s, %(hold_id)s, %(user_id)s, %(show_id)s, %(movie_id)s, %(theatre_id)s,
            %(seat_ids)s, %(customer_name)s, %(customer_email)s, %(customer_phone)s,
            %(amount)s, %(status)s, %(created_at)s, %(expires_at)s
        ) RETURNING order_id
        """
        
        with self.get_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, order_data)
                order_id = cursor.fetchone()[0]
                conn.commit()
                return order_id
    
    def get_order_by_id(self, order_id: str) -> Optional[Dict[str, Any]]:
        """Get order by ID"""
        query = """
        SELECT o.*, s.start_time, m.title as movie_title, t.name as theatre_name
        FROM orders o
        JOIN shows s ON o.show_id = s.show_id
        JOIN movies m ON o.movie_id = m.movie_id
        JOIN theatres t ON o.theatre_id = t.theatre_id
        WHERE o.order_id = %s
        """
        results = self.execute_query(query, (order_id,))
        return results[0] if results else None
    
    def confirm_order_payment(self, order_id: str, ticket_code: str) -> bool:
        """Confirm order payment"""
        query = """
        UPDATE orders 
        SET status = 'CONFIRMED', ticket_code = %s, updated_at = %s
        WHERE order_id = %s AND status = 'PAYMENT_PENDING'
        """
        updated_at = datetime.now(timezone.utc)
        rows_affected = self.execute_update(query, (ticket_code, updated_at, order_id))
        return rows_affected > 0

# Global database service instance
db_service = DatabaseService()