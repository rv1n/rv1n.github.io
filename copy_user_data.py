"""
Скрипт копирования данных портфеля от одного пользователя другому.
Использование: python3 copy_user_data.py <from_username> <to_username>
"""
import sys
import os

APP_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, APP_DIR)
os.chdir(APP_DIR)

db_url = os.environ.get('DATABASE_URL', f'sqlite:///{APP_DIR}/portfolio.db')
os.environ.setdefault('DATABASE_URL', db_url)

env_file = os.path.join(APP_DIR, '.env')
if os.path.exists(env_file):
    for line in open(env_file):
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

from models.database import db_session
from models.user import User
from models.portfolio import Portfolio
from models.transaction import Transaction
from models.cash_balance import CashBalance

def copy_user_data(from_username: str, to_username: str):
    src = db_session.query(User).filter_by(username=from_username).first()
    if not src:
        print(f"Пользователь '{from_username}' не найден.")
        return

    dst = db_session.query(User).filter_by(username=to_username).first()
    if not dst:
        print(f"Пользователь '{to_username}' не найден.")
        return

    # --- Портфель ---
    src_portfolio = db_session.query(Portfolio).filter_by(user_id=src.id).all()
    copied_portfolio = 0
    skipped_portfolio = 0
    for item in src_portfolio:
        exists = db_session.query(Portfolio).filter_by(
            ticker=item.ticker, user_id=dst.id
        ).first()
        if exists:
            skipped_portfolio += 1
            continue
        new_item = Portfolio(
            ticker=item.ticker,
            user_id=dst.id,
            company_name=item.company_name,
            quantity=item.quantity,
            average_buy_price=item.average_buy_price,
            category=item.category,
            asset_type=item.asset_type,
            instrument_type=item.instrument_type,
            bond_facevalue=item.bond_facevalue,
            bond_currency=item.bond_currency,
            current_price=item.current_price,
            current_price_updated_at=item.current_price_updated_at,
            lotsize=item.lotsize,
            date_added=item.date_added,
        )
        db_session.add(new_item)
        copied_portfolio += 1

    # --- Транзакции ---
    src_transactions = db_session.query(Transaction).filter_by(user_id=src.id).all()
    copied_tx = 0
    for tx in src_transactions:
        new_tx = Transaction(
            user_id=dst.id,
            date=tx.date,
            ticker=tx.ticker,
            company_name=tx.company_name,
            operation_type=tx.operation_type,
            price=tx.price,
            quantity=tx.quantity,
            total=tx.total,
            instrument_type=tx.instrument_type,
            notes=tx.notes,
        )
        db_session.add(new_tx)
        copied_tx += 1

    # --- Денежный баланс ---
    src_cash = db_session.query(CashBalance).filter_by(user_id=src.id).first()
    dst_cash = db_session.query(CashBalance).filter_by(user_id=dst.id).first()
    if src_cash:
        if dst_cash:
            dst_cash.balance = src_cash.balance
        else:
            db_session.add(CashBalance(user_id=dst.id, balance=src_cash.balance))

    db_session.commit()

    print(f"\nГотово! Скопировано из '{from_username}' → '{to_username}':")
    print(f"  Позиции в портфеле: {copied_portfolio} (пропущено дублей: {skipped_portfolio})")
    print(f"  Транзакции:         {copied_tx}")
    print(f"  Денежный баланс:    {src_cash.balance if src_cash else 0} ₽")


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print("Использование: python3 copy_user_data.py <from_username> <to_username>")
        print("Пример:        python3 copy_user_data.py admin dev")
        sys.exit(1)

    copy_user_data(sys.argv[1], sys.argv[2])
