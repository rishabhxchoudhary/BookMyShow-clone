#!/bin/bash

# Direct Lambda Invoke Script for Shows Generator
echo "🎬 Invoking Shows Generator Lambda Function..."

FUNCTION_NAME="bms-shows-generator"
REGION="ap-south-1"
DAYS=${1:-14}

# Create payload
PAYLOAD=$(cat <<EOF
{
  "queryStringParameters": {
    "days": "$DAYS"
  }
}
EOF
)

echo "📤 Invoking function: $FUNCTION_NAME"
echo "🌍 Region: $REGION"
echo "📅 Days ahead: $DAYS"

# Invoke Lambda function
aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --region "$REGION" \
  --payload "$PAYLOAD" \
  --cli-binary-format raw-in-base64-out \
  response.json

if [ $? -eq 0 ]; then
    echo "✅ Lambda function invoked successfully!"
    echo "📊 Response:"
    cat response.json | jq .
    rm response.json
else
    echo "❌ Failed to invoke Lambda function"
    exit 1
fi