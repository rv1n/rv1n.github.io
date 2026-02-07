"""
Миграция для добавления поля asset_type в таблицу portfolio
"""
import sqlite3
import sys

# Настройка кодировки для Windows
sys.stdout.reconfigure(encoding='utf-8')

def migrate():
    conn = sqlite3.connect('portfolio.db')
    cursor = conn.cursor()
    
    try:
        # Проверяем, существует ли уже колонка asset_type
        cursor.execute("PRAGMA table_info(portfolio)")
        columns = [column[1] for column in cursor.fetchall()]
        
        if 'asset_type' not in columns:
            print("Добавление колонки asset_type в таблицу portfolio...")
            cursor.execute("ALTER TABLE portfolio ADD COLUMN asset_type VARCHAR(100)")
            conn.commit()
            print("✅ Колонка asset_type успешно добавлена")
        else:
            print("✅ Колонка asset_type уже существует")
        
        # Создаем таблицу asset_types, если её нет
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS asset_types (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(100) NOT NULL UNIQUE,
                date_created DATETIME
            )
        """)
        conn.commit()
        print("✅ Таблица asset_types создана/проверена")
        
    except Exception as e:
        print(f"❌ Ошибка миграции: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == '__main__':
    migrate()
