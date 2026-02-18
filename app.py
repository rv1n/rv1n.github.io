"""
Главный файл Flask приложения для отслеживания котировок MOEX
"""
from flask import Flask, render_template, jsonify, request
from models.database import init_db, db_session
from models.portfolio import Portfolio, InstrumentType
from models.price_history import PriceHistory
from models.transaction import Transaction, TransactionType
from models.category import Category
from models.asset_type import AssetType
from models.cash_balance import CashBalance
from models.settings import Settings
from services.moex_service import MOEXService
from services.price_logger import PriceLogger
from services.currency_service import CurrencyService
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from datetime import datetime, timedelta
import atexit
import pytz
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here'

# Инициализация БД
init_db()

# Инициализация категорий при первом запуске
def init_categories():
    """Инициализация категорий при первом запуске"""
    from models.category import Category
    default_categories = [
        'Нефть и газ',
        'Электроэнергетика',
        'Телекоммуникации',
        'Металлы и добыча',
        'Финансовый сектор',
        'Потребительский сектор',
        'Химия и нефтехимия',
        'Информационные технологии (IT)',
        'Строительные компании и недвижимость',
        'Транспорт'
    ]
    
    for cat_name in default_categories:
        existing = db_session.query(Category).filter_by(name=cat_name).first()
        if not existing:
            new_category = Category(name=cat_name)
            db_session.add(new_category)
    
    db_session.commit()

init_categories()

# Инициализация баланса свободных денег
def init_cash_balance():
    """Инициализация баланса свободных денег (если еще не создан)"""
    balance = db_session.query(CashBalance).filter(CashBalance.id == 1).first()
    if not balance:
        balance = CashBalance(id=1, balance=0.0)
        db_session.add(balance)
        db_session.commit()

init_cash_balance()

# Инициализация сервисов
moex_service = MOEXService()
currency_service = CurrencyService()
price_logger = PriceLogger(moex_service)

# Инициализация планировщика задач
scheduler = BackgroundScheduler(timezone=pytz.timezone('Europe/Moscow'))

# Функции для работы с настройками времени логирования
def get_logging_time():
    """Получает время логирования из настроек (по умолчанию 00:00)"""
    try:
        settings = db_session.query(Settings).filter(Settings.id == 1).first()
        if settings:
            return settings.price_logging_hour, settings.price_logging_minute
    except Exception as e:
        print(f"[{datetime.now(pytz.timezone('Europe/Moscow'))}] Ошибка получения настроек: {e}")
    return 0, 0  # По умолчанию 00:00

def update_scheduler_time():
    """Обновляет время задачи планировщика из настроек"""
    hour, minute = get_logging_time()
    try:
        # Обновляем существующую задачу или создаем новую
        if scheduler.running:
            scheduler.reschedule_job(
                'daily_price_logging',
                trigger=CronTrigger(hour=hour, minute=minute, timezone='Europe/Moscow')
            )
            print(f"[{datetime.now(pytz.timezone('Europe/Moscow'))}] Время логирования обновлено: {hour:02d}:{minute:02d} МСК")
    except Exception as e:
        print(f"[{datetime.now(pytz.timezone('Europe/Moscow'))}] Ошибка обновления времени планировщика: {e}")

# Добавляем задачу логирования цен с настраиваемым временем
def setup_daily_logging_job():
    """Настраивает задачу ежедневного логирования с временем из настроек"""
    hour, minute = get_logging_time()
    scheduler.add_job(
        func=price_logger.log_all_prices,
        trigger=CronTrigger(hour=hour, minute=minute, timezone='Europe/Moscow'),
        id='daily_price_logging',
        name=f'Ежедневное логирование цен в {hour:02d}:{minute:02d} МСК',
        replace_existing=True
    )

setup_daily_logging_job()

# Добавляем периодическую проверку каждые 3 часа, если записи за сегодня нет
def check_and_log_prices():
    """Проверяет, есть ли записи за сегодня, и если нет - логирует цены"""
    from datetime import date, timedelta
    from models.price_history import PriceHistory
    
    now_moscow = datetime.now(pytz.timezone('Europe/Moscow'))

    # В установленное время отдельная задача daily_price_logging сама пишет цены.
    # Чтобы не было двойной записи, периодическая проверка в этот момент ничего не делает.
    logging_hour, logging_minute = get_logging_time()
    if now_moscow.hour == logging_hour and now_moscow.minute == logging_minute:
        print(f"[{now_moscow}] Периодическая проверка пропущена (сработает ежедневное логирование в {logging_hour:02d}:{logging_minute:02d})")
        return
    today_start = now_moscow.replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    
    # Проверяем, есть ли хотя бы одна запись за сегодня
    has_logs_today = db_session.query(PriceHistory).filter(
        PriceHistory.logged_at >= today_start,
        PriceHistory.logged_at < today_end
    ).first()
    
    if not has_logs_today:
        print(f"[{datetime.now(pytz.timezone('Europe/Moscow'))}] Записей за сегодня нет, выполняем логирование цен...")
        price_logger.log_all_prices(force=False)
    else:
        print(f"[{datetime.now(pytz.timezone('Europe/Moscow'))}] Записи за сегодня уже есть, пропускаем периодическое логирование")

scheduler.add_job(
    func=check_and_log_prices,
    trigger=CronTrigger(hour='*/3', minute=0, timezone='Europe/Moscow'),  # Каждые 3 часа
    id='periodic_price_logging',
    name='Периодическое логирование цен (каждые 3 часа, если записи нет)',
    replace_existing=True
)

import threading

# Функция для запуска планировщика (вызывается при первом запросе или при прямом запуске)
def start_scheduler():
    """Запускает планировщик задач, если он еще не запущен"""
    if scheduler.running:
        moscow_time = datetime.now(pytz.timezone('Europe/Moscow'))
        print(f"[{moscow_time}] Планировщик уже запущен, пропускаем повторный запуск")
        return
    
    try:
        moscow_time = datetime.now(pytz.timezone('Europe/Moscow'))
        print(f"[{moscow_time}] Запуск планировщика...")
        scheduler.start()
        hour, minute = get_logging_time()
        moscow_time = datetime.now(pytz.timezone('Europe/Moscow'))
        print(f"[{moscow_time}] ===== ПЛАНИРОВЩИК ЗАПУЩЕН =====")
        print(f"[{moscow_time}] Ежедневное логирование цен в {hour:02d}:{minute:02d} МСК")
        print(f"[{moscow_time}] Периодическая проверка каждые 3 часа (если записи за сегодня нет)")
        print(f"[{moscow_time}] Статус планировщика: {scheduler.running}")
        print(f"[{moscow_time}] Задач в планировщике: {len(scheduler.get_jobs())}")
        for job in scheduler.get_jobs():
            next_run = job.next_run_time.strftime('%Y-%m-%d %H:%M:%S %Z') if job.next_run_time else 'Не запланировано'
            print(f"[{moscow_time}]   - {job.name} (ID: {job.id}), следующее выполнение: {next_run}")
    except Exception as e:
        moscow_time = datetime.now(pytz.timezone('Europe/Moscow'))
        print(f"[{moscow_time}] ОШИБКА запуска планировщика: {e}")
        import traceback
        traceback.print_exc()

