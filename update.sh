#!/bin/bash
# Обновление из git и перезапуск
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"

echo "=== [1/3] Получение изменений из git ==="
git pull

echo "=== [2/3] Обновление зависимостей ==="
venv/bin/pip install -r requirements.txt --quiet

echo "=== [3/3] Перезапуск ==="
bash stop.sh
sleep 1
bash start.sh
