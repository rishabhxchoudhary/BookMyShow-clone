#!/bin/bash

# Fix all Python files with escaped newlines
cd /Users/rishabh/Desktop/bms_clone/bms-lambda

# Find all Python files and fix them
find . -name "*.py" -type f | while read file; do
    echo "Fixing $file..."
    # Replace literal \n with actual newlines
    sed -i '' 's/\\n/\n/g' "$file"
done

echo "All Python files fixed!"