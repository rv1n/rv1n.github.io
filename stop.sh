#!/bin/bash
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$APP_DIR/app.pid"

if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
    kill $(cat "$PID_FILE")
    rm -f "$PID_FILE"
    echo "Приложение остановлено"
else
    echo "Приложение не запущено"
fi
