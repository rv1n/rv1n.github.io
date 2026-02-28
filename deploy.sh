#!/bin/bash
# =============================================================
# Скрипт развёртывания для shared hosting (без root)
# Запускать: bash deploy.sh
# =============================================================
set -e

APP_DIR="$(pwd)"
GIT_REPO="https://github.com/rv1n/rv1n.github.io.git"

echo "=== [1/5] Проверка Python ==="
PYTHON=""
for cmd in python3.11 python3.10 python3.9 python3 python; do
    if command -v $cmd &>/dev/null; then
        VER=$($cmd -c "import sys; print(sys.version_info[:2])")
        echo "  Найден: $cmd ($VER)"
        PYTHON=$cmd
        break
    fi
done

if [ -z "$PYTHON" ]; then
    echo "ОШИБКА: Python 3 не найден!"
    exit 1
fi

echo "=== [2/5] Клонирование / обновление репозитория ==="
if [ -d ".git" ]; then
    echo "  Уже в репозитории, выполняю git pull..."
    git pull
elif [ -d "rv1n.github.io/.git" ]; then
    echo "  Репозиторий уже скачан, обновляю..."
    git -C rv1n.github.io pull
    cp -r rv1n.github.io/. .
else
    git clone "$GIT_REPO" _tmp_repo
    cp -r _tmp_repo/. .
    rm -rf _tmp_repo
fi

echo "=== [3/5] Создание виртуального окружения ==="
if [ ! -d "venv" ]; then
    $PYTHON -m venv venv
    echo "  venv создан"
else
    echo "  venv уже существует"
fi

echo "=== [4/5] Установка зависимостей ==="
venv/bin/pip install --upgrade pip --quiet
venv/bin/pip install -r requirements.txt --quiet
venv/bin/pip install gunicorn --quiet
echo "  Зависимости установлены"

echo "=== [5/5] Настройка окружения ==="
ENV_FILE=".env"
if [ ! -f "$ENV_FILE" ]; then
    SECRET=$(venv/bin/python -c "import secrets; print(secrets.token_hex(32))")
    echo "SECRET_KEY=$SECRET"      > "$ENV_FILE"
    echo "DATABASE_URL=sqlite:///$(pwd)/data/portfolio.db" >> "$ENV_FILE"
    mkdir -p data
    chmod 700 data
    echo "  Создан .env с SECRET_KEY"
else
    echo "  .env уже существует"
fi

echo ""
echo "=============================================="
echo "  Установка завершена!"
echo ""
echo "  Запуск приложения:"
echo "    bash start.sh"
echo ""
echo "  Остановка:"
echo "    bash stop.sh"
echo "=============================================="
