#!/bin/bash
# Run bun run dev and capture all logs to devlog.txt
# Logs are displayed in console AND saved to file
# File is overwritten on each run

# Ensure we're in the project root
cd "$(dirname "$0")"

# Remove old log file to start fresh
rm -f devlog.txt

# Run dev server and capture all output (stdout + stderr) to both console and file
# Using unbuffered output to ensure logs are written immediately
bun run dev 2>&1 | tee devlog.txt

# Note: When you kill the process (Ctrl+C), tee will flush buffers and save remaining logs