# Запускаем планировщик при первом запросе к приложению
# Это нужно для работы с Gunicorn, где if __name__ == '__main__' не выполняется
# Используем threading.Lock для предотвращения множественного запуска
_scheduler_lock = threading.Lock()

@app.before_request
def ensure_scheduler_running():
    """Убеждаемся, что планировщик запущен при первом запросе"""
    if not scheduler.running:
        with _scheduler_lock:
            if not scheduler.running:  # Двойная проверка
                start_scheduler()

@app.route('/')
def index():
    """Главная страница с портфелем"""
    return render_template('index.html')


@app.route('/api/portfolio', methods=['GET'])
def get_portfolio():
    """
    Получить весь портфель с актуальными ценами
    Средняя цена покупки рассчитывается из истории транзакций покупки
    """
    try:
        # Период для расчета изменения цены (в днях). Если не задан - используем "последние две записи".
        change_days = request.args.get('change_days', type=int)

        portfolio_items = db_session.query(Portfolio).all()
        result = []
        
        for item in portfolio_items:
            # Определяем тип инструмента
            instrument_type = item.instrument_type.name if hasattr(item, 'instrument_type') and item.instrument_type else 'STOCK'
            
            # Дополнительная проверка: если тикер облигации (начинается с RU или SU), но тип не определен
            if instrument_type == 'STOCK' and (item.ticker.startswith('RU') or item.ticker.startswith('SU')) and len(item.ticker) > 10:
                # Вероятно, это облигация (тикеры облигаций обычно длинные и начинаются с RU или SU)
                instrument_type = 'BOND'
            
            # Получаем актуальную цену с MOEX
            # Если для первого типа инструмента данных нет (например, тикер облигации помечен как STOCK),
            # пробуем альтернативный тип, чтобы гарантировать получение цены
            current_price_data = None
            types_to_try = [instrument_type]
            if instrument_type == 'STOCK':
                types_to_try.append('BOND')
            elif instrument_type == 'BOND':
                types_to_try.append('STOCK')
            
            for itype in types_to_try:
                current_price_data = moex_service.get_current_price(item.ticker, itype)
                if current_price_data:
                    break
            
            # Получаем информацию о размере лота
            lotsize = 1  # По умолчанию 1
            security_info = moex_service.get_security_info(item.ticker, instrument_type)
            if security_info and security_info.get('trading_params'):
                lotsize = security_info['trading_params'].get('lotsize', 1)
            
            # Получаем номинал и валюту для облигаций
            bond_facevalue = None
            bond_currency = None
            if instrument_type == 'BOND':
                # Используем сохраненные значения из базы, если есть
                if hasattr(item, 'bond_facevalue') and item.bond_facevalue:
                    bond_facevalue = item.bond_facevalue
                    bond_currency = item.bond_currency if hasattr(item, 'bond_currency') else 'SUR'
                # Если нет в базе, получаем из API
                elif current_price_data:
                    bond_facevalue = current_price_data.get('facevalue', 1000.0)
                    bond_currency = current_price_data.get('currency_id', 'SUR')
                    # Сохраняем в базу для будущего использования
                    item.bond_facevalue = bond_facevalue
                    item.bond_currency = bond_currency
                    db_session.commit()
                else:
                    bond_facevalue = 1000.0
                    bond_currency = 'SUR'
            
            if current_price_data:
                current_price = current_price_data.get('price', 0)
                last_update = current_price_data.get('last_update', '')
                # Обновляем номинал и валюту из API, если они есть
                if instrument_type == 'BOND' and current_price_data.get('facevalue'):
                    bond_facevalue = current_price_data.get('facevalue', bond_facevalue or 1000.0)
                    bond_currency = current_price_data.get('currency_id', bond_currency or 'SUR')
                    # Обновляем в базе, если изменились
                    if hasattr(item, 'bond_facevalue') and (item.bond_facevalue != bond_facevalue or item.bond_currency != bond_currency):
                        item.bond_facevalue = bond_facevalue
                        item.bond_currency = bond_currency
                        db_session.commit()
            else:
                # Если цена не получена, используем среднюю цену покупки как fallback
                current_price = item.average_buy_price if hasattr(item, 'average_buy_price') else 0
                last_update = ''
            
            # Вычисляем среднюю цену покупки из истории транзакций
            # Используем ту же логику, что и в recalculate_portfolio_for_ticker
            # Учитываем только те покупки, которые не были полностью проданы
            all_transactions = db_session.query(Transaction).filter(
                Transaction.ticker == item.ticker
            ).order_by(Transaction.date.asc()).all()
            
            # Применяем FIFO для определения релевантных покупок
            current_quantity = 0
            relevant_buy_transactions = []  # Кортежи (цена, оставшееся_количество)
            
            for trans in all_transactions:
                if trans.operation_type == TransactionType.BUY:
                    current_quantity += trans.quantity
                    if current_quantity - trans.quantity <= 0:
                        # Позиция была полностью продана, начинаем считать заново
                        relevant_buy_transactions = []
                    relevant_buy_transactions.append((trans.price, trans.quantity))
                elif trans.operation_type == TransactionType.SELL:
                    sell_quantity = trans.quantity
                    current_quantity -= sell_quantity
                    
                    # Удаляем покупки по FIFO
                    while sell_quantity > 0 and relevant_buy_transactions:
                        buy_price, buy_remaining = relevant_buy_transactions[0]
                        if buy_remaining <= sell_quantity:
                            sell_quantity -= buy_remaining
                            relevant_buy_transactions.pop(0)
                        else:
                            relevant_buy_transactions[0] = (buy_price, buy_remaining - sell_quantity)
                            sell_quantity = 0
                    
                    if current_quantity < 0:
                        current_quantity = 0
            
            # Рассчитываем среднюю цену из релевантных покупок
            # ВАЖНО: цены в транзакциях сохраняются как ввел пользователь (в рублях)
            # НЕ переводим цены из транзакций - они уже в рублях
            if relevant_buy_transactions:
                # Цены в транзакциях уже в рублях (как ввел пользователь)
                total_cost = sum(price * quantity for price, quantity in relevant_buy_transactions)
                total_buy_quantity = sum(quantity for _, quantity in relevant_buy_transactions)
                calculated_avg_price = total_cost / total_buy_quantity if total_buy_quantity > 0 else item.average_buy_price
            else:
                # Если нет релевантных транзакций, используем цену из портфеля
                calculated_avg_price = item.average_buy_price
            
            # Получаем данные истории цен для расчета изменения
            # Если задан change_days > 0 — берем цены за период и считаем изменение между
            # самой старой и самой новой записью. Иначе — между двумя последними записями.
            bond_nominal = bond_facevalue if bond_facevalue else 1000.0

            latest_price = None
            previous_price = None

            if change_days and change_days > 0:
                # Для периода считаем "окном" от последней сохраненной цены назад на N дней.
                # Это корректнее, чем от текущего времени, если логирование не каждый день.
                latest_entry = db_session.query(PriceHistory).filter(
                    PriceHistory.ticker == item.ticker
                ).order_by(PriceHistory.logged_at.desc()).first()

                if latest_entry:
                    end_time = latest_entry.logged_at
                    period_start = end_time - timedelta(days=change_days)

                    history_entries = db_session.query(PriceHistory).filter(
                        PriceHistory.ticker == item.ticker,
                        PriceHistory.logged_at >= period_start,
                        PriceHistory.logged_at <= end_time
                    ).order_by(PriceHistory.logged_at.asc()).all()

                    if len(history_entries) >= 2:
                        previous_price = history_entries[0].price
                        latest_price = history_entries[-1].price
                    elif len(history_entries) == 1:
                        # Только одна запись за период — считаем, что изменения нет
                        latest_price = history_entries[0].price
                        previous_price = history_entries[0].price
            else:
                last_two_entries = db_session.query(PriceHistory).filter(
                    PriceHistory.ticker == item.ticker
                ).order_by(PriceHistory.logged_at.desc()).limit(2).all()

                if len(last_two_entries) >= 2:
                    latest_price = last_two_entries[0].price
                    previous_price = last_two_entries[1].price
                elif len(last_two_entries) == 1:
                    latest_price = last_two_entries[0].price
                    previous_price = last_two_entries[0].price

            # Рассчитываем изменение: разница между предыдущей и последней ценой
            # Для облигаций цены в истории хранятся в процентах, для акций - в рублях
            if latest_price is not None and previous_price is not None:
                # Для облигаций переводим из процентов в рубли
                if instrument_type == 'BOND':
                    latest_price_rub = (latest_price * bond_nominal) / 100
                    previous_price_rub = (previous_price * bond_nominal) / 100
                    price_change = latest_price_rub - previous_price_rub
                    price_change_percent = (price_change / previous_price_rub * 100) if previous_price_rub > 0 else 0
                else:
                    price_change = latest_price - previous_price
                    price_change_percent = (price_change / previous_price * 100) if previous_price > 0 else 0
            else:
                price_change = 0
                price_change_percent = 0
            
            # Расчеты прибыли/убытка относительно ТЕКУЩЕЙ цены (с MOEX API)
            # Для облигаций цены с MOEX в процентах от номинала, сначала получаем цену в валюте номинала,
            # затем при необходимости переводим в рубли по курсу
            # calculated_avg_price из транзакций уже в рублях (как ввел пользователь)
            if instrument_type == 'BOND':
                # Цена одной облигации в валюте номинала (например, USD) = проценты * номинал / 100
                current_price_in_nominal_currency = (current_price * bond_nominal) / 100

                # Если номинал не в рублях, конвертируем в RUB по курсу
                if bond_currency and bond_currency != 'SUR' and bond_currency != 'RUB':
                    try:
                        fx_rate = currency_service.get_rate_to_rub(bond_currency)
                    except Exception:
                        fx_rate = 1.0
                else:
                    fx_rate = 1.0

                current_price_rub = current_price_in_nominal_currency * fx_rate

                # calculated_avg_price уже в рублях (как ввел пользователь при покупке)
                avg_price_rub = calculated_avg_price
            else:
                current_price_rub = current_price
                avg_price_rub = calculated_avg_price
            
            total_current_value = item.quantity * current_price_rub
            total_buy_cost = item.quantity * avg_price_rub
            profit_loss = total_current_value - total_buy_cost
            profit_loss_percent = ((current_price_rub - avg_price_rub) / avg_price_rub * 100) if avg_price_rub > 0 else 0
            
            # Для облигаций переводим price_change из процентов в рубли с учетом валюты номинала
            if instrument_type == 'BOND':
                # price_change здесь считается как разница цен (latest - previous) в валюте номинала,
                # умноженная на номинал и делённая на 100.
                price_change_in_nominal_currency = (price_change * bond_nominal) / 100
                if bond_currency and bond_currency != 'SUR' and bond_currency != 'RUB':
                    try:
                        fx_rate_change = currency_service.get_rate_to_rub(bond_currency)
                    except Exception:
                        fx_rate_change = 1.0
                else:
                    fx_rate_change = 1.0
                price_change_rub = price_change_in_nominal_currency * fx_rate_change
            else:
                price_change_rub = price_change
            
            # Рассчитываем количество лотов
            lots = item.quantity / lotsize if lotsize > 0 else item.quantity
            
            result_item = {
                'id': item.id,
                'ticker': item.ticker,
                'company_name': item.company_name,
                'category': item.category if hasattr(item, 'category') else None,
                'asset_type': item.asset_type if hasattr(item, 'asset_type') else None,
                'instrument_type': item.instrument_type.value if hasattr(item, 'instrument_type') and item.instrument_type else 'Акция',
                'quantity': item.quantity,  # Количество бумаг
                'lots': lots,  # Количество лотов
                'lotsize': lotsize,  # Размер лота
                'average_buy_price': avg_price_rub,  # уже в рублях для облигаций
                'current_price': current_price_rub,  # уже в рублях для облигаций
                'price_change': price_change_rub,  # уже в рублях для облигаций
                'price_change_percent': price_change_percent,
                'total_cost': total_current_value,  # стоимость по текущей цене
                'total_buy_cost': total_buy_cost,
                'profit_loss': profit_loss,
                'profit_loss_percent': profit_loss_percent,
                'last_update': last_update,
                'date_added': item.date_added.isoformat() if item.date_added else None
            }
            
            # Добавляем информацию о номинале и валюте для облигаций
            if instrument_type == 'BOND':
                result_item['bond_facevalue'] = bond_facevalue
                result_item['bond_currency'] = bond_currency
            
            result.append(result_item)
        
        # Общие расчеты портфеля
        total_portfolio_value = sum(item['total_cost'] for item in result)
        total_portfolio_cost = sum(item['total_buy_cost'] for item in result)
        total_portfolio_pnl = total_portfolio_value - total_portfolio_cost
        total_portfolio_pnl_percent = ((total_portfolio_value - total_portfolio_cost) / total_portfolio_cost * 100) if total_portfolio_cost > 0 else 0
        
        # Общее изменение цены за день (сумма изменений стоимости всех позиций)
        # Изменение стоимости позиции = изменение цены * количество
        total_price_change = sum(item['price_change'] * item['quantity'] for item in result)
        
        # Процентное изменение рассчитываем как средневзвешенное по стоимости позиций
        total_price_change_percent = 0
        total_value_for_change = sum(item['total_cost'] for item in result if item['price_change'] != 0)
        if total_value_for_change > 0:
            # Средневзвешенное процентное изменение (взвешиваем по стоимости позиций)
            weighted_percent = sum(item['price_change_percent'] * item['total_cost'] for item in result if item['price_change'] != 0)
            total_price_change_percent = weighted_percent / total_value_for_change if total_value_for_change > 0 else 0
        
        # Получаем баланс свободных денег
        balance = db_session.query(CashBalance).filter(CashBalance.id == 1).first()
        if not balance:
            balance = CashBalance(id=1, balance=0.0)
            db_session.add(balance)
            db_session.commit()
        
        return jsonify({
            'success': True,
            'portfolio': result,
            'summary': {
                'total_value': total_portfolio_value,
                'total_cost': total_portfolio_cost,
                'total_pnl': total_portfolio_pnl,
                'total_pnl_percent': total_portfolio_pnl_percent,
                'total_price_change': total_price_change,
                'total_price_change_percent': total_price_change_percent,
                'cash_balance': balance.balance
            }
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/portfolio', methods=['POST'])
def add_portfolio_item():
    """
    Добавить новую позицию в портфель или обновить существующую
    При добавлении дубликата тикера рассчитывается средняя цена покупки
    """
    try:
        data = request.json
        ticker = data.get('ticker', '').upper().strip()
        company_name = data.get('company_name', '').strip()
        category = data.get('category', '').strip()
        asset_type = data.get('asset_type', '').strip()
        instrument_type_str = data.get('instrument_type', 'STOCK')
        quantity = float(data.get('quantity', 0))
        buy_price = float(data.get('average_buy_price', 0))
        
        # Преобразуем тип инструмента в enum
        try:
            instrument_type = InstrumentType[instrument_type_str] if instrument_type_str in ['STOCK', 'BOND'] else InstrumentType.STOCK
        except (KeyError, AttributeError):
            instrument_type = InstrumentType.STOCK
        
        if not ticker or quantity <= 0 or buy_price <= 0:
            return jsonify({
                'success': False,
                'error': 'Неверные данные: тикер, количество и цена должны быть положительными'
            }), 400
        
        # Проверяем, есть ли уже такой тикер
        existing = db_session.query(Portfolio).filter_by(ticker=ticker).first()
        
        if existing:
            # Если тикер уже есть - рассчитываем среднюю цену покупки
            # Формула: (количество1 * цена1 + количество2 * цена2) / (количество1 + количество2)
            total_cost = (existing.quantity * existing.average_buy_price) + (quantity * buy_price)
            new_quantity = existing.quantity + quantity
            new_average_price = total_cost / new_quantity
            
            # Обновляем существующую позицию
            existing.quantity = new_quantity
            existing.average_buy_price = new_average_price
            if company_name:
                existing.company_name = company_name
            if category:
                existing.category = category
            if asset_type:
                existing.asset_type = asset_type
            
            db_session.commit()
            
            return jsonify({
                'success': True,
                'message': f'Позиция {ticker} обновлена. Новое количество: {new_quantity:.2f}, средняя цена: {new_average_price:.2f} ₽',
                'updated': True,
                'new_quantity': new_quantity,
                'new_average_price': new_average_price
            })
        else:
            # Создаем новую позицию
            new_item = Portfolio(
                ticker=ticker,
                company_name=company_name or ticker,
                category=category or None,
                asset_type=asset_type or None,
                instrument_type=instrument_type,
                quantity=quantity,
                average_buy_price=buy_price
            )
            
            db_session.add(new_item)
            db_session.commit()
            
            return jsonify({
                'success': True,
                'message': f'Позиция {ticker} добавлена в портфель',
                'updated': False
            })
    except Exception as e:
        db_session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/portfolio/<int:item_id>', methods=['PUT'])
def update_portfolio_item(item_id):
    """
    Обновить позицию в портфеле
    """
    try:
        item = db_session.query(Portfolio).filter_by(id=item_id).first()
        if not item:
            return jsonify({
                'success': False,
                'error': 'Позиция не найдена'
            }), 404
        
        data = request.json
        if 'quantity' in data:
            item.quantity = float(data['quantity'])
        if 'average_buy_price' in data:
            item.average_buy_price = float(data['average_buy_price'])
        if 'company_name' in data:
            item.company_name = data['company_name'].strip()
        if 'category' in data:
            item.category = data['category'].strip() if data['category'] else None
        if 'asset_type' in data:
            item.asset_type = data['asset_type'].strip() if data['asset_type'] else None
        
        db_session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Позиция обновлена'
        })
    except Exception as e:
        db_session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/portfolio/<int:item_id>', methods=['DELETE'])
