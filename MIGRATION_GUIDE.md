# Руководство по выполнению миграций на сервере

## Подключение к серверу

```bash
ssh root@5.129.221.111
# или
ssh ваш_пользователь@5.129.221.111
```

## Переход в директорию проекта

```bash
cd /var/www/att1
```

## Вариант 1: Использование готового скрипта миграций

### Шаг 1: Загрузите скрипт на сервер

Если вы используете git:
```bash
cd /var/www/att1
git pull origin main  # или master, в зависимости от вашей ветки
```

Или скопируйте файл `migrate.py` на сервер через scp:
```bash
# С локального компьютера
scp migrate.py root@5.129.221.111:/var/www/att1/
```

### Шаг 2: Выполните миграцию

```bash
cd /var/www/att1
python3 migrate.py
```

### Шаг 3: Проверьте результат

Скрипт выведет информацию о выполненных миграциях. Если все колонки уже существуют, вы увидите:
```
[INFO] Все миграции уже применены. База данных актуальна.
```

## Вариант 2: Ручное выполнение SQL команд

Если скрипт недоступен, можно выполнить миграции вручную:

```bash
cd /var/www/att1
sqlite3 portfolio.db
```

Затем в интерактивной оболочке SQLite:

```sql
-- Проверка существующих колонок
PRAGMA table_info(portfolio);

-- Добавление колонки bond_facevalue (если её нет)
ALTER TABLE portfolio ADD COLUMN bond_facevalue REAL;

-- Добавление колонки bond_currency (если её нет)
ALTER TABLE portfolio ADD COLUMN bond_currency VARCHAR(10);

-- Проверка результата
PRAGMA table_info(portfolio);

-- Выход
.quit
```

## Вариант 3: Через Python напрямую

```bash
cd /var/www/att1
python3 -c "
import sqlite3
conn = sqlite3.connect('portfolio.db')
cursor = conn.cursor()

# Проверяем существующие колонки
cursor.execute('PRAGMA table_info(portfolio)')
columns = [row[1] for row in cursor.fetchall()]

if 'bond_facevalue' not in columns:
    cursor.execute('ALTER TABLE portfolio ADD COLUMN bond_facevalue REAL')
    print('Добавлена колонка bond_facevalue')

if 'bond_currency' not in columns:
    cursor.execute('ALTER TABLE portfolio ADD COLUMN bond_currency VARCHAR(10)')
    print('Добавлена колонка bond_currency')

conn.commit()
conn.close()
print('Миграция завершена')
"
```

## Проверка прав доступа

Убедитесь, что у пользователя, под которым запускается приложение (обычно `www-data`), есть права на запись в базу данных:

```bash
# Проверка прав
ls -la /var/www/att1/portfolio.db

# Если нужно изменить права
sudo chown www-data:www-data /var/www/att1/portfolio.db
sudo chmod 664 /var/www/att1/portfolio.db
```

## Резервное копирование перед миграцией

**ВАЖНО:** Перед выполнением миграций сделайте резервную копию базы данных:

```bash
cd /var/www/att1
cp portfolio.db portfolio.db.backup.$(date +%Y%m%d_%H%M%S)
```

## Восстановление из резервной копии (если что-то пошло не так)

```bash
cd /var/www/att1
cp portfolio.db.backup.20260216_120000 portfolio.db
```

## Автоматическое выполнение миграций при деплое

Можно добавить выполнение миграций в скрипт деплоя или в systemd service:

```bash
# В скрипте деплоя после git pull
cd /var/www/att1
python3 migrate.py
systemctl restart gunicorn  # или ваш сервис
```

## Проверка статуса миграций

После выполнения миграций проверьте структуру таблицы:

```bash
sqlite3 portfolio.db "PRAGMA table_info(portfolio);"
```

Должны быть видны колонки:
- `bond_facevalue` (REAL)
- `bond_currency` (VARCHAR(10))
