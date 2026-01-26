#!/bin/bash
# Kill all dev processes and free up ports
# This script is a wrapper around kill-all-ports.ts for convenience

echo "Killing all dev processes..."

# Use the comprehensive TypeScript script if available
if command -v bun &> /dev/null && [ -f "scripts/kill-all-ports.ts" ]; then
  echo "Using comprehensive port scanner..."
  bun scripts/kill-all-ports.ts --force
else
  echo "Falling back to basic port killing..."
  
  # Kill processes by port (legacy ports)
  for port in 4350 4352 4006 4030 4100 4301 4302 4337 4661; do
    pid=$(lsof -ti:$port 2>/dev/null)
    if [ -n "$pid" ]; then
      echo "Killing process on port $port (PID: $pid)"
      kill -9 $pid 2>/dev/null
    fi
  done
fi

# Kill bun dev processes
pkill -9 -f "bun.*dev" 2>/dev/null
pkill -9 -f "jeju.*dev" 2>/dev/null

# Kill indexer processes
pkill -9 -f "dev:graphql" 2>/dev/null
pkill -9 -f "dev:api" 2>/dev/null
pkill -9 -f "dev:processor" 2>/dev/null
pkill -9 -f "sqd serve" 2>/dev/null

echo "All dev processes killed"