def delete_portfolio_item(item_id):
    """
    Удалить позицию из портфеля
    """
    try:
        item = db_session.query(Portfolio).filter_by(id=item_id).first()
        if not item:
            return jsonify({
                'success': False,
                'error': 'Позиция не найдена'
            }), 404
        
        ticker = item.ticker
        db_session.delete(item)
        db_session.commit()
        
        return jsonify({
            'success': True,
            'message': f'Позиция {ticker} удалена из портфеля'
        })
    except Exception as e:
        db_session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/quote/<ticker>', methods=['GET'])
def get_quote(ticker):
    """
    Получить котировку для конкретного тикера
    """
    try:
        ticker = ticker.upper().strip()
        quote_data = moex_service.get_current_price(ticker)
        
        if quote_data:
            return jsonify({
                'success': True,
                'quote': quote_data
            })
        else:
            return jsonify({
                'success': False,
                'error': f'Не удалось получить данные для тикера {ticker}'
            }), 404
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/update-category', methods=['PUT'])
def update_category():
    """
    Обновить категорию для тикера
    """
    try:
        data = request.get_json()
        
        ticker = data.get('ticker', '').upper()
        category = data.get('category', '')
        
        if not ticker:
            return jsonify({
                'success': False,
                'error': 'Тикер не указан'
            }), 400
        
        # Обновляем категорию для всех записей с этим тикером
        portfolio_items = db_session.query(Portfolio).filter(Portfolio.ticker == ticker).all()
        
        if not portfolio_items:
            return jsonify({
                'success': False,
                'error': f'Тикер {ticker} не найден в портфеле'
            }), 404
        
        for item in portfolio_items:
            item.category = category if category else None
        
        db_session.commit()
        
        return jsonify({
            'success': True,
            'message': f'Категория для {ticker} успешно обновлена',
            'ticker': ticker,
            'category': category
        })
        
    except Exception as e:
        db_session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/ticker-info/<ticker>', methods=['GET'])
