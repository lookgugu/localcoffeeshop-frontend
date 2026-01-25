# Local Testing Guide - Frontend

## Quick Start

### 1. Install Dependencies
```bash
cd /Users/beno/Documents/Projects/localcoffeeshop-frontend
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
```

Edit `.env` for local development:
```bash
API_BASE_URL=http://localhost:3000/api/v1
GA_MEASUREMENT_ID=G-YVSXN7PM48
NODE_ENV=development
```

### 3. Build Configuration File
```bash
npm run build:config
```

This generates `public/config.js`:
```javascript
window.APP_CONFIG = {
    API_BASE_URL: 'http://localhost:3000/api/v1',
    GA_MEASUREMENT_ID: 'G-YVSXN7PM48',
    ENVIRONMENT: 'development'
};
```

### 4. Start Development Server
```bash
npm run dev
```

You should see:
```
Starting up http-server, serving public
Available on:
  http://127.0.0.1:8080
  http://192.168.1.x:8080
```

### 5. Open Browser
Navigate to: http://localhost:8080/html/index.html

## Testing Checklist

### ✅ Homepage (http://localhost:8080/html/index.html)
- [ ] Page loads without errors
- [ ] States list appears
- [ ] Search bar works
- [ ] No CORS errors in console
- [ ] Check DevTools Console for `window.APP_CONFIG`

### ✅ State Page (http://localhost:8080/html/state.html?code=CA)
- [ ] Coffee shops load for California
- [ ] Price filter works
- [ ] Meta tags show correct URL (check View Source)
- [ ] Network tab shows requests to `http://localhost:3000/api/v1`

### ✅ Search Functionality
- [ ] Type in search box
- [ ] Results appear after 300ms debounce
- [ ] Price filter applies correctly
- [ ] State filter works
- [ ] "Load more" pagination works

### ✅ Browser Console Checks
```javascript
// Open DevTools Console and check:

// 1. Config loaded
console.log(window.APP_CONFIG);
// Should show: { API_BASE_URL: "http://localhost:3000/api/v1", ... }

// 2. Check API calls
// Network tab should show requests to http://localhost:3000/api/v1/*
```

### ✅ Network Tab (Chrome DevTools)
Filter by "Fetch/XHR":
- [ ] `/api/v1/states` - Status 200
- [ ] `/api/v1/states/CA` - Status 200
- [ ] `/api/v1/search?q=...` - Status 200
- [ ] `/api/v1/config` - Status 200
- [ ] All requests have `Access-Control-Allow-Origin` header

### ✅ Service Worker
- [ ] Check Application tab → Service Workers
- [ ] Should register successfully
- [ ] Check for caching behavior

## Testing Different Pages

### About Page
```bash
# Open http://localhost:8080/html/about.html
```

### 404 Page
```bash
# Open http://localhost:8080/html/404.html
```

## Common Issues

### Config Not Loading
```bash
# Check config.js exists
ls -la public/config.js

# If missing, regenerate:
npm run build:config
```

### CORS Errors
**Error:** `Access to fetch at 'http://localhost:3000/api/v1/states' from origin 'http://localhost:8080' has been blocked by CORS policy`

**Solution:** Make sure backend is running with `CORS_ORIGIN=http://localhost:8080` in its `.env` file.

### 404 for Assets
**Error:** Failed to load `/config.js` or `/frontend.js`

**Solution:** Make sure you're accessing http://localhost:8080/html/index.html (not just http://localhost:8080)

### Backend Not Running
**Error:** `net::ERR_CONNECTION_REFUSED`

**Solution:** Start the backend server first:
```bash
cd ../localcoffeeshop-backend
npm run dev
```

## Full Integration Test

### Complete Workflow Test:
1. **Start Backend:**
   ```bash
   cd ../localcoffeeshop-backend
   npm run dev
   # Keep running in Terminal 1
   ```

2. **Start Frontend:**
   ```bash
   cd ../localcoffeeshop-frontend
   npm run dev
   # Keep running in Terminal 2
   ```

3. **Test in Browser:**
   - Open http://localhost:8080/html/index.html
   - Search for "coffee"
   - Click on "California" state
   - Verify coffee shops load
   - Apply price filter
   - Check browser console for errors

4. **Verify CORS:**
   ```bash
   # In Terminal 3
   curl -H "Origin: http://localhost:8080" \
        -H "Access-Control-Request-Method: GET" \
        -X OPTIONS \
        http://localhost:3000/api/v1/states
   ```

5. **Check Meta Tags:**
   - Visit http://localhost:8080/html/state.html?code=CA
   - View page source (Cmd+U or Ctrl+U)
   - Find `<meta property="og:url">`
   - Should show: `content="http://localhost:8080/html/state.html?code=CA"`

## Environment-Specific Behavior

### Development Mode (NODE_ENV=development)
- Uses unminified assets (`/frontend.js`, `/styles.css`)
- Verbose logging
- Pretty console output

### Production Mode (NODE_ENV=production)
- Uses minified assets (`/dist/app.min.js`, `/dist/styles.min.css`)
- Minimal logging
- Compressed responses

To test production mode locally:
```bash
# Build minified assets
npm run build

# Update .env
NODE_ENV=production

# Rebuild config
npm run build:config

# Start server
npm run dev
```

## Debugging Tips

### Enable Verbose Logging
```javascript
// In browser console
localStorage.setItem('debug', 'true');
// Reload page
```

### Monitor API Calls
```javascript
// In browser console
const originalFetch = window.fetch;
window.fetch = function(...args) {
    console.log('Fetch:', args[0]);
    return originalFetch.apply(this, args);
};
```

### Check Cache
```javascript
// In browser console (for state.js)
console.log(window.stateDataCache);
```

## Performance Testing

### Check Page Load Time
```bash
# Use Chrome DevTools → Performance tab
# Record page load
# Look for:
# - DOMContentLoaded: < 500ms
# - First Contentful Paint: < 1s
# - Largest Contentful Paint: < 2.5s
```

### Network Throttling
```bash
# Chrome DevTools → Network tab
# Throttle: "Fast 3G"
# Reload page
# Verify lazy loading works
```

## Success Indicators

✅ All tests pass when:
- No CORS errors in console
- States load on homepage
- State detail page shows coffee shops
- Search returns results
- Meta tags show correct URLs
- API calls go to http://localhost:3000
- Service worker registers
- No 404 errors for assets
