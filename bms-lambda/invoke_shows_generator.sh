#!/bin/bash

# Script to invoke the Shows Generator Lambda function
# Usage: ./invoke_shows_generator.sh [days]
# Example: ./invoke_shows_generator.sh 7

DAYS=${1:-7}
FUNCTION_NAME="bms-shows-generator"
REGION="ap-south-1"

echo "Invoking Shows Generator function with $DAYS days..."
echo "Function: $FUNCTION_NAME"
echo "Region: $REGION"
echo ""

# Create the payload
PAYLOAD=$(cat << EOF
{
  "queryStringParameters": {
    "days": "$DAYS"
  }
}
EOF
)

# Invoke the function
aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --payload "$PAYLOAD" \
  --cli-binary-format raw-in-base64-out \
  response.json

echo ""
echo "Response from Lambda function:"
cat response.json | jq '.'

echo ""
echo "Done!"