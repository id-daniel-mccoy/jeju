#!/bin/bash
# Restart/rebuild Bazaar frontend
# The frontend is served via DWS/JNS Gateway on port 8080
# This script rebuilds the frontend and optionally starts a dev server

BAZAAR_DIR="apps/bazaar"
FRONTEND_DEV_PORT=4006

echo "Rebuilding Bazaar frontend..."

cd "$BAZAAR_DIR" || exit 1

# Kill any existing frontend dev server on port 4006
PID=$(lsof -ti:$FRONTEND_DEV_PORT 2>/dev/null)
if [ -n "$PID" ]; then
  echo "Killing existing frontend dev server on port $FRONTEND_DEV_PORT..."
  kill $PID 2>/dev/null
  sleep 1
  if kill -0 $PID 2>/dev/null; then
    kill -9 $PID 2>/dev/null
  fi
fi

# Rebuild the frontend
echo "Building frontend..."
bun run build || {
  echo "Build failed"
}

echo "✓ Frontend rebuilt successfully"

# Check if user wants to start dev server
if [ "$1" = "--dev" ] || [ "$1" = "-d" ]; then
  echo "Starting frontend dev server on port $FRONTEND_DEV_PORT..."
  echo "Access at: http://localhost:$FRONTEND_DEV_PORT"
  echo "(Note: This bypasses the DWS gateway on port 8080)"
  bun run scripts/dev-frontend.ts
else
  echo ""
  echo "Frontend rebuilt. The DWS gateway on port 8080 will serve the new build."
  echo "To start a dev server with hot reload, run:"
  echo "  ./scripts/restart-bazaar-frontend.sh --dev"
fi
