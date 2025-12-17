"""
Lambda-based Shows Data Generator
Can be invoked through API Gateway or run as standalone Lambda function
"""

import json
import uuid
import random
from datetime import datetime, timedelta, time
from typing import List, Dict, Any
import os
import sys

# Add the src directory to Python path
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.insert(0, parent_dir)

try:
    from services.db_service import DatabaseService
except ImportError:
    # Fallback for Lambda environment
    import psycopg2
    from psycopg2.extras import RealDictCursor
    
    class DatabaseService:
        def __init__(self):
            self.connection = None
        
        def get_connection(self):
            if not self.connection:
                try:
                    database_url = os.environ.get('DATABASE_URL')
                    print(f"Database URL: {database_url[:50]}..." if database_url else "No DATABASE_URL found")
                    
                    if database_url:
                        self.connection = psycopg2.connect(database_url, cursor_factory=RealDictCursor)
                    else:
                        host = os.environ.get('DATABASE_HOST', 'localhost')
                        db_name = os.environ.get('DATABASE_NAME', 'bms')
                        user = os.environ.get('DATABASE_USER', 'postgres')
                        print(f"Connecting to: {host}:{db_name} as {user}")
                        
                        self.connection = psycopg2.connect(
                            host=host,
                            database=db_name,
                            user=user,
                            password=os.environ.get('DATABASE_PASSWORD', ''),
                            cursor_factory=RealDictCursor
                        )
                    print("Database connection established successfully")
                except Exception as e:
                    print(f"Database connection failed: {str(e)}")
                    raise e
            return self.connection
        
        def execute_query(self, query, params=None):
            conn = self.get_connection()
            with conn.cursor() as cur:
                cur.execute(query, params)
                query_upper = query.strip().upper()
                
                if query_upper.startswith('SELECT'):
                    results = cur.fetchall()
                    return [dict(row) for row in results]  # Convert to list of dicts
                elif query_upper.startswith(('INSERT', 'UPDATE', 'DELETE')):
                    conn.commit()
                    return cur.rowcount  # Return number of affected rows
                else:
                    conn.commit()
                    return None
        
        def execute_many(self, query, params_list):
            if not params_list:
                return 0
            
            conn = self.get_connection()
            with conn.cursor() as cur:
                cur.executemany(query, params_list)
                conn.commit()
                return len(params_list)  # Return number of operations performed

# Show time slots for different types of movies
SHOW_TIMES = [
    time(10, 0),   # 10:00 AM
    time(13, 30),  # 1:30 PM
    time(16, 45),  # 4:45 PM
    time(19, 15),  # 7:15 PM
    time(22, 0),   # 10:00 PM
]

# Weekday vs Weekend show patterns
WEEKDAY_SHOWS = [time(16, 45), time(19, 15), time(22, 0)]  # Evening shows on weekdays
WEEKEND_SHOWS = SHOW_TIMES  # All shows on weekends

# Price ranges based on show time
PRICE_MAPPING = {
    time(10, 0): (200, 300),   # Morning shows - cheaper
    time(13, 30): (250, 350),  # Afternoon shows
    time(16, 45): (300, 450),  # Evening shows
    time(19, 15): (350, 500),  # Prime time - most expensive
    time(22, 0): (300, 400),   # Night shows
}

# Show status distribution (weighted random)
SHOW_STATUSES = [
    ("active", 0.7),        # 70% active
    ("filling_fast", 0.2),  # 20% filling fast
    ("almost_full", 0.1),   # 10% almost full
]

def get_weighted_status() -> str:
    """Get a random status based on weighted distribution"""
    rand = random.random()
    cumulative = 0.0
    
    for status, weight in SHOW_STATUSES:
        cumulative += weight
        if rand <= cumulative:
            return status
    
    return "active"  # fallback

def generate_show_price(show_time: time, base_price: int = 300) -> int:
    """Generate price based on show time"""
    price_range = PRICE_MAPPING.get(show_time, (250, 400))
    return random.randint(*price_range)

