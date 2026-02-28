#!/bin/bash
# Запуск приложения на shared hosting
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$APP_DIR/app.pid"
LOG_FILE="$APP_DIR/app.log"

# Загрузить переменные окружения из .env
if [ -f "$APP_DIR/.env" ]; then
    export $(grep -v '^#' "$APP_DIR/.env" | xargs)
fi

# Проверить, не запущено ли уже
if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
    echo "Приложение уже запущено (PID: $(cat $PID_FILE))"
    exit 0
fi

echo "Запуск приложения..."
cd "$APP_DIR"
nohup venv/bin/gunicorn \
    --workers 1 \
    --threads 4 \
    --bind 0.0.0.0:8000 \
    --timeout 120 \
    --access-logfile "$LOG_FILE" \
    --error-logfile "$LOG_FILE" \
    --pid "$PID_FILE" \
    --daemon \
    app:app

sleep 2
if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
    echo "Запущено успешно (PID: $(cat $PID_FILE))"
    echo "Логи: tail -f $LOG_FILE"
else
    echo "ОШИБКА: приложение не запустилось. Смотрите $LOG_FILE"
fi