def get_ticker_info(ticker):
    """
    Получить расширенную информацию о тикере из MOEX API
    """
    try:
        ticker = ticker.upper().strip()
        
        if not ticker:
            return jsonify({
                'success': False,
                'error': 'Тикер не указан'
            }), 400
        
        # Пытаемся определить тип инструмента
        # 1) По записи в портфеле (если есть)
        portfolio_item = db_session.query(Portfolio).filter(Portfolio.ticker == ticker).first()
        instrument_type = None
        if portfolio_item and getattr(portfolio_item, 'instrument_type', None):
            # Enum InstrumentType: используем .name (STOCK/BOND)
            instrument_type = portfolio_item.instrument_type.name
        
        # 2) Если тип не определён из портфеля, используем параметр запроса (если он корректный)
        if not instrument_type:
            param_type = request.args.get('instrument_type')
            if param_type in ['STOCK', 'BOND']:
                instrument_type = param_type
        
        # 3) Если всё ещё не определили - эвристика по тикеру
        if not instrument_type:
            if (ticker.startswith('RU') or ticker.startswith('SU')) and len(ticker) > 10:
                instrument_type = 'BOND'
            else:
                instrument_type = 'STOCK'
        
        # Получаем общую информацию о бумаге из MOEX (для определения типа по GROUPNAME)
        security_info = moex_service.get_security_info(ticker, instrument_type)
        
        # 4) Проверяем GROUPNAME из MOEX API для точного определения типа
        # Если GROUPNAME не найден, пробуем альтернативный тип
        if security_info and security_info.get('fields'):
            groupname = security_info['fields'].get('GROUPNAME', '')
        else:
            # Пробуем получить security_info с альтернативным типом
            alt_type = 'BOND' if instrument_type == 'STOCK' else 'STOCK'
            alt_security_info = moex_service.get_security_info(ticker, alt_type)
            if alt_security_info and alt_security_info.get('fields'):
                security_info = alt_security_info
                groupname = alt_security_info['fields'].get('GROUPNAME', '')
            else:
                groupname = ''
        
        # Определяем тип по GROUPNAME
        if groupname:
            groupname_lower = groupname.lower()
            # Если в GROUPNAME есть "облигации" или "bond" - это облигация
            if 'облигации' in groupname_lower or 'bond' in groupname_lower:
                instrument_type = 'BOND'
            # Если есть "акции" или "share" - это акция
            elif 'акции' in groupname_lower or 'share' in groupname_lower or 'stock' in groupname_lower:
                instrument_type = 'STOCK'
        
        # Человеко-читаемый ярлык типа инструмента
        try:
            instrument_label = InstrumentType[instrument_type].value
        except KeyError:
            instrument_label = 'Облигация' if instrument_type == 'BOND' else 'Акция'
        
        # Получаем текущую цену и котировки (используем уточнённый тип)
        quote_data = moex_service.get_current_price(ticker, instrument_type)
        
        # Перезапрашиваем security_info с правильным типом, чтобы получить trading_params
        if not security_info or not security_info.get('trading_params'):
            security_info = moex_service.get_security_info(ticker, instrument_type)
        
        # Формируем ответ
        result = {
            'success': True,
            'ticker': ticker,
            'instrument_type': instrument_type,
            'instrument_label': instrument_label
        }
        
        if quote_data:
            result['quote'] = quote_data
        
        if security_info:
            result['security'] = security_info
        
        # Если есть данные из портфеля, добавляем их
        if portfolio_item:
            result['portfolio'] = {
                'quantity': portfolio_item.quantity,
                'average_buy_price': float(portfolio_item.average_buy_price) if portfolio_item.average_buy_price else None,
                'company_name': portfolio_item.company_name,
                'category': portfolio_item.category if portfolio_item.category else None,
                'asset_type': portfolio_item.asset_type if portfolio_item.asset_type else None
            }
        
        return jsonify(result)
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/validate-ticker/<ticker>', methods=['GET'])
def validate_ticker(ticker):
    """
    Проверить существование тикера на MOEX
    Поддерживает параметр instrument_type (STOCK или BOND)
    Возвращает также информацию о размере лота (LOTSIZE)
    """
    try:
        ticker = ticker.upper().strip()
        instrument_type = request.args.get('instrument_type', 'STOCK')
        
        if not ticker:
            return jsonify({
                'success': False,
                'error': 'Тикер не указан'
            }), 400
        
        # Пытаемся получить информацию о тикере
        quote_data = moex_service.get_current_price(ticker, instrument_type)
        security_info = moex_service.get_security_info(ticker, instrument_type)
        
        if quote_data or security_info:
            # Тикер существует
            company_name = ''
            if security_info:
                company_name = security_info.get('short_name') or security_info.get('name') or ''
            
            # Получаем размер лота из security_info
            lotsize = 1  # По умолчанию 1
            if security_info and security_info.get('trading_params'):
                lotsize = security_info['trading_params'].get('lotsize', 1)
            
            return jsonify({
                'success': True,
                'ticker': ticker,
                'exists': True,
                'company_name': company_name,
                'current_price': quote_data.get('price') if quote_data else None,
                'instrument_type': instrument_type,
                'lotsize': lotsize  # Размер лота
            })
        else:
            # Тикер не найден
            return jsonify({
                'success': True,
                'ticker': ticker,
                'exists': False,
                'error': f'Тикер {ticker} не найден на Московской бирже'
            })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/transactions', methods=['GET'])
