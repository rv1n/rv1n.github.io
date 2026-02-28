# Руководство по развёртыванию Flask-приложения

## Содержание
1. [Подготовка проекта](#1-подготовка-проекта)
2. [Shared-хостинг (ISPmanager + Passenger)](#2-shared-хостинг-ispmanager--passenger)
3. [Выделенный сервер (VPS/Dedicated)](#3-выделенный-сервер-vpsdedicated)
4. [HTTPS (Let's Encrypt)](#4-https-lets-encrypt)
5. [Cron — логирование цен](#5-cron--логирование-цен)
6. [Обновление приложения](#6-обновление-приложения)

---

## 1. Подготовка проекта

### requirements.txt
Убедитесь что все зависимости зафиксированы:
```bash
pip freeze > requirements.txt
```

### .gitignore
Не коммитьте чувствительные файлы:
```
.env
*.db
*.log
__pycache__/
venv/
*.pyc
tmp/
```

### Переменные окружения (.env)
Создайте `.env` файл (не в git) на сервере:
```
SECRET_KEY=ваш-секретный-ключ-минимум-32-символа
DATABASE_URL=sqlite:////абсолютный/путь/к/portfolio.db
```

Генерация SECRET_KEY:
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

---

## 2. Shared-хостинг (ISPmanager + Passenger)

### Требования к хостингу
- Python 3.9+ (через `/opt/alt/pythonXX/`)
- Apache + mod_passenger
- SSH-доступ
- ISPmanager

### Шаг 1 — Создание домена в ISPmanager
1. **WWW → WWW-домены → Создать**
2. Укажите домен
3. Запомните путь к `public_html` (webroot)

### Шаг 2 — Клонирование репозитория по SSH
```bash
# Войдите по SSH
ssh username@server

# Клонируйте проект в отдельную папку (НЕ в public_html)
cd /var/www/username/data/
git clone https://github.com/ваш/репозиторий.git myapp
cd myapp
```

### Шаг 3 — Создание виртуального окружения
```bash
# Используйте Python из /opt/alt/ если системный Python старый
/opt/alt/python311/bin/python3 -m venv venv

# Если нет ensurepip:
/opt/alt/python311/bin/python3 -m venv venv --without-pip
curl https://bootstrap.pypa.io/get-pip.py | venv/bin/python3

# Установка зависимостей
venv/bin/pip install -r requirements.txt
```

### Шаг 4 — Файл .env на сервере
```bash
cat > /var/www/username/data/myapp/.env << 'EOF'
SECRET_KEY=ваш-секретный-ключ
DATABASE_URL=sqlite:////var/www/username/data/myapp/portfolio.db
EOF
```

### Шаг 5 — Создание wsgi.py в папке проекта
```bash
cat > /var/www/username/data/myapp/wsgi.py << 'EOF'
import sys, os

APP_DIR = '/var/www/username/data/myapp'
os.chdir(APP_DIR)
sys.path.insert(0, APP_DIR)

# Явно задаём абсолютный путь к базе данных
os.environ['DATABASE_URL'] = 'sqlite:////' + APP_DIR + '/portfolio.db'

# Загружаем остальные переменные из .env
env_file = APP_DIR + '/.env'
if os.path.exists(env_file):
    for line in open(env_file):
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            if k.strip() != 'DATABASE_URL':
                os.environ[k.strip()] = v.strip()

from app import app, start_scheduler
start_scheduler()  # Запускаем планировщик при старте

application = app
EOF
```

### Шаг 6 — .htaccess в корне сайта (public_html)
```bash
cat > /var/www/username/data/www/domain.ru/.htaccess << 'EOF'
# Разрешаем Let's Encrypt проверку напрямую
RewriteEngine On
RewriteCond %{REQUEST_URI} ^/.well-known/
RewriteRule ^ - [L]

PassengerEnabled on
PassengerAppRoot /var/www/username/data/myapp
PassengerPython /var/www/username/data/myapp/venv/bin/python3
PassengerAppType wsgi
PassengerStartupFile wsgi.py
PassengerBaseURI /
EOF
```

> **Важно:** `PassengerAppRoot` — папка с проектом (где лежит `wsgi.py`),  
> а НЕ `public_html` сайта.

### Шаг 7 — Папка для перезапуска
```bash
mkdir -p /var/www/username/data/myapp/tmp
touch /var/www/username/data/myapp/tmp/restart.txt
```

### Шаг 8 — Проверка
Откройте домен в браузере. Если 500 ошибка — смотрите логи:
```bash
tail -50 /var/www/username/data/logs/error.log
# или
find /var/www/username -name "error.log" | xargs tail -20
```

### Перезапуск Passenger
```bash
touch /var/www/username/data/myapp/tmp/restart.txt
```
Passenger перезапустит приложение при следующем запросе.

---

## 3. Выделенный сервер (VPS/Dedicated)

### Требования
- Ubuntu 22.04 / Debian 12
- Root-доступ по SSH
- Nginx
- Python 3.10+

### Шаг 1 — Обновление системы и установка зависимостей
```bash
apt update && apt upgrade -y
apt install -y python3 python3-pip python3-venv nginx git
```

### Шаг 2 — Создание пользователя и папки
```bash
useradd -m -s /bin/bash appuser
mkdir -p /var/www/myapp
chown appuser:appuser /var/www/myapp
```

### Шаг 3 — Клонирование и настройка
```bash
su - appuser
cd /var/www/myapp
git clone https://github.com/ваш/репозиторий.git .

python3 -m venv venv
venv/bin/pip install -r requirements.txt
venv/bin/pip install gunicorn
```

### Шаг 4 — Переменные окружения
```bash
# Создаём файл с переменными (читается systemd)
cat > /etc/myapp.env << 'EOF'
SECRET_KEY=ваш-секретный-ключ
DATABASE_URL=sqlite:////var/www/myapp/portfolio.db
EOF
chmod 600 /etc/myapp.env
```

### Шаг 5 — Systemd-сервис
```bash
cat > /etc/systemd/system/myapp.service << 'EOF'
[Unit]
Description=Flask Portfolio App
After=network.target

[Service]
User=appuser
Group=appuser
WorkingDirectory=/var/www/myapp
EnvironmentFile=/etc/myapp.env
ExecStart=/var/www/myapp/venv/bin/gunicorn \
    --workers 1 \
    --threads 4 \
    --bind 127.0.0.1:5000 \
    --timeout 120 \
    --access-logfile /var/log/myapp/access.log \
    --error-logfile /var/log/myapp/error.log \
    app:app
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Папка для логов
mkdir -p /var/log/myapp
chown appuser:appuser /var/log/myapp

# Запуск
systemctl daemon-reload
systemctl enable myapp
systemctl start myapp
systemctl status myapp
```

> **Важно:** `--workers 1` обязательно если используется APScheduler —
> иначе планировщик запустится в каждом worker'е и будет дублировать задачи.

### Шаг 6 — Nginx
```bash
cat > /etc/nginx/sites-available/myapp << 'EOF'
server {
    listen 80;
    server_name domain.ru www.domain.ru;

    # Статические файлы отдаём напрямую (быстрее)
    location /static/ {
        alias /var/www/myapp/static/;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # Let's Encrypt verification
    location /.well-known/ {
        root /var/www/myapp;
    }

    # Всё остальное — в Gunicorn
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_connect_timeout 10s;
    }

    client_max_body_size 10M;
}
EOF

ln -s /etc/nginx/sites-available/myapp /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### Шаг 7 — HTTPS на VPS (Certbot)
```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d domain.ru -d www.domain.ru
# Certbot автоматически обновит nginx.conf и настроит редирект
```

Автопродление сертификата (добавляется автоматически):
```bash
certbot renew --dry-run  # проверка
```

---

## 4. HTTPS (Let's Encrypt)

### Shared-хостинг (ISPmanager)
1. **SSL-сертификаты → Создать → Let's Encrypt**
2. Выберите домен, нажмите **Ok**
3. **WWW-домены → домен → Изменить**
4. Выберите созданный сертификат
5. Поставьте галочку **"Перенаправлять HTTP → HTTPS"**

> Если сертификат не выдаётся — убедитесь что в `.htaccess` есть исключение  
> для `/.well-known/` (см. Шаг 6 выше).

### VPS
```bash
certbot --nginx -d domain.ru
```

---

## 5. Cron — логирование цен

### Standalone-скрипт (для shared-хостинга)
```bash
cat > /var/www/username/data/myapp/run_price_logger.py << 'EOF'
import sys, os

APP_DIR = '/var/www/username/data/myapp'
sys.path.insert(0, APP_DIR)
os.chdir(APP_DIR)

os.environ['DATABASE_URL'] = 'sqlite:////' + APP_DIR + '/portfolio.db'

env_file = APP_DIR + '/.env'
if os.path.exists(env_file):
    for line in open(env_file):
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            if k.strip() != 'DATABASE_URL':
                os.environ[k.strip()] = v.strip()

from services.moex_service import MOEXService
from services.price_logger import PriceLogger

moex = MOEXService()
logger = PriceLogger(moex)
logger.log_all_prices(force=False)
EOF

chmod +x /var/www/username/data/myapp/run_price_logger.py
```

### Добавление в ISPmanager (Планировщик)
- **Команда:** `/var/www/username/data/myapp/venv/bin/python3 /var/www/username/data/myapp/run_price_logger.py`
- Режим: **экспертный**
- Минуты: `0` | Часы: `6,12,17,21` | Остальное: `*`

### Добавление в системный cron (VPS)
```bash
crontab -e -u appuser
# Добавить строку:
0 6,12,17,21 * * * /var/www/myapp/venv/bin/python3 /var/www/myapp/run_price_logger.py >> /var/log/myapp/cron.log 2>&1
```

---

## 6. Обновление приложения

### update.sh (уже в репозитории)
```bash
cd /var/www/username/data/myapp && bash update.sh
```

Скрипт выполняет:
1. `git pull` — получает изменения с GitHub
2. `pip install -r requirements.txt` — устанавливает новые зависимости
3. Перезапускает приложение

### Полный процесс обновления

**На локальной машине:**
```bash
git add .
git commit -m "описание изменений"
git push
```

**На сервере (shared-хостинг):**
```bash
cd /var/www/username/data/myapp && bash update.sh
```

**На сервере (VPS):**
```bash
cd /var/www/myapp
git pull
venv/bin/pip install -r requirements.txt -q
systemctl restart myapp
```

### Если изменилась структура БД
```bash
# Сделать бэкап перед миграцией!
cp portfolio.db portfolio.db.backup

# Применить изменения (если используется Flask-Migrate)
venv/bin/flask db upgrade

# Или пересоздать таблицы (если нет миграций)
venv/bin/python3 -c "from models.database import Base, engine; Base.metadata.create_all(engine)"
```

---

## Частые проблемы

| Проблема | Причина | Решение |
|----------|---------|---------|
| `ModuleNotFoundError` | Используется не тот Python | Использовать `venv/bin/python3` |
| `sqlite3 unable to open database` | Относительный путь к БД | Задать абсолютный путь в `DATABASE_URL` |
| `500 Internal Server Error` | Ошибка в коде при старте | Смотреть логи Passenger/Nginx |
| `NET::ERR_CERT_AUTHORITY_INVALID` | Let's Encrypt не прошёл проверку | Добавить исключение `.well-known` в `.htaccess`, переиздать сертификат |
| Планировщик не работает | Passenger останавливает процесс | Использовать cron вместо APScheduler |
| `Address already in use` | Порт занят старым процессом | `kill $(lsof -t -i:5000)` или сменить порт |
