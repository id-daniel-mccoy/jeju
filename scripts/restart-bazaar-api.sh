#!/bin/bash
# Restart just the Bazaar API worker

BAZAAR_API_PORT=4007
BAZAAR_DIR="apps/bazaar"

echo "Killing Bazaar API worker on port $BAZAAR_API_PORT..."

# Find and kill the process on port 4007
PID=$(lsof -ti:$BAZAAR_API_PORT 2>/dev/null)
if [ -n "$PID" ]; then
  echo "Found process $PID, killing..."
  kill $PID 2>/dev/null
  sleep 1
  # Force kill if still running
  if kill -0 $PID 2>/dev/null; then
    echo "Force killing process $PID..."
    kill -9 $PID 2>/dev/null
  fi
  echo "Killed Bazaar API worker"
else
  echo "No process found on port $BAZAAR_API_PORT"
fi

# Wait a moment for port to be released
sleep 1

echo "Starting Bazaar API worker..."
cd "$BAZAAR_DIR" && bun run start:worker