def get_transactions():
    """
    Получить все транзакции с фильтрацией
    
    Query параметры:
    - ticker: фильтр по тикеру (опционально)
    - operation_type: фильтр по типу операции (Покупка/Продажа) (опционально)
    - date_from: фильтр по дате от (YYYY-MM-DD) (опционально)
    - date_to: фильтр по дате до (YYYY-MM-DD) (опционально)
    """
    try:
        query = db_session.query(Transaction)
        
        # Фильтр по тикеру
        ticker = request.args.get('ticker')
        if ticker:
            query = query.filter(Transaction.ticker == ticker.upper())
        
        # Фильтр по типу операции
        operation_type = request.args.get('operation_type')
        if operation_type:
            if operation_type == "Покупка":
                query = query.filter(Transaction.operation_type == TransactionType.BUY)
            elif operation_type == "Продажа":
                query = query.filter(Transaction.operation_type == TransactionType.SELL)
        
        # Фильтр по датам
        date_from = request.args.get('date_from')
        if date_from:
            try:
                date_from_obj = datetime.strptime(date_from, '%Y-%m-%d')
                query = query.filter(Transaction.date >= date_from_obj)
            except ValueError:
                pass
        
        date_to = request.args.get('date_to')
        if date_to:
            try:
                date_to_obj = datetime.strptime(date_to, '%Y-%m-%d')
                date_to_obj = date_to_obj.replace(hour=23, minute=59, second=59)
                query = query.filter(Transaction.date <= date_to_obj)
            except ValueError:
                pass
        
        # Сортировка по дате (от новых к старым)
        query = query.order_by(Transaction.date.desc())
        
        transactions = query.all()
        
        return jsonify({
            'success': True,
            'transactions': [t.to_dict() for t in transactions]
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/transactions', methods=['POST'])
def add_transaction():
    """
    Добавить новую транзакцию
    """
    try:
        data = request.get_json()
        
        # Валидация обязательных полей
        required_fields = ['ticker', 'operation_type', 'price', 'quantity']
        for field in required_fields:
            if field not in data:
                return jsonify({
                    'success': False,
                    'error': f'Отсутствует обязательное поле: {field}'
                }), 400
        
        # Валидация типа операции
        operation_type_str = data['operation_type']
        if operation_type_str == "Покупка":
            operation_type = TransactionType.BUY
        elif operation_type_str == "Продажа":
            operation_type = TransactionType.SELL
        else:
            return jsonify({
                'success': False,
                'error': 'Неверный тип операции. Должно быть "Покупка" или "Продажа"'
            }), 400
        
        # Парсинг даты (если указана)
        transaction_date = datetime.now()
        if 'date' in data and data['date']:
            try:
                transaction_date = datetime.strptime(data['date'], '%Y-%m-%d %H:%M:%S')
            except ValueError:
                try:
                    transaction_date = datetime.strptime(data['date'], '%Y-%m-%d')
                except ValueError:
                    pass
        
        # Вычисление суммы
        price = float(data['price'])
        quantity = float(data['quantity'])
        total = price * quantity
        
        # Определение типа инструмента
        instrument_type_str = data.get('instrument_type', 'STOCK')
        try:
            instrument_type = InstrumentType[instrument_type_str] if instrument_type_str in ['STOCK', 'BOND'] else InstrumentType.STOCK
        except (KeyError, AttributeError):
            instrument_type = InstrumentType.STOCK
        
        # Создание новой транзакции
        transaction = Transaction(
            date=transaction_date,
            ticker=data['ticker'].upper(),
            company_name=data.get('company_name', ''),
            operation_type=operation_type,
            price=price,
            quantity=quantity,
            total=total,
            instrument_type=instrument_type,
            notes=data.get('notes', '')
        )
        
        db_session.add(transaction)
        
        # Обновляем баланс свободных денег
        balance = db_session.query(CashBalance).filter(CashBalance.id == 1).first()
        if not balance:
            balance = CashBalance(id=1, balance=0.0)
            db_session.add(balance)
        
        if operation_type == TransactionType.SELL:
            # При продаже добавляем сумму в баланс
            balance.balance += total
        elif operation_type == TransactionType.BUY:
            # При покупке:
            # Если сумма покупки больше баланса - обнуляем баланс
            # Если сумма покупки меньше баланса - вычитаем сумму из баланса
            if total >= balance.balance:
                balance.balance = 0.0
            else:
                balance.balance -= total
        
        db_session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Транзакция успешно добавлена',
            'transaction': transaction.to_dict(),
            'cash_balance': balance.balance
        })
        
    except Exception as e:
        db_session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/transactions/<int:transaction_id>', methods=['PUT'])
