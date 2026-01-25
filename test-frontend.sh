#!/bin/bash
# Quick Frontend Test Script

echo "🧪 Testing Local Coffee Shop Frontend..."
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

FRONTEND_URL="http://localhost:8080"
BACKEND_URL="http://localhost:3000"

# Check if config.js exists
echo -n "1. Checking if config.js exists... "
if [ -f "public/config.js" ]; then
    echo -e "${GREEN}✓${NC}"
    cat public/config.js
else
    echo -e "${RED}✗${NC}"
    echo -e "${YELLOW}Config file not found!${NC}"
    echo "Generate it with: npm run build:config"
    exit 1
fi

echo ""

# Check if frontend server is running
echo -n "2. Checking if frontend server is running... "
if curl -s "${FRONTEND_URL}/html/index.html" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo -e "${YELLOW}Frontend server is not running!${NC}"
    echo "Start it with: npm run dev"
    exit 1
fi

# Check if backend is accessible
echo -n "3. Checking if backend is accessible... "
if curl -s "${BACKEND_URL}/api/v1/health" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo -e "${YELLOW}Backend server is not accessible!${NC}"
    echo "Make sure backend is running at ${BACKEND_URL}"
    echo "Start it with: cd ../localcoffeeshop-backend && npm run dev"
fi

# Test HTML files have config.js
echo -n "4. Checking HTML files have config.js script... "
MISSING=0
for file in public/html/*.html; do
    if ! grep -q 'config.js' "$file"; then
        echo -e "${RED}✗${NC}"
        echo "   Missing in: $(basename $file)"
        MISSING=1
    fi
done
if [ $MISSING -eq 0 ]; then
    echo -e "${GREEN}✓${NC}"
    echo "   All HTML files include config.js"
fi

# Check if critical files exist
echo -n "5. Checking critical files exist... "
FILES_OK=true
for file in "public/frontend.js" "public/constants.js" "public/asset-loader.js" "styles.css"; do
    if [ ! -f "$file" ]; then
        echo -e "${RED}✗${NC}"
        echo "   Missing: $file"
        FILES_OK=false
    fi
done
if [ "$FILES_OK" = true ]; then
    echo -e "${GREEN}✓${NC}"
fi

# Check environment file
echo -n "6. Checking .env file... "
if [ -f ".env" ]; then
    echo -e "${GREEN}✓${NC}"
    echo "   API_BASE_URL: $(grep API_BASE_URL .env | cut -d'=' -f2)"
    echo "   NODE_ENV: $(grep NODE_ENV .env | cut -d'=' -f2)"
else
    echo -e "${YELLOW}⚠${NC}"
    echo "   .env file not found (using defaults)"
    echo "   Create one with: cp .env.example .env"
fi

echo ""
echo -e "${GREEN}✅ Frontend checks complete!${NC}"
echo ""
echo "To test in browser:"
echo "1. Open: ${FRONTEND_URL}/html/index.html"
echo "2. Open DevTools Console (Cmd+Option+J / Ctrl+Shift+J)"
echo "3. Check for errors"
echo "4. Verify API calls go to: ${BACKEND_URL}/api/v1"
echo ""
echo "Manual tests:"
echo "- Search for coffee shops"
echo "- Click on a state (e.g., California)"
echo "- Apply price filters"
echo "- Check Network tab for API calls"
echo "- Check Console for window.APP_CONFIG"
