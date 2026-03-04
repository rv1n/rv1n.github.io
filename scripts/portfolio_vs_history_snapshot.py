#!/usr/bin/env python3
"""
Вывести по каждому тикеру:
- текущую сумму в портфеле (по сохранённой в БД цене, без запросов к MOEX)
- последнюю цену из истории цен и сумму по этой цене (price_history * quantity).

Запуск из корня проекта:
  python scripts/portfolio_vs_history_snapshot.py
"""

import os
import sys
from collections import defaultdict

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(APP_DIR)
sys.path.insert(0, APP_DIR)

# Настраиваем DATABASE_URL так же, как в приложении
db_url = os.environ.get("DATABASE_URL", f"sqlite:///{APP_DIR}/portfolio.db")
os.environ.setdefault("DATABASE_URL", db_url)

from models.database import db_session, init_db  # type: ignore
from models.user import User  # type: ignore
from models.portfolio import Portfolio, InstrumentType  # type: ignore
from models.price_history import PriceHistory  # type: ignore
from services.currency_service import CurrencyService  # type: ignore


def fmt(x):
    if x is None:
        return "—"
    if isinstance(x, float):
        return f"{x:,.2f}".replace(",", " ")
    return str(x)


def main():
    init_db()

    users = db_session.query(User).all()
    if not users:
        print("Нет пользователей в БД.")
        return

    for user in users:
        portfolio_items = (
            db_session.query(Portfolio)
            .filter(Portfolio.user_id == user.id)
            .order_by(Portfolio.ticker)
            .all()
        )
        if not portfolio_items:
            continue

        print(f"\nПользователь: {user.username}")
        print(
            f'{"Тикер":<10} {"Кол-во":>10}  '
            f'{"Цена в портфеле":>16} {"Сумма в портфеле":>18}  |  '
            f'{"Цена из истории":>16} {"Дата":>10} {"Сумма по истории":>18}'
        )
        print("-" * 100)

        total_portfolio_sum = 0.0
        total_history_sum = 0.0
        currency_service = CurrencyService()

        # Кэш последних записей истории по тикерам
        tickers = [p.ticker.upper() for p in portfolio_items]
        latest_history = (
            db_session.query(PriceHistory)
            .filter(PriceHistory.ticker.in_(tickers))
            .order_by(PriceHistory.ticker, PriceHistory.logged_at.desc())
            .all()
        )
        hist_by_ticker = {}
        for h in latest_history:
            t = (h.ticker or "").upper()
            if t not in hist_by_ticker:
                hist_by_ticker[t] = h

        for item in portfolio_items:
            t = (item.ticker or "").upper()
            qty = item.quantity or 0
            is_bond = (
                getattr(item, "instrument_type", None) == InstrumentType.BOND
                or (isinstance(getattr(item, "instrument_type", None), str) and (item.instrument_type == "Облигация" or item.instrument_type == "BOND"))
                or ((item.ticker.startswith("RU") or item.ticker.startswith("SU")) and len(item.ticker) > 10)
            )
            face = getattr(item, "bond_facevalue", None) or 1000.0
            curr = (getattr(item, "bond_currency", None) or "SUR").strip() or "SUR"

            # Цена в портфеле: current_price или average_buy_price (для облигаций это % от номинала)
            price_raw = item.current_price if getattr(item, "current_price", None) else item.average_buy_price
            if price_raw is None:
                price_portfolio = None
                value_portfolio = None
            elif is_bond:
                price_nominal = (price_raw * face) / 100
                if curr not in ("SUR", "RUB"):
                    try:
                        fx = currency_service.get_rate_to_rub(curr)
                        fx = fx if fx and fx > 0 else 1.0
                    except Exception:
                        fx = 1.0
                else:
                    fx = 1.0
                price_portfolio = price_nominal * fx
                value_portfolio = qty * price_portfolio
            else:
                price_portfolio = price_raw
                value_portfolio = qty * price_raw

            # Последняя цена из истории (для облигаций в истории тоже %)
            hist = hist_by_ticker.get(t)
            if hist:
                price_hist_raw = hist.price
                date_hist = hist.logged_at.strftime("%Y-%m-%d")
            else:
                price_hist_raw = None
                date_hist = ""
            if price_hist_raw is None:
                price_hist = None
                value_hist = None
            elif is_bond:
                price_nominal_h = (price_hist_raw * face) / 100
                if curr not in ("SUR", "RUB"):
                    try:
                        fx = currency_service.get_rate_to_rub(curr)
                        fx = fx if fx and fx > 0 else 1.0
                    except Exception:
                        fx = 1.0
                else:
                    fx = 1.0
                price_hist = price_nominal_h * fx
                value_hist = qty * price_hist
            else:
                price_hist = price_hist_raw
                value_hist = qty * price_hist_raw

            if isinstance(value_portfolio, (int, float)):
                total_portfolio_sum += value_portfolio
            if isinstance(value_hist, (int, float)):
                total_history_sum += value_hist

            print(
                f"{t:<10} {fmt(qty):>10}  "
                f"{fmt(price_portfolio):>16} {fmt(value_portfolio):>18}  |  "
                f"{fmt(price_hist):>16} {date_hist:>10} {fmt(value_hist):>18}"
            )

        print("-" * 100)
        print(
            f'{"ИТОГО":<10} {"":>10}  '
            f'{"":>16} {fmt(total_portfolio_sum):>18}  |  '
            f'{"":>16} {"":>10} {fmt(total_history_sum):>18}'
        )

    db_session.remove()


if __name__ == "__main__":
    main()