def update_transaction(transaction_id):
    """
    Обновить существующую транзакцию
    """
    try:
        transaction = db_session.query(Transaction).filter(Transaction.id == transaction_id).first()
        
        if not transaction:
            return jsonify({
                'success': False,
                'error': 'Транзакция не найдена'
            }), 404
        
        data = request.get_json()
        
        # Сохраняем старые значения для пересчета баланса
        old_ticker = transaction.ticker
        old_operation_type = transaction.operation_type
        old_total = transaction.total
        
        # Обновление полей
        if 'ticker' in data:
            transaction.ticker = data['ticker'].upper()
        
        if 'company_name' in data:
            transaction.company_name = data['company_name']
        
        if 'operation_type' in data:
            operation_type_str = data['operation_type']
            if operation_type_str == "Покупка":
                transaction.operation_type = TransactionType.BUY
            elif operation_type_str == "Продажа":
                transaction.operation_type = TransactionType.SELL
        
        if 'date' in data and data['date']:
            try:
                transaction.date = datetime.strptime(data['date'], '%Y-%m-%d %H:%M:%S')
            except ValueError:
                try:
                    transaction.date = datetime.strptime(data['date'], '%Y-%m-%d')
                except ValueError:
                    pass
        
        # Обновление цены и количества
        if 'price' in data:
            transaction.price = float(data['price'])
        
        if 'quantity' in data:
            transaction.quantity = float(data['quantity'])
        
        # Пересчёт суммы
        transaction.total = transaction.price * transaction.quantity
        
        if 'notes' in data:
            transaction.notes = data['notes']
        
        # Сохраняем новый тикер
        new_ticker = transaction.ticker
        
        db_session.commit()
        
        # Пересчитываем портфель для нового тикера
        recalculate_portfolio_for_ticker(new_ticker)
        
        # Если тикер изменился, пересчитываем и для старого тикера
        if old_ticker != new_ticker:
            recalculate_portfolio_for_ticker(old_ticker)
        
        return jsonify({
            'success': True,
            'message': 'Транзакция успешно обновлена',
            'transaction': transaction.to_dict(),
            'ticker': new_ticker
        })
        
    except Exception as e:
        db_session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


def recalculate_portfolio_for_ticker(ticker):
    """
    Пересчитать портфель для указанного тикера на основе всех транзакций
    Учитывает только те транзакции покупки, которые не были полностью проданы.
    Если позиция была полностью продана (количество = 0), при следующей покупке
    средняя цена считается с нуля от новых транзакций.
    """
    try:
        # Получаем все транзакции для тикера, отсортированные по дате (от старых к новым)
        all_transactions = db_session.query(Transaction).filter(
            Transaction.ticker == ticker.upper()
        ).order_by(Transaction.date.asc()).all()
        
        # Находим позицию в портфеле
        portfolio_item = db_session.query(Portfolio).filter_by(ticker=ticker.upper()).first()
        
        # Проходим по транзакциям в хронологическом порядке и отслеживаем количество
        # Если количество становится 0 или отрицательным, это означает полную продажу
        # После этого начинаем считать среднюю цену только от новых покупок
        # Используем FIFO (первая купленная - первая проданная)
        current_quantity = 0
        # Храним покупки как кортежи (цена, оставшееся_количество)
        relevant_buy_transactions = []
        
        for trans in all_transactions:
            if trans.operation_type == TransactionType.BUY:
                current_quantity += trans.quantity
                # Если количество было 0 или отрицательным перед этой покупкой,
                # это означает, что позиция была полностью продана, начинаем считать заново
                if current_quantity - trans.quantity <= 0:
                    # Очищаем список покупок, начинаем считать с нуля
                    relevant_buy_transactions = []
                # Добавляем покупку с полным количеством
                relevant_buy_transactions.append((trans.price, trans.quantity))
            elif trans.operation_type == TransactionType.SELL:
                sell_quantity = trans.quantity
                current_quantity -= sell_quantity
                
                # Удаляем покупки по FIFO (первая купленная - первая проданная)
                while sell_quantity > 0 and relevant_buy_transactions:
                    buy_price, buy_remaining = relevant_buy_transactions[0]
                    if buy_remaining <= sell_quantity:
                        # Вся эта покупка была продана
                        sell_quantity -= buy_remaining
                        relevant_buy_transactions.pop(0)
                    else:
                        # Частично продана - уменьшаем оставшееся количество
                        relevant_buy_transactions[0] = (buy_price, buy_remaining - sell_quantity)
                        sell_quantity = 0
                
                # Если количество стало отрицательным, это ошибка данных, но обрабатываем
                if current_quantity < 0:
                    current_quantity = 0
        
        total_quantity = current_quantity
        
        if total_quantity <= 0:
            # Если количество <= 0, удаляем позицию из портфеля
            if portfolio_item:
                db_session.delete(portfolio_item)
                db_session.commit()
            return True
        
        # Рассчитываем среднюю цену покупки только из релевантных транзакций покупки
        if relevant_buy_transactions:
            total_cost = sum(price * quantity for price, quantity in relevant_buy_transactions)
            total_buy_quantity = sum(quantity for _, quantity in relevant_buy_transactions)
            average_buy_price = total_cost / total_buy_quantity if total_buy_quantity > 0 else 0
        else:
            # Если нет релевантных транзакций покупки, но есть позиция, оставляем старую цену
            # Если позиции нет, не создаем новую (нельзя иметь позицию без покупок)
            if portfolio_item:
                average_buy_price = portfolio_item.average_buy_price
            else:
                # Нет транзакций покупки и нет позиции - не создаем новую позицию
                return True
        
        # Обновляем или создаем позицию в портфеле
        if portfolio_item:
            portfolio_item.quantity = total_quantity
            portfolio_item.average_buy_price = average_buy_price
        else:
            # Если позиции нет, но количество > 0 и есть транзакции покупки, создаем новую
            # Берем данные из последней транзакции
            last_transaction = all_transactions[-1] if all_transactions else None
            if last_transaction and relevant_buy_transactions:
                new_item = Portfolio(
                    ticker=ticker.upper(),
                    company_name=last_transaction.company_name or ticker.upper(),
                    quantity=total_quantity,
                    average_buy_price=average_buy_price,
                    instrument_type=last_transaction.instrument_type
                )
                db_session.add(new_item)
        
        db_session.commit()
        return True
        
    except Exception as e:
        db_session.rollback()
        print(f"Ошибка пересчета портфеля для {ticker}: {str(e)}")
        return False


