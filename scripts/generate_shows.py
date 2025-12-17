#!/usr/bin/env python3
"""
BookMyShow Shows Data Generator
Generates show times for all movies across all theatres for the next 14 days
"""

import os
import sys
import json
import uuid
import random
from datetime import datetime, timedelta, time
from typing import List, Dict, Any
import psycopg2
from psycopg2.extras import RealDictCursor

# Database connection parameters
DB_HOST = "bookmyshow.cxwyaqu60aes.ap-south-1.rds.amazonaws.com"
DB_NAME = "bookmyshow"
DB_USER = "bookmyshow"
DB_PASSWORD = "BookMyShowClone123!"

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

def get_db_connection():
    """Create database connection"""
    try:
        conn = psycopg2.connect(
            host=DB_HOST,
            database=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
            cursor_factory=RealDictCursor
        )
        return conn
    except Exception as e:
        print(f"Error connecting to database: {e}")
        sys.exit(1)

def get_movies(conn) -> List[Dict[str, Any]]:
    """Fetch all movies from database"""
    with conn.cursor() as cur:
        cur.execute("SELECT movie_id, title, duration_mins FROM movies ORDER BY title")
        return cur.fetchall()

def get_theatres(conn) -> List[Dict[str, Any]]:
    """Fetch all theatres from database"""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT theatre_id, name, address, geo_lat, geo_lng, 
                   cancellation_available FROM theatres 
            ORDER BY name
        """)
        return cur.fetchall()

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

def clear_existing_shows(conn, start_date: datetime):
    """Remove existing shows from start_date onwards"""
    with conn.cursor() as cur:
        cur.execute("""
            DELETE FROM shows 
            WHERE DATE(start_time) >= %s
        """, (start_date.date(),))
        deleted_count = cur.rowcount
        print(f"Cleared {deleted_count} existing shows from {start_date.date()} onwards")

def generate_shows_for_date(movies: List[Dict], theatres: List[Dict], 
                          target_date: datetime) -> List[Dict]:
    """Generate shows for a specific date"""
    shows = []
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
                    'status': get_weighted_status(),
                    'available_seats': random.randint(80, 150),  # Assuming theatre capacity
                    'total_seats': 150
                }
                shows.append(show)
    
    return shows

def insert_shows(conn, shows: List[Dict]):
    """Insert shows into database"""
    if not shows:
        print("No shows to insert")
        return
    
    with conn.cursor() as cur:
        # Prepare the insert query
        insert_query = """
            INSERT INTO shows 
            (show_id, movie_id, theatre_id, start_time, price, status, 
             available_seats, total_seats, created_at, updated_at)
            VALUES 
            (%(show_id)s, %(movie_id)s, %(theatre_id)s, %(start_time)s, 
             %(price)s, %(status)s, %(available_seats)s, %(total_seats)s, 
             NOW(), NOW())
        """
        
        # Execute batch insert
        cur.executemany(insert_query, shows)
        print(f"Inserted {len(shows)} shows")

def main():
    print("🎬 BookMyShow Shows Data Generator")
    print("=" * 50)
    
    # Get command line arguments
    days_ahead = 14  # Generate for next 14 days
    if len(sys.argv) > 1:
        try:
            days_ahead = int(sys.argv[1])
        except ValueError:
            print("Usage: python generate_shows.py [days_ahead]")
            sys.exit(1)
    
    print(f"Generating shows for next {days_ahead} days...")
    
    # Connect to database
    conn = get_db_connection()
    
    try:
        # Get data from database
        print("📋 Fetching movies and theatres...")
        movies = get_movies(conn)
        theatres = get_theatres(conn)
        
        print(f"Found {len(movies)} movies and {len(theatres)} theatres")
        
        if not movies or not theatres:
            print("❌ No movies or theatres found in database!")
            return
        
        # Clear existing future shows
        start_date = datetime.now()
        print(f"🗑️  Clearing existing shows from {start_date.date()}...")
        clear_existing_shows(conn, start_date)
        
        # Generate shows for each day
        total_shows = 0
        for day_offset in range(days_ahead):
            target_date = start_date + timedelta(days=day_offset)
            print(f"📅 Generating shows for {target_date.strftime('%Y-%m-%d %A')}...")
            
            shows = generate_shows_for_date(movies, theatres, target_date)
            insert_shows(conn, shows)
            total_shows += len(shows)
            
            # Commit after each day
            conn.commit()
        
        print("\n" + "=" * 50)
        print(f"✅ Successfully generated {total_shows} shows!")
        print(f"📊 Shows per day (average): {total_shows // days_ahead}")
        print(f"🎭 Movies covered: {len(movies)}")
        print(f"🏢 Theatres covered: {len(theatres)}")
        
        # Show some sample data
        print("\n🎪 Sample shows for today:")
        with conn.cursor() as cur:
            cur.execute("""
                SELECT m.title, t.name, s.start_time, s.price, s.status
                FROM shows s
                JOIN movies m ON s.movie_id = m.movie_id
                JOIN theatres t ON s.theatre_id = t.theatre_id
                WHERE DATE(s.start_time) = CURRENT_DATE
                ORDER BY s.start_time
                LIMIT 5
            """)
            
            for show in cur.fetchall():
                print(f"  • {show['title']} at {show['name']} - {show['start_time'].strftime('%I:%M %p')} - ₹{show['price']} ({show['status']})")
    
    except Exception as e:
        print(f"❌ Error: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()

if __name__ == "__main__":
    main()