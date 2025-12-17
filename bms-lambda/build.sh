#!/bin/bash

# Build script for BMS Lambda functions
set -e

echo "Building BMS Lambda functions..."

# Clean previous builds
echo "Cleaning previous builds..."
rm -rf .aws-sam

# Build with SAM
echo "Building with SAM..."
sam build --use-container

echo "Build completed successfully!"
echo ""
echo "To deploy:"
echo "  1. Set your environment variables in samconfig.toml"
echo "  2. Run: sam deploy --guided (first time)"
echo "  3. Run: sam deploy (subsequent deployments)"
echo ""
echo "To test locally:"
echo "  sam local start-api --env-vars env.json"
echo ""