@app.route('/api/transactions/<int:transaction_id>', methods=['DELETE'])
def delete_transaction(transaction_id):
    """
    Удалить транзакцию и пересчитать портфель
    """
    try:
        transaction = db_session.query(Transaction).filter(Transaction.id == transaction_id).first()
        
        if not transaction:
            return jsonify({
                'success': False,
                'error': 'Транзакция не найдена'
            }), 404
        
        # Сохраняем данные для пересчета баланса
        ticker = transaction.ticker
        operation_type = transaction.operation_type
        total = transaction.total
        
        # Обновляем баланс свободных денег (откатываем влияние транзакции)
        balance = db_session.query(CashBalance).filter(CashBalance.id == 1).first()
        if not balance:
            balance = CashBalance(id=1, balance=0.0)
            db_session.add(balance)
        
        # Откатываем влияние удаляемой транзакции
        if operation_type == TransactionType.SELL:
            balance.balance -= total
        elif operation_type == TransactionType.BUY:
            # При удалении покупки восстанавливаем баланс
            # Но мы не знаем точно, сколько было до покупки, если покупка обнулила баланс
            # Поэтому просто добавляем сумму обратно (это не идеально, но лучше чем ничего)
            balance.balance += total
        
        # Удаляем транзакцию
        db_session.delete(transaction)
        db_session.commit()
        
        # Пересчитываем портфель для этого тикера
        recalculate_portfolio_for_ticker(ticker)
        
        return jsonify({
            'success': True,
            'message': 'Транзакция успешно удалена',
            'ticker': ticker,
            'cash_balance': balance.balance
        })
        
    except Exception as e:
        db_session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/cash-balance', methods=['GET'])
