"""
Миграция для добавления поля instrument_type в таблицы
"""
import sqlite3
from datetime import datetime

def migrate():
    """Добавляет поле instrument_type в существующие таблицы"""
    conn = sqlite3.connect('portfolio.db')
    cursor = conn.cursor()
    
    print("Nachalo migracii...")
    
    try:
        # Проверяем, существует ли уже колонка instrument_type в portfolio
        cursor.execute("PRAGMA table_info(portfolio)")
        columns = [col[1] for col in cursor.fetchall()]
        
        if 'instrument_type' not in columns:
            print("Dobavlenie instrument_type v tablicu portfolio...")
            cursor.execute("""
                ALTER TABLE portfolio 
                ADD COLUMN instrument_type TEXT DEFAULT 'STOCK'
            """)
            print("[OK] Kolonka instrument_type dobavlena v portfolio")
        else:
            print("[OK] Kolonka instrument_type uzhe suschestvuet v portfolio")
        
        # Проверяем таблицу transactions
        cursor.execute("PRAGMA table_info(transactions)")
        columns = [col[1] for col in cursor.fetchall()]
        
        if 'instrument_type' not in columns:
            print("Dobavlenie instrument_type v tablicu transactions...")
            cursor.execute("""
                ALTER TABLE transactions 
                ADD COLUMN instrument_type TEXT DEFAULT 'STOCK'
            """)
            print("[OK] Kolonka instrument_type dobavlena v transactions")
        else:
            print("[OK] Kolonka instrument_type uzhe suschestvuet v transactions")
        
        # Проверяем таблицу price_history
        cursor.execute("PRAGMA table_info(price_history)")
        columns = [col[1] for col in cursor.fetchall()]
        
        if 'instrument_type' not in columns:
            print("Dobavlenie instrument_type v tablicu price_history...")
            cursor.execute("""
                ALTER TABLE price_history 
                ADD COLUMN instrument_type TEXT DEFAULT 'STOCK'
            """)
            print("[OK] Kolonka instrument_type dobavlena v price_history")
        else:
            print("[OK] Kolonka instrument_type uzhe suschestvuet v price_history")
        
        conn.commit()
        print("\n[SUCCESS] Migracija uspeshno zavershena!")
        
    except Exception as e:
        conn.rollback()
        print(f"\n[ERROR] Oshibka migracii: {e}")
        raise
    finally:
        conn.close()

if __name__ == '__main__':
    migrate()
