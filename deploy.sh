#!/bin/bash
# =============================================================
# Скрипт первоначального развёртывания Portfolio Tracker
# Запускать от root на чистом Ubuntu/Debian VPS: bash deploy.sh
# =============================================================
set -e

# ---- Настройки (отредактируйте перед запуском) ----
GIT_REPO="https://github.com/rv1n/rv1n.github.io.git"
APP_DIR="/var/www/portfolio"
LOG_DIR="/var/log/portfolio"
DATA_DIR="$APP_DIR/data"
APP_USER="www-data"
SERVICE_NAME="portfolio"
# ---------------------------------------------------

echo "=== [1/8] Обновление пакетов ==="
if command -v apt &>/dev/null; then
    apt update -y
    apt install -y python3 python3-pip python3-venv nginx git
elif command -v dnf &>/dev/null; then
    dnf install -y python3 python3-pip nginx git
elif command -v yum &>/dev/null; then
    yum install -y python3 python3-pip nginx git
elif command -v pacman &>/dev/null; then
    pacman -Sy --noconfirm python python-pip nginx git
else
    echo "ОШИБКА: неизвестный менеджер пакетов. Установите вручную: python3, pip, nginx, git"
    exit 1
fi

# python3-venv может отсутствовать как отдельный пакет (в не-Debian системах venv встроен)
python3 -m venv --version &>/dev/null || true

echo "=== [2/8] Клонирование репозитория ==="
if [ -d "$APP_DIR/.git" ]; then
    echo "Репозиторий уже существует, выполняю git pull..."
    git -C "$APP_DIR" pull
else
    git clone "$GIT_REPO" "$APP_DIR"
fi

echo "=== [3/8] Создание директорий ==="
mkdir -p "$LOG_DIR" "$DATA_DIR"

echo "=== [4/8] Виртуальное окружение и зависимости ==="
python3 -m venv "$APP_DIR/venv"
"$APP_DIR/venv/bin/pip" install --upgrade pip
"$APP_DIR/venv/bin/pip" install -r "$APP_DIR/requirements.txt"
"$APP_DIR/venv/bin/pip" install gunicorn

echo "=== [5/8] Генерация SECRET_KEY (если не задан) ==="
ENV_FILE="/etc/portfolio.env"
if [ ! -f "$ENV_FILE" ]; then
    SECRET=$("$APP_DIR/venv/bin/python" -c "import secrets; print(secrets.token_hex(32))")
    echo "SECRET_KEY=$SECRET" > "$ENV_FILE"
    echo "DATABASE_URL=sqlite:////var/www/portfolio/data/portfolio.db" >> "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    echo "  -> Создан $ENV_FILE с новым ключом"
else
    echo "  -> $ENV_FILE уже существует, пропускаю"
fi

echo "=== [6/8] Настройка прав доступа ==="
chown -R "$APP_USER":"$APP_USER" "$APP_DIR" "$LOG_DIR"
chmod -R 755 "$APP_DIR"
chmod 700 "$DATA_DIR"

echo "=== [7/8] Установка systemd-сервиса ==="
cp "$APP_DIR/portfolio.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
sleep 2
systemctl status "$SERVICE_NAME" --no-pager

echo "=== [8/8] Настройка nginx ==="
cp "$APP_DIR/nginx.conf" "/etc/nginx/sites-available/$SERVICE_NAME"
ln -sf "/etc/nginx/sites-available/$SERVICE_NAME" \
       "/etc/nginx/sites-enabled/$SERVICE_NAME"
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

echo ""
echo "=============================================="
echo "  Развёртывание завершено!"
echo "  Приложение: http://$(curl -s ifconfig.me)"
echo ""
echo "  Для обновления из git: bash $APP_DIR/update.sh"
echo "  Логи: journalctl -u $SERVICE_NAME -f"
echo "=============================================="