def get_cash_balance():
    """
    Получить текущий баланс свободных денег от продаж
    """
    try:
        balance = db_session.query(CashBalance).filter(CashBalance.id == 1).first()
        if not balance:
            balance = CashBalance(id=1, balance=0.0)
            db_session.add(balance)
            db_session.commit()
        
        return jsonify({
            'success': True,
            'balance': balance.balance
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/currency-rates', methods=['GET'])
def get_currency_rates():
    """
    Получить основные курсы валют к рублю (для отображения в UI).
    Возвращает минимальный набор: USD, EUR, CNY (если есть), а также дату обновления.
    """
    try:
        # Получаем расширенную информацию по основным валютам
        rates_info = currency_service.get_rates_info(['USD', 'EUR', 'CNY'])

        return jsonify({
            'success': True,
            'rates': rates_info
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/price-history', methods=['GET'])
def get_price_history():
    """
    Получить историю цен
    
    Query параметры:
    - ticker: тикер акции (опционально, если не указан - все тикеры)
    - days: количество дней истории (по умолчанию 30, если не указаны даты)
    - date_from: дата начала (формат: YYYY-MM-DD)
    - date_to: дата окончания (формат: YYYY-MM-DD)
    - limit: максимальное количество записей (опционально)
    """
    try:
        ticker = request.args.get('ticker')
        days = request.args.get('days', type=int)
        date_from = request.args.get('date_from')
        date_to = request.args.get('date_to')
        limit = request.args.get('limit', type=int)
        
        # Определяем параметры фильтрации
        filter_params = {}
        if date_from:
            filter_params['date_from'] = date_from
        if date_to:
            filter_params['date_to'] = date_to
        if not date_from and not date_to and days:
            filter_params['days'] = days
        elif not date_from and not date_to:
            filter_params['days'] = 30  # По умолчанию 30 дней
        
        if limit:
            filter_params['limit'] = limit
        
        if ticker:
            # История для конкретного тикера
            history = price_logger.get_price_history(ticker=ticker, **filter_params)
        else:
            # История для всех тикеров, сгруппированная по датам
            history = price_logger.get_price_history_grouped(**filter_params)
        
        return jsonify({
            'success': True,
            'history': history,
            'ticker': ticker,
            'filters': filter_params
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/log-prices-now', methods=['POST'])
def log_prices_now():
    """
    Ручное логирование цен (принудительное)
    
    Логирует цены даже если запись за сегодня уже есть
    В продакшене автоматическое логирование выполняется в настраиваемое время
    """
    try:
        price_logger.log_all_prices(force=True)
        return jsonify({
            'success': True,
            'message': 'Цены успешно залогированы'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/settings/logging-time', methods=['GET'])
def get_logging_time_setting():
    """
    Получить текущее время автоматического логирования цен
    """
    try:
        hour, minute = get_logging_time()
        return jsonify({
            'success': True,
            'hour': hour,
            'minute': minute,
            'time': f'{hour:02d}:{minute:02d}'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/scheduler/status', methods=['GET'])
def get_scheduler_status():
    """
    Получить статус планировщика задач
    """
    try:
        jobs = []
        for job in scheduler.get_jobs():
            jobs.append({
                'id': job.id,
                'name': job.name,
                'next_run_time': str(job.next_run_time) if job.next_run_time else None
            })
        
        return jsonify({
            'success': True,
            'running': scheduler.running,
            'jobs_count': len(scheduler.get_jobs()),
            'jobs': jobs
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/settings/logging-time', methods=['POST'])
def set_logging_time_setting():
    """
    Установить время автоматического логирования цен
    
    Body JSON:
    {
        "hour": 0-23,
        "minute": 0-59
    }
    """
    try:
        data = request.get_json()
        hour = data.get('hour')
        minute = data.get('minute')
        
        # Валидация
        if hour is None or minute is None:
            return jsonify({
                'success': False,
                'error': 'Необходимо указать hour и minute'
            }), 400
        
        if not (0 <= hour <= 23):
            return jsonify({
                'success': False,
                'error': 'hour должен быть от 0 до 23'
            }), 400
        
        if not (0 <= minute <= 59):
            return jsonify({
                'success': False,
                'error': 'minute должен быть от 0 до 59'
            }), 400
        
        # Получаем или создаем настройки
        settings = db_session.query(Settings).filter(Settings.id == 1).first()
        if not settings:
            settings = Settings(id=1, price_logging_hour=hour, price_logging_minute=minute)
            db_session.add(settings)
        else:
            settings.price_logging_hour = hour
            settings.price_logging_minute = minute
        
        db_session.commit()
        
        # Обновляем планировщик
        update_scheduler_time()
        
        return jsonify({
            'success': True,
            'message': f'Время логирования установлено: {hour:02d}:{minute:02d} МСК',
            'hour': hour,
            'minute': minute,
            'time': f'{hour:02d}:{minute:02d}'
        })
    except Exception as e:
        db_session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.teardown_appcontext
def shutdown_session(exception=None):
    """Закрытие сессии БД после запроса"""
    db_session.remove()


def close_db():
    """Закрытие соединения с БД при завершении приложения"""
    db_session.remove()
    # Останавливаем планировщик
    if scheduler.running:
        scheduler.shutdown()


@app.route('/api/categories', methods=['GET'])
def get_categories():
    """
    Получить список всех категорий
    """
    try:
        categories = db_session.query(Category).order_by(Category.name).all()
        return jsonify({
            'success': True,
            'categories': [cat.to_dict() for cat in categories]
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/categories', methods=['POST'])
def create_category():
    """
    Создать новую категорию
    """
    try:
        data = request.json
        name = data.get('name', '').strip()
        
        if not name:
            return jsonify({
                'success': False,
                'error': 'Название категории не может быть пустым'
            }), 400
        
        # Проверяем, не существует ли уже такая категория
        existing = db_session.query(Category).filter_by(name=name).first()
        if existing:
            return jsonify({
                'success': False,
                'error': 'Категория с таким названием уже существует'
            }), 400
        
        new_category = Category(name=name)
        db_session.add(new_category)
        db_session.commit()
        
        return jsonify({
            'success': True,
            'category': new_category.to_dict(),
            'message': f'Категория "{name}" успешно создана'
        })
    except Exception as e:
        db_session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/categories/<int:category_id>', methods=['PUT'])
def update_category_item(category_id):
    """
    Обновить категорию
    """
    try:
        category = db_session.query(Category).filter_by(id=category_id).first()
        if not category:
            return jsonify({
                'success': False,
                'error': 'Категория не найдена'
            }), 404
        
        data = request.json
        new_name = data.get('name', '').strip()
        
        if not new_name:
            return jsonify({
                'success': False,
                'error': 'Название категории не может быть пустым'
            }), 400
        
        # Проверяем, не существует ли уже категория с таким названием
        existing = db_session.query(Category).filter_by(name=new_name).filter(Category.id != category_id).first()
        if existing:
            return jsonify({
                'success': False,
                'error': 'Категория с таким названием уже существует'
            }), 400
        
        old_name = category.name
        category.name = new_name
        db_session.commit()
        
        # Обновляем все позиции портфеля, которые использовали старую категорию
        db_session.query(Portfolio).filter_by(category=old_name).update({'category': new_name})
        db_session.commit()
        
        return jsonify({
            'success': True,
            'category': category.to_dict(),
            'message': f'Категория успешно обновлена'
        })
    except Exception as e:
        db_session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/categories/<int:category_id>', methods=['DELETE'])
def delete_category(category_id):
    """
    Удалить категорию
    """
    try:
        category = db_session.query(Category).filter_by(id=category_id).first()
        if not category:
            return jsonify({
                'success': False,
                'error': 'Категория не найдена'
            }), 404
        
        category_name = category.name
        
        # Удаляем категорию из всех позиций портфеля
        db_session.query(Portfolio).filter_by(category=category_name).update({'category': None})
        
        # Удаляем саму категорию
        db_session.delete(category)
        db_session.commit()
        
        return jsonify({
            'success': True,
            'message': f'Категория "{category_name}" успешно удалена'
        })
    except Exception as e:
        db_session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# ==================== API ДЛЯ ВИДОВ АКТИВОВ ====================

@app.route('/api/asset-types', methods=['GET'])
def get_asset_types():
    """
    Получить список всех видов активов
    """
    try:
        asset_types = db_session.query(AssetType).order_by(AssetType.name).all()
        return jsonify({
            'success': True,
            'asset_types': [at.to_dict() for at in asset_types]
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/asset-types', methods=['POST'])
def create_asset_type():
    """
    Создать новый вид актива
    """
    try:
        data = request.json
        name = data.get('name', '').strip()
        
        if not name:
            return jsonify({
                'success': False,
                'error': 'Название вида актива не может быть пустым'
            }), 400
        
        # Проверяем, не существует ли уже такой вид актива
        existing = db_session.query(AssetType).filter_by(name=name).first()
        if existing:
            return jsonify({
                'success': False,
                'error': 'Вид актива с таким названием уже существует'
            }), 400
        
        new_asset_type = AssetType(name=name)
        db_session.add(new_asset_type)
        db_session.commit()
        
        return jsonify({
            'success': True,
            'asset_type': new_asset_type.to_dict(),
            'message': f'Вид актива "{name}" успешно создан'
        })
    except Exception as e:
        db_session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/asset-types/<int:asset_type_id>', methods=['PUT'])
def update_asset_type_item(asset_type_id):
    """
    Обновить вид актива
    """
    try:
        asset_type = db_session.query(AssetType).filter_by(id=asset_type_id).first()
        if not asset_type:
            return jsonify({
                'success': False,
                'error': 'Вид актива не найден'
            }), 404
        
        data = request.json
        new_name = data.get('name', '').strip()
        
        if not new_name:
            return jsonify({
                'success': False,
                'error': 'Название вида актива не может быть пустым'
            }), 400
        
        # Проверяем, не существует ли уже вид актива с таким названием
        existing = db_session.query(AssetType).filter_by(name=new_name).filter(AssetType.id != asset_type_id).first()
        if existing:
            return jsonify({
                'success': False,
                'error': 'Вид актива с таким названием уже существует'
            }), 400
        
        old_name = asset_type.name
        asset_type.name = new_name
        db_session.commit()
        
        # Обновляем все позиции портфеля, которые использовали старый вид актива
        db_session.query(Portfolio).filter_by(asset_type=old_name).update({'asset_type': new_name})
        db_session.commit()
        
        return jsonify({
            'success': True,
            'asset_type': asset_type.to_dict(),
            'message': f'Вид актива успешно обновлен'
        })
    except Exception as e:
        db_session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/asset-types/<int:asset_type_id>', methods=['DELETE'])
def delete_asset_type(asset_type_id):
    """
    Удалить вид актива
    """
    try:
        asset_type = db_session.query(AssetType).filter_by(id=asset_type_id).first()
        if not asset_type:
            return jsonify({
                'success': False,
                'error': 'Вид актива не найден'
            }), 404
        
        asset_type_name = asset_type.name
        
        # Удаляем вид актива из всех позиций портфеля
        db_session.query(Portfolio).filter_by(asset_type=asset_type_name).update({'asset_type': None})
        
        # Удаляем сам вид актива
        db_session.delete(asset_type)
        db_session.commit()
        
        return jsonify({
            'success': True,
            'message': f'Вид актива "{asset_type_name}" успешно удален'
        })
    except Exception as e:
        db_session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


atexit.register(close_db)


if __name__ == '__main__':
    # При прямом запуске запускаем планировщик сразу
    # При запуске через Gunicorn планировщик запустится при первом запросе через @app.before_request
    print("=" * 60)
    print("Запуск приложения...")
    print("=" * 60)
    start_scheduler()
    
    if not scheduler.running:
        print("ПРЕДУПРЕЖДЕНИЕ: Планировщик не запустился!")
    else:
        print("Планировщик успешно запущен")

    # Отключаем автоматический перезапуск (reloader), чтобы не было второго процесса
    app.run(debug=True, host='0.0.0.0', port=5000, use_reloader=False)
