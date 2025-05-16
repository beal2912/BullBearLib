#!/usr/bin/env bash
# Mean Reversion (MR) Strategy Runner
# Usage:
#   ./run-mr.sh              # Default 30-min cadence
#   INTERVAL=900 ./run-mr.sh # Custom 15-min interval

# Default interval is 30 minutes (1800 seconds)
INTERVAL=${INTERVAL:-1800}

# Change to the root directory to ensure access to .env and lib files
cd "$(dirname "$0")/.."
ROOT_DIR=$(pwd)

echo "🔄 Starting Mean Reversion Strategy Runner (interval: ${INTERVAL}s)"
echo "📊 Press Ctrl+C to stop"
echo "📝 Started at: $(date)"

APP_CACHE_DIR="${ROOT_DIR}/cache"

# Create log directory
LOG_DIR="${ROOT_DIR}/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="${LOG_DIR}/mr-$(date +%Y%m%d).log"

echo "📋 Logging to: $LOG_FILE"

mkdir -p "$APP_CACHE_DIR"

run_strategy() {
  echo "▶️  [$(date)] Running Mean Reversion strategy..." | tee -a "$LOG_FILE"
  node "${ROOT_DIR}/strategies/meanReversion.js" --env-file .env --cache-dir "${APP_CACHE_DIR}" 2>&1 | tee -a "$LOG_FILE"
  local exit_code=${PIPESTATUS[0]}

  if [ $exit_code -ne 0 ]; then
    echo "❌ [$(date)] Strategy execution failed with exit code $exit_code" | tee -a "$LOG_FILE"
  else
    echo "✅ [$(date)] Strategy execution completed" | tee -a "$LOG_FILE"
  fi

  return $exit_code
}

while true; do
  run_strategy
  echo "⏳ [$(date)] Waiting ${INTERVAL} seconds until next run..." | tee -a "$LOG_FILE"
  sleep "$INTERVAL"
done
