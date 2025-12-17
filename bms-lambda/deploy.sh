#!/bin/bash

# Deploy script for BMS Lambda functions
set -e

echo "Deploying BMS Lambda functions..."

# Check if samconfig.toml exists
if [ ! -f "samconfig.toml" ]; then
    echo "samconfig.toml not found. Running guided deployment..."
    sam deploy --guided
else
    echo "Using existing samconfig.toml..."
    sam deploy
fi

echo "Deployment completed!"
echo ""
echo "Your API Gateway endpoints:"
sam list endpoints --output table
echo ""
echo "To get API Gateway URL:"
echo "  aws cloudformation describe-stacks --stack-name <your-stack-name> --query 'Stacks[0].Outputs[?OutputKey==\`BMSApiEndpoint\`].OutputValue' --output text"