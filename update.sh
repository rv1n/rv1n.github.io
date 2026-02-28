#!/bin/bash
# =============================================================
# Скрипт обновления приложения из git
# Запускать: bash /var/www/portfolio/update.sh
# =============================================================
set -e

APP_DIR="/var/www/portfolio"
SERVICE_NAME="portfolio"

echo "=== [1/4] Получение изменений из git ==="
git -C "$APP_DIR" pull

echo "=== [2/4] Обновление зависимостей ==="
"$APP_DIR/venv/bin/pip" install -r "$APP_DIR/requirements.txt" --quiet

echo "=== [3/4] Перезапуск сервиса ==="
systemctl restart "$SERVICE_NAME"
sleep 2
systemctl status "$SERVICE_NAME" --no-pager

echo ""
echo "=== Обновление завершено ==="
