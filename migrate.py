"""
Универсальный скрипт для выполнения миграций базы данных
Использование: python migrate.py
"""
import sqlite3
from pathlib import Path
import sys

def check_column_exists(cursor, table_name, column_name):
    """Проверяет, существует ли колонка в таблице"""
    cursor.execute("PRAGMA table_info({})".format(table_name))
    columns = [row[1] for row in cursor.fetchall()]
    return column_name in columns

def migrate():
    """Выполняет все необходимые миграции"""
    db_path = Path('portfolio.db')
    
    if not db_path.exists():
        print("База данных не найдена. Создайте её сначала через init_db()")
        return False
    
    conn = sqlite3.connect(str(db_path))
    cursor = conn.cursor()
    
    migrations_applied = 0
    
    try:
        # Миграция 1: Добавление полей для облигаций (bond_facevalue, bond_currency)
        print("Проверка миграции: добавление полей для облигаций...")
        
        if not check_column_exists(cursor, 'portfolio', 'bond_facevalue'):
            print("  -> Добавляем колонку bond_facevalue...")
            cursor.execute("ALTER TABLE portfolio ADD COLUMN bond_facevalue REAL")
            migrations_applied += 1
            print("  [OK] Колонка bond_facevalue добавлена")
        else:
            print("  [OK] Колонка bond_facevalue уже существует")
        
        if not check_column_exists(cursor, 'portfolio', 'bond_currency'):
            print("  -> Добавляем колонку bond_currency...")
            cursor.execute("ALTER TABLE portfolio ADD COLUMN bond_currency VARCHAR(10)")
            migrations_applied += 1
            print("  [OK] Колонка bond_currency добавлена")
        else:
            print("  [OK] Колонка bond_currency уже существует")
        
        # Здесь можно добавить другие миграции в будущем
        # Пример:
        # if not check_column_exists(cursor, 'table_name', 'new_column'):
        #     cursor.execute("ALTER TABLE table_name ADD COLUMN new_column TYPE")
        #     migrations_applied += 1
        
        conn.commit()
        
        if migrations_applied > 0:
            print(f"\n[SUCCESS] Применено миграций: {migrations_applied}")
        else:
            print("\n[INFO] Все миграции уже применены. База данных актуальна.")
        
        return True
        
    except sqlite3.Error as e:
        conn.rollback()
        print(f"\n[ERROR] Ошибка при миграции: {e}")
        return False
    finally:
        conn.close()

if __name__ == '__main__':
    print("=" * 60)
    print("Выполнение миграций базы данных")
    print("=" * 60)
    print()
    
    success = migrate()
    
    print()
    print("=" * 60)
    
    if success:
        print("Миграции завершены успешно!")
        sys.exit(0)
    else:
        print("Ошибка при выполнении миграций!")
        sys.exit(1)