def generate_shows_data(days_ahead: int = 14) -> Dict[str, Any]:
    """Generate shows data for the specified number of days"""
    
    try:
        db_service = DatabaseService()
        
        # Get movies and theatres
        print(f"Fetching movies and theatres from database...")
        movies_query = "SELECT movie_id, title, duration_mins FROM movies ORDER BY title"
        theatres_query = """
            SELECT theatre_id, name, address, geo_lat, geo_lng, 
                   cancellation_available FROM theatres 
            ORDER BY name
        """
        
        movies = db_service.execute_query(movies_query)
        theatres = db_service.execute_query(theatres_query)
        
        print(f"Found {len(movies) if movies else 0} movies and {len(theatres) if theatres else 0} theatres")
    
    except Exception as e:
        print(f"Database error: {str(e)}")
        return {
            "success": False,
            "message": f"Database connection error: {str(e)}"
        }
    
    if not movies or not theatres:
        return {
            "success": False,
            "message": "No movies or theatres found in database"
        }
    
    # Clear existing future shows
    start_date = datetime.now()
    clear_query = "DELETE FROM shows WHERE DATE(start_time) >= %s"
    try:
        deleted_count = db_service.execute_update(clear_query, (start_date.date(),))
        print(f"Cleared {deleted_count} existing shows from {start_date.date()}")
    except Exception as e:
        print(f"Error clearing existing shows: {str(e)}")
        # Continue anyway - this might fail if there are no existing shows
    
    # Generate shows for each day
    total_shows = 0
    all_shows = []
    
    for day_offset in range(days_ahead):
        target_date = start_date + timedelta(days=day_offset)
        is_weekend = target_date.weekday() >= 5  # Saturday = 5, Sunday = 6
        
        # Choose show times based on day type
        available_times = WEEKEND_SHOWS if is_weekend else WEEKDAY_SHOWS
        
        for movie in movies:
            # Each movie gets shows in 60-80% of theatres
            num_theatres = random.randint(
                int(len(theatres) * 0.6), 
                int(len(theatres) * 0.8)
            )
            selected_theatres = random.sample(theatres, num_theatres)
            
            for theatre in selected_theatres:
                # Each theatre gets 2-4 shows per movie
                num_shows = random.randint(2, min(4, len(available_times)))
                selected_times = random.sample(available_times, num_shows)
                
                for show_time in selected_times:
                    show_datetime = datetime.combine(target_date.date(), show_time)
                    
                    show = {
                        'show_id': str(uuid.uuid4()),
                        'movie_id': movie['movie_id'],
                        'theatre_id': theatre['theatre_id'], 
                        'start_time': show_datetime,
                        'price': generate_show_price(show_time),
                        'status': get_weighted_status()
                    }
                    all_shows.append(show)
    
    # Insert all shows in batches
    if all_shows:
        print(f"Inserting {len(all_shows)} shows into database...")
        insert_query = """
            INSERT INTO shows 
            (show_id, movie_id, theatre_id, start_time, price, status, created_at)
            VALUES 
            (%s, %s, %s, %s, %s, %s, NOW())
        """
        
        try:
            # Insert shows one by one using execute_update
            inserted_count = 0
            for show in all_shows:
                try:
                    # Convert show dict to tuple for execute_update
                    params = (
                        show['show_id'], show['movie_id'], show['theatre_id'],
                        show['start_time'], show['price'], show['status']
                    )
                    db_service.execute_update(insert_query, params)
                    inserted_count += 1
                except Exception as e:
                    print(f"Error inserting show {show['show_id']}: {str(e)}")
                    continue
            
            print(f"Successfully inserted {inserted_count} out of {len(all_shows)} shows")
            
            total_shows = len(all_shows)
            print(f"Successfully inserted all {total_shows} shows")
        except Exception as e:
            print(f"Error inserting shows: {str(e)}")
            return {
                "success": False,
                "message": f"Error inserting shows: {str(e)}"
            }
    
    return {
        "success": True,
        "message": f"Generated {total_shows} shows for {days_ahead} days",
        "stats": {
            "total_shows": total_shows,
            "shows_per_day": total_shows // days_ahead if days_ahead > 0 else 0,
            "movies_covered": len(movies),
            "theatres_covered": len(theatres),
            "days_generated": days_ahead
        }
    }

def lambda_handler(event, context):
    """Lambda function handler"""
    try:
        # Get days_ahead from query parameters or body
        days_ahead = 14  # default
        
        if event.get('queryStringParameters') and event['queryStringParameters'].get('days'):
            days_ahead = int(event['queryStringParameters']['days'])
        elif event.get('body'):
            body = json.loads(event['body'])
            days_ahead = int(body.get('days', 14))
        
        # Generate shows data
        result = generate_shows_data(days_ahead)
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps(result)
        }
    
    except Exception as e:
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'success': False,
                'message': f'Error generating shows: {str(e)}'
            })
        }

def create_error_response(status_code: int, message: str) -> Dict[str, Any]:
    """Create error response"""
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        'body': json.dumps({
            'error': {
                'message': message,
                'timestamp': datetime.utcnow().isoformat()
            }
        })
    }

# For local testing
if __name__ == "__main__":
    # Mock event for testing
    test_event = {
        'queryStringParameters': {'days': '7'}
    }
    result = lambda_handler(test_event, None)
    print(json.dumps(json.loads(result['body']), indent=2))