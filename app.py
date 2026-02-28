"""
Главный файл Flask приложения для отслеживания котировок MOEX
"""
from flask import Flask, render_template, jsonify, request, send_file, redirect, url_for, flash
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from models.database import init_db, db_session
from models.portfolio import Portfolio, InstrumentType
from models.price_history import PriceHistory
from models.transaction import Transaction, TransactionType
from models.category import Category
from models.asset_type import AssetType
from models.cash_balance import CashBalance
from models.settings import Settings
from models.user import User
from models.access_log import AccessLog
from services.moex_service import MOEXService
from services.price_logger import PriceLogger
from services.currency_service import CurrencyService
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from datetime import datetime, timedelta
import atexit
import pytz
import os
import shutil
from concurrent.futures import ThreadPoolExecutor, as_completed

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')


def _parse_user_agent(ua_string):
    """Извлечь ОС и браузер из строки User-Agent."""
    if not ua_string:
        return 'Неизвестно', 'Неизвестно'

    ua = ua_string

    # ОС
    if 'Windows NT 10.0' in ua:
        os_info = 'Windows 10/11'
    elif 'Windows NT 6.3' in ua:
        os_info = 'Windows 8.1'
    elif 'Windows NT 6.1' in ua:
        os_info = 'Windows 7'
    elif 'Windows' in ua:
        os_info = 'Windows'
    elif 'iPhone' in ua:
        os_info = 'iOS (iPhone)'
    elif 'iPad' in ua:
        os_info = 'iOS (iPad)'
    elif 'Android' in ua:
        # Попробуем достать версию
        import re
        m = re.search(r'Android\s([\d.]+)', ua)
        os_info = f'Android {m.group(1)}' if m else 'Android'
    elif 'Mac OS X' in ua:
        import re
        m = re.search(r'Mac OS X ([\d_]+)', ua)
        ver = m.group(1).replace('_', '.') if m else ''
        os_info = f'macOS {ver}' if ver else 'macOS'
    elif 'Linux' in ua:
        os_info = 'Linux'
    else:
        os_info = 'Неизвестно'

    # Браузер (порядок важен: Edge/Chrome/Firefox/Safari)
    if 'Edg/' in ua or 'Edge/' in ua:
        browser_info = 'Edge'
    elif 'YaBrowser' in ua:
        browser_info = 'Яндекс.Браузер'
    elif 'OPR/' in ua or 'Opera' in ua:
        browser_info = 'Opera'
    elif 'Chrome/' in ua:
        import re
        m = re.search(r'Chrome/([\d.]+)', ua)
        browser_info = f'Chrome {m.group(1).split(".")[0]}' if m else 'Chrome'
    elif 'Firefox/' in ua:
        import re
        m = re.search(r'Firefox/([\d.]+)', ua)
        browser_info = f'Firefox {m.group(1).split(".")[0]}' if m else 'Firefox'
    elif 'Safari/' in ua:
        browser_info = 'Safari'
    else:
        browser_info = 'Неизвестно'

    return os_info, browser_info


def _get_real_ip():
    """Получить реальный IP клиента с учётом прокси/Nginx."""
    return (
        request.headers.get('X-Forwarded-For', '').split(',')[0].strip()
        or request.headers.get('X-Real-IP', '')
        or request.remote_addr
        or '—'
    )


_MOSCOW_TZ = pytz.timezone('Europe/Moscow')

def write_access_log(event: str, username: str = None, success: bool = True):
    """Записать событие доступа в базу данных."""
    try:
        ua_string = request.headers.get('User-Agent', '')
        os_info, browser_info = _parse_user_agent(ua_string)
        log = AccessLog(
            timestamp=datetime.now(_MOSCOW_TZ).replace(tzinfo=None),
            ip_address=_get_real_ip(),
            username=username,
            event=event,
            success=success,
            os_info=os_info,
            browser_info=browser_info,
            user_agent=ua_string[:500] if ua_string else None,
        )
        db_session.add(log)
        db_session.commit()
    except Exception:
        db_session.rollback()

# Инициализация Flask-Login
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'
login_manager.login_message = 'Необходимо войти для доступа к приложению'

@login_manager.user_loader
def load_user(user_id):
    return db_session.get(User, int(user_id))

# Инициализация БД
init_db()

# Создаём пользователя admin по умолчанию, если пользователей нет
def init_default_user():
    for username, password in [('admin', 'admin'), ('dev', 'dev')]:
        if not db_session.query(User).filter_by(username=username).first():
            user = User(username=username)
            user.set_password(password)
            db_session.add(user)
    db_session.commit()

init_default_user()

# Миграция: добавляем новые колонки и пересоздаём таблицы при необходимости
def migrate_portfolio_columns():
    from sqlalchemy import text
    with db_session.bind.connect() as conn:
        # --- Простые ALTER TABLE для portfolio ---
        for col, col_type in [
            ('current_price', 'REAL'),
            ('current_price_updated_at', 'DATETIME'),
            ('lotsize', 'INTEGER'),
        ]:
            try:
                conn.execute(text(f'ALTER TABLE portfolio ADD COLUMN {col} {col_type}'))
                conn.commit()
            except Exception:
                pass  # Колонка уже существует

        # --- Пересоздание portfolio: убрать UNIQUE(ticker), добавить user_id ---
        cols = [row[1] for row in conn.execute(text('PRAGMA table_info(portfolio)')).fetchall()]
        if 'user_id' not in cols:
            conn.execute(text('''
                CREATE TABLE portfolio_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticker VARCHAR(20) NOT NULL,
                    user_id INTEGER REFERENCES users(id),
                    company_name VARCHAR(200) NOT NULL,
                    quantity REAL NOT NULL,
                    average_buy_price REAL NOT NULL,
                    category VARCHAR(100),
                    asset_type VARCHAR(100),
                    instrument_type VARCHAR(20) NOT NULL DEFAULT 'STOCK',
                    bond_facevalue REAL,
                    bond_currency VARCHAR(10),
                    current_price REAL,
                    current_price_updated_at DATETIME,
                    lotsize INTEGER,
                    date_added DATETIME,
                    UNIQUE (ticker, user_id)
                )
            '''))
            conn.execute(text('''
                INSERT INTO portfolio_new
                    (id, ticker, user_id, company_name, quantity, average_buy_price,
                     category, asset_type, instrument_type, bond_facevalue, bond_currency,
                     current_price, current_price_updated_at, lotsize, date_added)
                SELECT id, ticker, 1, company_name, quantity, average_buy_price,
                       category, asset_type, instrument_type, bond_facevalue, bond_currency,
                       current_price, current_price_updated_at, lotsize, date_added
                FROM portfolio
            '''))
            conn.execute(text('DROP TABLE portfolio'))
            conn.execute(text('ALTER TABLE portfolio_new RENAME TO portfolio'))
            conn.commit()

        # --- Пересоздание categories: убрать UNIQUE(name), добавить user_id ---
        cols = [row[1] for row in conn.execute(text('PRAGMA table_info(categories)')).fetchall()]
        if 'user_id' not in cols:
            conn.execute(text('''
                CREATE TABLE categories_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name VARCHAR(100) NOT NULL,
                    user_id INTEGER REFERENCES users(id),
                    date_created DATETIME,
                    UNIQUE (name, user_id)
                )
            '''))
            conn.execute(text('''
                INSERT INTO categories_new (id, name, user_id, date_created)
                SELECT id, name, 1, date_created FROM categories
            '''))
            conn.execute(text('DROP TABLE categories'))
            conn.execute(text('ALTER TABLE categories_new RENAME TO categories'))
            conn.commit()

        # --- Пересоздание asset_types: убрать UNIQUE(name), добавить user_id ---
        cols = [row[1] for row in conn.execute(text('PRAGMA table_info(asset_types)')).fetchall()]
        if 'user_id' not in cols:
            conn.execute(text('''
                CREATE TABLE asset_types_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name VARCHAR(100) NOT NULL,
                    user_id INTEGER REFERENCES users(id),
                    date_created DATETIME,
                    UNIQUE (name, user_id)
                )
            '''))
            conn.execute(text('''
                INSERT INTO asset_types_new (id, name, user_id, date_created)
                SELECT id, name, 1, date_created FROM asset_types
            '''))
            conn.execute(text('DROP TABLE asset_types'))
            conn.execute(text('ALTER TABLE asset_types_new RENAME TO asset_types'))
            conn.commit()

        # --- ALTER TABLE для transactions ---
        cols = [row[1] for row in conn.execute(text('PRAGMA table_info(transactions)')).fetchall()]
        if 'user_id' not in cols:
            conn.execute(text('ALTER TABLE transactions ADD COLUMN user_id INTEGER REFERENCES users(id)'))
            conn.execute(text('UPDATE transactions SET user_id = 1'))
            conn.commit()

        # --- ALTER TABLE для cash_balance ---
        cols = [row[1] for row in conn.execute(text('PRAGMA table_info(cash_balance)')).fetchall()]
        if 'user_id' not in cols:
            conn.execute(text('ALTER TABLE cash_balance ADD COLUMN user_id INTEGER REFERENCES users(id)'))
            conn.execute(text('UPDATE cash_balance SET user_id = 1'))
            conn.commit()

migrate_portfolio_columns()

# Инициализация категорий при первом запуске (для каждого пользователя)
def init_categories():
    """Инициализация категорий по умолчанию для каждого пользователя"""
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

    users = db_session.query(User).all()
    for user in users:
        existing_names = {c.name for c in db_session.query(Category).filter_by(user_id=user.id).all()}
        for cat_name in default_categories:
            if cat_name not in existing_names:
                db_session.add(Category(name=cat_name, user_id=user.id))
    db_session.commit()

init_categories()

# Инициализация баланса свободных денег (для каждого пользователя)
def init_cash_balance():
    """Инициализация баланса свободных денег (если еще не создан для пользователя)"""
    users = db_session.query(User).all()
    for user in users:
        existing = db_session.query(CashBalance).filter_by(user_id=user.id).first()
        if not existing:
            db_session.add(CashBalance(user_id=user.id, balance=0.0))
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

# Добавляем периодическую проверку в 6, 12, 17, 21 час, если записи за сегодня нет
def check_and_log_prices():
    """Проверяет, есть ли записи за сегодня, и если нет - логирует цены"""
    from datetime import date, timedelta
    from models.price_history import PriceHistory
    
    now_moscow = datetime.now(pytz.timezone('Europe/Moscow'))

    # В установленное время отдельная задача daily_price_logging сама пишет цены.
    # Чтобы не было двойной записи, периодическая проверка в этот момент ничего не делает.
    # Используем окно ±1 минута для предотвращения конфликтов
    logging_hour, logging_minute = get_logging_time()
    current_minute = now_moscow.minute
    current_hour = now_moscow.hour
    
    # Проверяем, не находимся ли мы в окне ±1 минута от времени ежедневного логирования
    if current_hour == logging_hour:
        if abs(current_minute - logging_minute) <= 1:
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
    trigger=CronTrigger(hour='6,12,17,21', minute=0, timezone='Europe/Moscow'),  # В 6, 12, 17, 21 час
    id='periodic_price_logging',
    name='Периодическое логирование цен (в 6, 12, 17, 21 час, если записи нет)',
    replace_existing=True
)

import threading

# Флаг, показывающий, что планировщик был запущен при старте приложения
# Это позволяет избежать лишних проверок в @app.before_request
_scheduler_started = False
_scheduler_lock = threading.Lock()

# Функция для запуска планировщика (вызывается при первом запросе или при прямом запуске)
def start_scheduler():
    """Запускает планировщик задач, если он еще не запущен"""
    global _scheduler_started
    
    if scheduler.running:
        # Планировщик уже запущен, просто обновляем флаг
        _scheduler_started = True
        return
    
    # Используем lock для предотвращения одновременного запуска из разных потоков
    with _scheduler_lock:
        # Двойная проверка после получения lock
        if scheduler.running:
            _scheduler_started = True
            return
        
        try:
            moscow_time = datetime.now(pytz.timezone('Europe/Moscow'))
            print(f"[{moscow_time}] Запуск планировщика...")
            scheduler.start()
            _scheduler_started = True
            hour, minute = get_logging_time()
            moscow_time = datetime.now(pytz.timezone('Europe/Moscow'))
            print(f"[{moscow_time}] ===== ПЛАНИРОВЩИК ЗАПУЩЕН =====")
            print(f"[{moscow_time}] Ежедневное логирование цен в {hour:02d}:{minute:02d} МСК")
            print(f"[{moscow_time}] Периодическая проверка в 6, 12, 17, 21 час (если записи за сегодня нет)")
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
@app.before_request
def ensure_scheduler_running():
    """Убеждаемся, что планировщик запущен при первом запросе (только для Gunicorn)"""
    # Если планировщик уже был запущен при старте приложения, пропускаем проверку
    if _scheduler_started:
        return
    
    # Запускаем только если планировщик не запущен
    if not scheduler.running:
        start_scheduler()

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    error = None
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        user = db_session.query(User).filter_by(username=username).first()
        if user and user.check_password(password):
            login_user(user, remember=True)
            write_access_log('login_ok', username=username, success=True)
            return redirect(url_for('index'))
        write_access_log('login_fail', username=username or '—', success=False)
        error = 'Неверный логин или пароль'
    return render_template('login.html', error=error)


@app.route('/logout')
@login_required
def logout():
    write_access_log('logout', username=current_user.username, success=True)
    logout_user()
    return redirect(url_for('login'))


@app.route('/api/change-password', methods=['POST'])
@login_required
def change_password():
    data = request.get_json()
    current_password = data.get('current_password', '')
    new_password = data.get('new_password', '')
    if not current_user.check_password(current_password):
        return jsonify({'success': False, 'error': 'Неверный текущий пароль'}), 400
    if len(new_password) < 4:
        return jsonify({'success': False, 'error': 'Пароль должен быть не менее 4 символов'}), 400
    current_user.set_password(new_password)
    db_session.commit()
    return jsonify({'success': True})


@app.route('/')
@login_required
def index():
    """Главная страница с портфелем"""
    write_access_log('page_open', username=current_user.username, success=True)
    return render_template('index.html')


@app.before_request
def require_login():
    """Защита всех маршрутов, кроме login и статических файлов"""
    open_endpoints = {'login', 'static'}
    if not current_user.is_authenticated and request.endpoint not in open_endpoints:
        return redirect(url_for('login'))


@app.route('/favicon.ico')
def favicon():
    """Явный маршрут для favicon"""
    from flask import send_from_directory
    import os
    favicon_path = os.path.join(app.static_folder, 'favicon.ico')
    if os.path.exists(favicon_path):
        return send_from_directory(app.static_folder, 'favicon.ico', mimetype='image/vnd.microsoft.icon')
    else:
        # Fallback на SVG если ICO нет
        return send_from_directory(app.static_folder, 'favicon.svg', mimetype='image/svg+xml')


@app.route('/favicon.svg')
def favicon_svg():
    """Явный маршрут для SVG favicon"""
    from flask import send_from_directory
    import os
    favicon_path = os.path.join(app.static_folder, 'favicon.svg')
    if os.path.exists(favicon_path):
        return send_from_directory(app.static_folder, 'favicon.svg', mimetype='image/svg+xml')
    else:
        # Возвращаем 404 если файл не найден
        from flask import abort
        abort(404)


@app.route('/api/portfolio', methods=['GET'])
def get_portfolio():
    """
    Получить весь портфель с актуальными ценами
    Средняя цена покупки рассчитывается из истории транзакций покупки
    """
    try:
        # Период для расчета изменения цены (в днях). Если не задан - используем "последние две записи".
        change_days = request.args.get('change_days', type=int)
        # Флаг: использовать только кэшированные данные (без прямых запросов к MOEX API)
        use_cached = request.args.get('use_cached', default=0, type=int) == 1

        portfolio_items = db_session.query(Portfolio).filter(Portfolio.user_id == current_user.id).all()
        
        # Проверяем на дубликаты и удаляем их
        # Группируем по тикеру и оставляем только первую запись для каждого тикера
        seen_tickers = {}
        items_to_delete = []
        unique_items = []
        
        for item in portfolio_items:
            ticker_upper = item.ticker.upper()
            if ticker_upper not in seen_tickers:
                seen_tickers[ticker_upper] = item
                unique_items.append(item)
            else:
                # Дубликат - помечаем для удаления
                items_to_delete.append(item)
        
        # Удаляем дубликаты из базы данных
        if items_to_delete:
            for duplicate in items_to_delete:
                db_session.delete(duplicate)
            db_session.commit()
        
        result = []
        
        # Оптимизация: загружаем все транзакции одним запросом
        all_tickers = [item.ticker.upper() for item in unique_items]
        all_transactions_dict = {}
        if all_tickers:
            all_transactions_list = db_session.query(Transaction).filter(
                Transaction.ticker.in_(all_tickers),
                Transaction.user_id == current_user.id
            ).order_by(Transaction.date.asc()).all()
            
            # Группируем транзакции по тикерам
            for trans in all_transactions_list:
                ticker_upper = trans.ticker.upper()
                if ticker_upper not in all_transactions_dict:
                    all_transactions_dict[ticker_upper] = []
                all_transactions_dict[ticker_upper].append(trans)
        
        # Оптимизация: загружаем историю цен для расчета изменений одним запросом
        price_history_cache = {}
        now_moscow = datetime.now(pytz.timezone('Europe/Moscow'))
        today_start = now_moscow.replace(hour=0, minute=0, second=0, microsecond=0)
        yesterday_start = today_start - timedelta(days=1)
        yesterday_end = today_start
        
        # Загружаем последние записи за сегодня и вчера для всех тикеров (для change_days=1 или не задан)
        if not change_days or change_days == 1:
            today_entries = db_session.query(PriceHistory).filter(
                PriceHistory.ticker.in_(all_tickers),
                PriceHistory.logged_at >= today_start
            ).order_by(PriceHistory.ticker, PriceHistory.logged_at.desc()).all()
            
            yesterday_entries = db_session.query(PriceHistory).filter(
                PriceHistory.ticker.in_(all_tickers),
                PriceHistory.logged_at >= yesterday_start,
                PriceHistory.logged_at < yesterday_end
            ).order_by(PriceHistory.ticker, PriceHistory.logged_at.desc()).all()
            
            # Группируем по тикерам (берем только первую запись для каждого тикера)
            seen_today = set()
            seen_yesterday = set()
            for entry in today_entries:
                ticker_upper = entry.ticker.upper()
                if ticker_upper not in seen_today:
                    if ticker_upper not in price_history_cache:
                        price_history_cache[ticker_upper] = {'today': None, 'yesterday': None}
                    price_history_cache[ticker_upper]['today'] = entry
                    seen_today.add(ticker_upper)
            
            for entry in yesterday_entries:
                ticker_upper = entry.ticker.upper()
                if ticker_upper not in seen_yesterday:
                    if ticker_upper not in price_history_cache:
                        price_history_cache[ticker_upper] = {'today': None, 'yesterday': None}
                    price_history_cache[ticker_upper]['yesterday'] = entry
                    seen_yesterday.add(ticker_upper)
        
        # Подготавливаем данные для параллельных запросов
        items_data = []
        for item in unique_items:
            # Определяем тип инструмента
            instrument_type = item.instrument_type.name if hasattr(item, 'instrument_type') and item.instrument_type else 'STOCK'
            
            # Дополнительная проверка: если тикер облигации (начинается с RU или SU), но тип не определен
            if instrument_type == 'STOCK' and (item.ticker.startswith('RU') or item.ticker.startswith('SU')) and len(item.ticker) > 10:
                # Вероятно, это облигация (тикеры облигаций обычно длинные и начинаются с RU или SU)
                instrument_type = 'BOND'
            
            types_to_try = [instrument_type]
            if instrument_type == 'STOCK':
                types_to_try.append('BOND')
            elif instrument_type == 'BOND':
                types_to_try.append('STOCK')
            
            items_data.append({
                'item': item,
                'instrument_type': instrument_type,
                'types_to_try': types_to_try
            })
        
        # Параллельно получаем цены и информацию о лотах для всех элементов,
        # если явно не запрещено дергать MOEX API.
        price_data_cache = {}
        security_info_cache = {}
        
        if not use_cached:
            def fetch_price_data(data):
                """Получить данные о цене для одного элемента"""
                item = data['item']
                types_to_try = data['types_to_try']
                current_price_data = None
                for itype in types_to_try:
                    current_price_data = moex_service.get_current_price(item.ticker, itype)
                    if current_price_data:
                        break
                return item.ticker, current_price_data
            
            def fetch_security_info(data):
                """Получить информацию о лотах для одного элемента"""
                item = data['item']
                instrument_type = data['instrument_type']
                security_info = moex_service.get_security_info(item.ticker, instrument_type)
                return item.ticker, security_info
            
            # Выполняем запросы параллельно
            with ThreadPoolExecutor(max_workers=10) as executor:
                # Запросы цен
                price_futures = {executor.submit(fetch_price_data, data): data for data in items_data}
                # Запросы информации о лотах
                security_futures = {executor.submit(fetch_security_info, data): data for data in items_data}
                
                # Собираем результаты цен
                for future in as_completed(price_futures):
                    ticker, price_data = future.result()
                    price_data_cache[ticker] = price_data
                
                # Собираем результаты информации о лотах
                for future in as_completed(security_futures):
                    ticker, security_info = future.result()
                    security_info_cache[ticker] = security_info
        else:
            # Режим без запросов к MOEX: берём последнюю цену из таблицы price_history.
            if all_tickers:
                # Получаем последние записи для всех тикеров одним запросом
                from sqlalchemy import func
                subq = db_session.query(
                    PriceHistory.ticker,
                    func.max(PriceHistory.logged_at).label('max_logged_at')
                ).filter(
                    PriceHistory.ticker.in_(all_tickers)
                ).group_by(PriceHistory.ticker).subquery()

                latest_history = db_session.query(PriceHistory).join(
                    subq,
                    (PriceHistory.ticker == subq.c.ticker) &
                    (PriceHistory.logged_at == subq.c.max_logged_at)
                ).all()

                latest_history_map = {e.ticker.upper(): e for e in latest_history}
            else:
                latest_history_map = {}

            for data in items_data:
                item = data['item']
                # Приоритет: сохранённая цена из портфеля (обновляется при каждом запросе к MOEX)
                if hasattr(item, 'current_price') and item.current_price:
                    price_data_cache[item.ticker] = {
                        'price': item.current_price,
                        'last_update': item.current_price_updated_at.isoformat() if item.current_price_updated_at else '',
                        'decimals': None,
                    }
                else:
                    # Fallback: последняя запись из price_history
                    entry = latest_history_map.get(item.ticker.upper())
                    if entry:
                        price_data_cache[item.ticker] = {
                            'price': entry.price,
                            'last_update': entry.logged_at.isoformat(),
                            'decimals': None,
                        }
                    else:
                        price_data_cache[item.ticker] = None
                # В cached-режиме берём lotsize из сохранённого в Portfolio
                security_info_cache[item.ticker] = {
                    'trading_params': {'lotsize': item.lotsize or 1}
                } if item.lotsize else None
        
        # Обрабатываем каждый элемент с использованием кэшированных данных
        for data in items_data:
            item = data['item']
            instrument_type = data['instrument_type']
            
            # Получаем актуальную цену с MOEX из кэша
            current_price_data = price_data_cache.get(item.ticker)
            
            # Получаем информацию о размере лота из кэша
            lotsize = 1  # По умолчанию 1
            security_info = security_info_cache.get(item.ticker)
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
            
            # Получаем decimals для форматирования цен
            price_decimals = None
            if current_price_data:
                current_price = current_price_data.get('price', 0)
                last_update = current_price_data.get('last_update', '')
                price_decimals = current_price_data.get('decimals')  # Количество знаков после запятой
                # Обновляем номинал и валюту из API, если они есть
                if instrument_type == 'BOND' and current_price_data.get('facevalue'):
                    bond_facevalue = current_price_data.get('facevalue', bond_facevalue or 1000.0)
                    bond_currency = current_price_data.get('currency_id', bond_currency or 'SUR')
                    # Обновляем в базе, если изменились
                    if hasattr(item, 'bond_facevalue') and (item.bond_facevalue != bond_facevalue or item.bond_currency != bond_currency):
                        item.bond_facevalue = bond_facevalue
                        item.bond_currency = bond_currency
                        db_session.commit()
                # Сохраняем свежую цену и lotsize в БД, чтобы при перезагрузке страницы
                # (use_cached=1) использовались актуальные данные
                if not use_cached and current_price and current_price > 0:
                    item.current_price = current_price
                    item.current_price_updated_at = datetime.now()
                    if lotsize and lotsize > 0:
                        item.lotsize = lotsize
                    db_session.commit()
            else:
                # Если цена не получена от MOEX — берём сохранённую в БД
                if hasattr(item, 'current_price') and item.current_price:
                    current_price = item.current_price
                    last_update = item.current_price_updated_at.isoformat() if item.current_price_updated_at else ''
                else:
                    current_price = item.average_buy_price if hasattr(item, 'average_buy_price') else 0
                    last_update = ''
            
            # Вычисляем среднюю цену покупки из истории транзакций
            # Используем ту же логику, что и в recalculate_portfolio_for_ticker
            # Учитываем только те покупки, которые не были полностью проданы
            # Используем кэшированные транзакции
            all_transactions = all_transactions_dict.get(item.ticker.upper(), [])
            
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
            total_cost_from_transactions = None
            total_buy_quantity = 0
            if relevant_buy_transactions:
                # Цены в транзакциях уже в рублях (как ввел пользователь)
                total_cost_from_transactions = sum(price * quantity for price, quantity in relevant_buy_transactions)
                total_buy_quantity = sum(quantity for _, quantity in relevant_buy_transactions)
                calculated_avg_price = total_cost_from_transactions / total_buy_quantity if total_buy_quantity > 0 else item.average_buy_price
            else:
                # Если нет релевантных транзакций, используем цену из портфеля
                calculated_avg_price = item.average_buy_price
            
            # Получаем данные истории цен для расчета изменения
            # latest_price = current_price (та же цена, что отображается в "Текущая стоимость")
            # previous_price = самая ранняя запись в истории за выбранный период
            bond_nominal = bond_facevalue if bond_facevalue else 1000.0

            # Конечная точка — текущая цена актива (в тех же единицах, что и история:
            # проценты для облигаций, рубли для акций)
            latest_price = current_price if current_price_data else None
            previous_price = None

            if change_days and change_days > 0:
                if change_days == 1:
                    # День: предыдущая цена — последняя запись за сегодня (из кэша)
                    ticker_history = price_history_cache.get(item.ticker.upper(), {})
                    latest_entry_today = ticker_history.get('today')

                    if latest_entry_today:
                        previous_price = latest_entry_today.price
                    else:
                        # Нет сегодняшней — любая последняя доступная запись
                        any_previous = db_session.query(PriceHistory).filter(
                            PriceHistory.ticker == item.ticker
                        ).order_by(PriceHistory.logged_at.desc()).first()
                        previous_price = any_previous.price if any_previous else latest_price
                else:
                    # Неделя, месяц и т.д.: предыдущая цена — самая старая запись за период
                    period_start = datetime.now() - timedelta(days=change_days)
                    oldest_entry = db_session.query(PriceHistory).filter(
                        PriceHistory.ticker == item.ticker,
                        PriceHistory.logged_at >= period_start
                    ).order_by(PriceHistory.logged_at.asc()).first()

                    if oldest_entry:
                        previous_price = oldest_entry.price
                    else:
                        # Нет записей за период — берём самую свежую доступную
                        any_entry = db_session.query(PriceHistory).filter(
                            PriceHistory.ticker == item.ticker
                        ).order_by(PriceHistory.logged_at.desc()).first()
                        previous_price = any_entry.price if any_entry else latest_price
            else:
                # Без периода — дневное изменение (аналогично change_days == 1)
                ticker_history = price_history_cache.get(item.ticker.upper(), {})
                latest_entry_today = ticker_history.get('today')

                if latest_entry_today:
                    previous_price = latest_entry_today.price
                else:
                    any_previous = db_session.query(PriceHistory).filter(
                        PriceHistory.ticker == item.ticker
                    ).order_by(PriceHistory.logged_at.desc()).first()
                    previous_price = any_previous.price if any_previous else latest_price

            # Рассчитываем изменение: разница между предыдущей и последней ценой
            # Для облигаций цены в истории хранятся в процентах, для акций - в рублях
            if latest_price is not None and previous_price is not None:
                # Для облигаций рассчитываем изменение
                if instrument_type == 'BOND':
                    # Для облигаций процентное изменение рассчитывается ПРЯМО из процентов
                    # (не через конвертацию в валюту номинала)
                    price_change_percent = latest_price - previous_price
                    
                    # Изменение в деньгах: переводим проценты в цену в валюте номинала
                    latest_price_in_nominal = (latest_price * bond_nominal) / 100
                    previous_price_in_nominal = (previous_price * bond_nominal) / 100
                    # Изменение в валюте номинала
                    price_change_in_nominal = latest_price_in_nominal - previous_price_in_nominal
                    # Пока что price_change в валюте номинала, конвертация в рубли будет ниже
                    price_change = price_change_in_nominal
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
            
            # Используем реальную сумму из транзакций для точности (избегаем ошибок округления)
            # Если количество в портфеле равно количеству из транзакций - используем total_cost напрямую
            # Иначе пропорционально пересчитываем
            if total_cost_from_transactions is not None and total_buy_quantity > 0:
                if abs(item.quantity - total_buy_quantity) < 0.01:  # Практически равны (с учетом округления)
                    total_buy_cost = total_cost_from_transactions
                else:
                    # Пропорционально пересчитываем стоимость покупки для текущего количества
                    # (если были продажи, часть бумаг уже продана)
                    total_buy_cost = (total_cost_from_transactions / total_buy_quantity) * item.quantity
            else:
                # Если нет транзакций, используем расчет через среднюю цену
                total_buy_cost = item.quantity * avg_price_rub
            
            profit_loss = total_current_value - total_buy_cost
            profit_loss_percent = ((current_price_rub - avg_price_rub) / avg_price_rub * 100) if avg_price_rub > 0 else 0
            
            # Для облигаций переводим price_change в рубли с учетом валюты номинала
            if instrument_type == 'BOND':
                # price_change уже рассчитан как разница в валюте номинала (строки 512-513)
                # Теперь нужно применить конвертацию валюты, если валюта не RUB
                if bond_currency and bond_currency != 'SUR' and bond_currency != 'RUB':
                    try:
                        fx_rate_change = currency_service.get_rate_to_rub(bond_currency)
                    except Exception:
                        fx_rate_change = 1.0
                else:
                    fx_rate_change = 1.0
                price_change_rub = price_change * fx_rate_change
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
                'date_added': item.date_added.isoformat() if item.date_added else None,
                'price_decimals': price_decimals  # Количество знаков после запятой для форматирования цен
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
        
        # Получаем баланс свободных денег текущего пользователя
        balance = db_session.query(CashBalance).filter_by(user_id=current_user.id).first()
        if not balance:
            balance = CashBalance(user_id=current_user.id, balance=0.0)
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
        
        # Проверяем, есть ли уже такой тикер у текущего пользователя
        existing = db_session.query(Portfolio).filter_by(ticker=ticker, user_id=current_user.id).first()
        
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
                user_id=current_user.id,
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
        item = db_session.query(Portfolio).filter_by(id=item_id, user_id=current_user.id).first()
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
        item = db_session.query(Portfolio).filter_by(id=item_id, user_id=current_user.id).first()
        if not item:
            # Позиция уже удалена (возможно, автоматически при пересчете после транзакции)
            # Возвращаем успех, чтобы не показывать ошибку пользователю
            return jsonify({
                'success': True,
                'message': 'Позиция уже была удалена'
            })
        
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
        
        # Обновляем категорию для всех записей с этим тикером у текущего пользователя
        portfolio_items = db_session.query(Portfolio).filter(
            Portfolio.ticker == ticker, Portfolio.user_id == current_user.id
        ).all()
        
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
        portfolio_item = db_session.query(Portfolio).filter(
            Portfolio.ticker == ticker, Portfolio.user_id == current_user.id
        ).first()
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


@app.route('/api/server-status', methods=['GET'])
def get_server_status():
    """
    Простой мониторинг сервера:
    - Место на диске (в корне файловой системы)
    - Папка приложения
    - Размер файла базы данных (если есть)
    - Опционально (если установлен psutil): загрузка CPU и использование памяти
    """
    try:
        # Дисковое пространство для корневого раздела
        disk_usage = shutil.disk_usage(os.path.abspath(os.sep))
        total_gb = round(disk_usage.total / (1024 ** 3), 2)
        used_gb = round(disk_usage.used / (1024 ** 3), 2)
        free_gb = round(disk_usage.free / (1024 ** 3), 2)
        used_percent = round(disk_usage.used / disk_usage.total * 100, 1) if disk_usage.total > 0 else 0

        # Папка приложения
        app_path = os.path.abspath(os.path.dirname(__file__))

        # Размер файла базы данных (если существует)
        db_path = os.path.join(app_path, 'portfolio.db')
        db_size_mb = None
        if os.path.exists(db_path):
            db_size_mb = round(os.path.getsize(db_path) / (1024 ** 2), 2)

        cpu_percent = None
        memory_percent = None
        try:
            import psutil  # type: ignore
            cpu_percent = psutil.cpu_percent(interval=0.1)
            memory_percent = psutil.virtual_memory().percent
        except ImportError:
            # psutil не установлен — просто не возвращаем эти поля
            pass

        return jsonify({
            'success': True,
            'disk': {
                'total_gb': total_gb,
                'used_gb': used_gb,
                'free_gb': free_gb,
                'used_percent': used_percent
            },
            'app': {
                'path': app_path,
                'db_path': db_path if os.path.exists(db_path) else None,
                'db_size_mb': db_size_mb
            },
            'system': {
                'cpu_percent': cpu_percent,
                'memory_percent': memory_percent
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/download-db', methods=['GET'])
def download_db():
    """Скачать файл базы данных portfolio.db"""
    import tempfile
    app_path = os.path.abspath(os.path.dirname(__file__))
    db_path = os.path.join(app_path, 'portfolio.db')
    if not os.path.exists(db_path):
        return jsonify({'success': False, 'error': 'База данных не найдена'}), 404
    # Копируем во временный файл, чтобы обойти блокировку SQLite
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix='.db')
    tmp.close()
    shutil.copy2(db_path, tmp.name)
    return send_file(
        tmp.name,
        as_attachment=True,
        download_name='portfolio.db',
        mimetype='application/octet-stream'
    )


@app.route('/api/access-logs', methods=['GET'])
@login_required
def get_access_logs():
    """Получить логи доступа (только для авторизованных пользователей)"""
    try:
        limit = request.args.get('limit', default=100, type=int)
        logs = (
            db_session.query(AccessLog)
            .order_by(AccessLog.timestamp.desc())
            .limit(limit)
            .all()
        )
        return jsonify({
            'success': True,
            'logs': [log.to_dict() for log in logs],
            'total': db_session.query(AccessLog).count()
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


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
        query = db_session.query(Transaction).filter(Transaction.user_id == current_user.id)
        
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
        
        # Проверку на дубликаты отключили по запросу: одинаковые транзакции разрешены.
        
        # Создание новой транзакции
        transaction = Transaction(
            date=transaction_date,
            ticker=data['ticker'].upper(),
            user_id=current_user.id,
            company_name=data.get('company_name', ''),
            operation_type=operation_type,
            price=price,
            quantity=quantity,
            total=total,
            instrument_type=instrument_type,
            notes=data.get('notes', '')
        )
        
        db_session.add(transaction)
        
        # Обновляем баланс свободных денег текущего пользователя
        balance = db_session.query(CashBalance).filter_by(user_id=current_user.id).first()
        if not balance:
            balance = CashBalance(user_id=current_user.id, balance=0.0)
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
        
        # Пересчитываем портфель для этого тикера после добавления транзакции
        recalculate_portfolio_for_ticker(data['ticker'].upper(), user_id=current_user.id)
        
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
        transaction = db_session.query(Transaction).filter(
            Transaction.id == transaction_id,
            Transaction.user_id == current_user.id
        ).first()
        
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
        recalculate_portfolio_for_ticker(new_ticker, user_id=current_user.id)
        
        # Если тикер изменился, пересчитываем и для старого тикера
        if old_ticker != new_ticker:
            recalculate_portfolio_for_ticker(old_ticker, user_id=current_user.id)
        
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


def recalculate_portfolio_for_ticker(ticker, user_id=None):
    """
    Пересчитать портфель для указанного тикера на основе всех транзакций
    Учитывает только те транзакции покупки, которые не были полностью проданы.
    Если позиция была полностью продана (количество = 0), при следующей покупке
    средняя цена считается с нуля от новых транзакций.
    """
    try:
        # Получаем все транзакции для тикера, отсортированные по дате (от старых к новым)
        txn_query = db_session.query(Transaction).filter(Transaction.ticker == ticker.upper())
        if user_id is not None:
            txn_query = txn_query.filter(Transaction.user_id == user_id)
        all_transactions = txn_query.order_by(Transaction.date.asc()).all()
        
        # Находим позицию в портфеле
        # Проверяем на дубликаты: если есть несколько записей для одного тикера, удаляем лишние
        pf_query = db_session.query(Portfolio).filter_by(ticker=ticker.upper())
        if user_id is not None:
            pf_query = pf_query.filter(Portfolio.user_id == user_id)
        portfolio_items = pf_query.all()
        portfolio_item = None
        if len(portfolio_items) > 1:
            # Есть дубликаты - оставляем первую запись, остальные удаляем
            portfolio_item = portfolio_items[0]
            for duplicate in portfolio_items[1:]:
                db_session.delete(duplicate)
            db_session.commit()
        elif len(portfolio_items) == 1:
            portfolio_item = portfolio_items[0]
        
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
            # Если количество <= 0, удаляем все позиции для этого тикера из портфеля
            del_query = db_session.query(Portfolio).filter_by(ticker=ticker.upper())
            if user_id is not None:
                del_query = del_query.filter(Portfolio.user_id == user_id)
            for item_to_delete in del_query.all():
                db_session.delete(item_to_delete)
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
                    user_id=user_id,
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
        transaction = db_session.query(Transaction).filter(
            Transaction.id == transaction_id,
            Transaction.user_id == current_user.id
        ).first()
        
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
        balance = db_session.query(CashBalance).filter_by(user_id=current_user.id).first()
        if not balance:
            balance = CashBalance(user_id=current_user.id, balance=0.0)
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
        recalculate_portfolio_for_ticker(ticker, user_id=current_user.id)
        
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
        balance = db_session.query(CashBalance).filter_by(user_id=current_user.id).first()
        if not balance:
            balance = CashBalance(user_id=current_user.id, balance=0.0)
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
        
        # Устанавливаем ограничение по умолчанию, если не указано явно
        if limit:
            filter_params['limit'] = limit
        else:
            # По умолчанию ограничиваем до 500 записей для всех тикеров
            # Для конкретного тикера ограничение не ставим, чтобы показать всю историю
            if not ticker:
                filter_params['limit'] = 500
        
        if ticker:
            # История для конкретного тикера
            history = price_logger.get_price_history(ticker=ticker, **filter_params)

            # Даже если по ошибке за один день записалось несколько значений,
            # для отображения и расчетов оставляем только ПОСЛЕДНЮЮ запись
            # за каждый день (в том числе за сегодня).
            deduplicated = []
            seen_dates = set()

            for item in history:
                # logged_at в формате "YYYY-MM-DD HH:MM:SS"
                logged_at = item.get('logged_at', '')
                date_part = logged_at.split(' ')[0] if logged_at else ''

                # history уже отсортирован от новых к старым, поэтому
                # первая встреченная дата — самая свежая запись за этот день.
                if date_part and date_part not in seen_dates:
                    deduplicated.append(item)
                    seen_dates.add(date_part)

            history = deduplicated
        else:
            # История для всех тикеров, сгруппированная по датам
            history = price_logger.get_price_history_grouped(**filter_params)
        
        # Для облигаций добавляем информацию о номинале и валюте из портфеля
        # и конвертируем цену в рубли
        # Создаем словарь с данными об облигациях из портфеля текущего пользователя
        bond_info = {}
        portfolio_items = db_session.query(Portfolio).filter(Portfolio.user_id == current_user.id).all()
        for item in portfolio_items:
            # Проверяем, является ли инструмент облигацией
            is_bond = False
            if hasattr(item, 'instrument_type') and item.instrument_type:
                if isinstance(item.instrument_type, InstrumentType):
                    is_bond = item.instrument_type == InstrumentType.BOND
                elif isinstance(item.instrument_type, str):
                    is_bond = item.instrument_type == 'Облигация' or item.instrument_type == 'BOND'
            
            # Также проверяем по тикеру (облигации обычно начинаются с RU или SU и длинные)
            if not is_bond and (item.ticker.startswith('RU') or item.ticker.startswith('SU')) and len(item.ticker) > 10:
                is_bond = True
            
            if is_bond:
                ticker_key = item.ticker.upper()  # Нормализуем тикер
                bond_facevalue = item.bond_facevalue if hasattr(item, 'bond_facevalue') and item.bond_facevalue else 1000.0
                bond_currency = item.bond_currency if hasattr(item, 'bond_currency') and item.bond_currency else 'SUR'
                bond_info[ticker_key] = {
                    'bond_facevalue': bond_facevalue,
                    'bond_currency': bond_currency
                }
        
        # Добавляем информацию о номинале и валюте к каждому элементу истории
        # и конвертируем цену в рубли для облигаций.
        # Признак облигации определяем по тикеру (bond_info), а не по instrument_type
        # в истории — старые записи могут хранить неверный тип.
        def process_history_item(item):
            ticker = item.get('ticker', '').upper()
            is_bond = (
                item.get('instrument_type') == 'Облигация'
                or ticker in bond_info
            )
            if is_bond:
                if ticker in bond_info:
                    bond_facevalue = bond_info[ticker]['bond_facevalue']
                    bond_currency = bond_info[ticker]['bond_currency']
                else:
                    bond_facevalue = 1000.0
                    bond_currency = 'SUR'
                
                # Конвертируем проценты в цену в валюте номинала
                price_percent = item.get('price', 0)
                if price_percent:
                    price_in_nominal_currency = (price_percent * bond_facevalue) / 100
                else:
                    price_in_nominal_currency = 0
                
                # Конвертируем в рубли, если валюта не RUB/SUR
                if bond_currency and bond_currency != 'SUR' and bond_currency != 'RUB':
                    try:
                        fx_rate = currency_service.get_rate_to_rub(bond_currency)
                        if fx_rate and fx_rate > 0:
                            price_in_rub = price_in_nominal_currency * fx_rate
                        else:
                            # Если курс не получен или равен 0, используем цену как есть
                            print(f"[WARNING] Некорректный курс для {bond_currency}: {fx_rate}, используем цену в валюте номинала")
                            price_in_rub = price_in_nominal_currency
                    except Exception as e:
                        # Если не удалось получить курс, используем цену как есть
                        print(f"[WARNING] Не удалось получить курс для {bond_currency}: {e}, используем цену в валюте номинала")
                        price_in_rub = price_in_nominal_currency
                else:
                    price_in_rub = price_in_nominal_currency
                
                # Сохраняем оригинальную цену в процентах и добавляем цену в рублях
                # Всегда добавляем price_rub для облигаций
                item['price_rub'] = round(price_in_rub, 2) if price_in_rub else 0
        
        if isinstance(history, list):
            # История для конкретного тикера
            for item in history:
                process_history_item(item)
        elif isinstance(history, dict):
            # Сгруппированная история
            for date_key in history:
                if isinstance(history[date_key], list):
                    for item in history[date_key]:
                        process_history_item(item)
        
        response = jsonify({
            'success': True,
            'history': history,
            'ticker': ticker,
            'filters': filter_params
        })
        # Отключаем кэширование, чтобы всегда получать актуальные данные с конвертацией
        response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
        return response
        
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
        categories = db_session.query(Category).filter_by(user_id=current_user.id).order_by(Category.name).all()
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
        
        # Проверяем, не существует ли уже такая категория у текущего пользователя
        existing = db_session.query(Category).filter_by(name=name, user_id=current_user.id).first()
        if existing:
            return jsonify({
                'success': False,
                'error': 'Категория с таким названием уже существует'
            }), 400
        
        new_category = Category(name=name, user_id=current_user.id)
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
        category = db_session.query(Category).filter_by(id=category_id, user_id=current_user.id).first()
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
        
        # Проверяем, не существует ли уже категория с таким названием у текущего пользователя
        existing = db_session.query(Category).filter_by(
            name=new_name, user_id=current_user.id
        ).filter(Category.id != category_id).first()
        if existing:
            return jsonify({
                'success': False,
                'error': 'Категория с таким названием уже существует'
            }), 400
        
        old_name = category.name
        category.name = new_name
        db_session.commit()
        
        # Обновляем все позиции портфеля текущего пользователя
        db_session.query(Portfolio).filter_by(
            category=old_name, user_id=current_user.id
        ).update({'category': new_name})
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
        category = db_session.query(Category).filter_by(id=category_id, user_id=current_user.id).first()
        if not category:
            return jsonify({
                'success': False,
                'error': 'Категория не найдена'
            }), 404
        
        category_name = category.name
        
        # Удаляем категорию из позиций портфеля текущего пользователя
        db_session.query(Portfolio).filter_by(
            category=category_name, user_id=current_user.id
        ).update({'category': None})
        
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
        asset_types = db_session.query(AssetType).filter_by(user_id=current_user.id).order_by(AssetType.name).all()
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
        
        # Проверяем, не существует ли уже такой вид актива у текущего пользователя
        existing = db_session.query(AssetType).filter_by(name=name, user_id=current_user.id).first()
        if existing:
            return jsonify({
                'success': False,
                'error': 'Вид актива с таким названием уже существует'
            }), 400
        
        new_asset_type = AssetType(name=name, user_id=current_user.id)
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
        asset_type = db_session.query(AssetType).filter_by(id=asset_type_id, user_id=current_user.id).first()
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
        
        # Проверяем, не существует ли уже вид актива с таким названием у текущего пользователя
        existing = db_session.query(AssetType).filter_by(
            name=new_name, user_id=current_user.id
        ).filter(AssetType.id != asset_type_id).first()
        if existing:
            return jsonify({
                'success': False,
                'error': 'Вид актива с таким названием уже существует'
            }), 400
        
        old_name = asset_type.name
        asset_type.name = new_name
        db_session.commit()
        
        # Обновляем все позиции портфеля текущего пользователя
        db_session.query(Portfolio).filter_by(
            asset_type=old_name, user_id=current_user.id
        ).update({'asset_type': new_name})
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
        asset_type = db_session.query(AssetType).filter_by(id=asset_type_id, user_id=current_user.id).first()
        if not asset_type:
            return jsonify({
                'success': False,
                'error': 'Вид актива не найден'
            }), 404
        
        asset_type_name = asset_type.name
        
        # Удаляем вид актива из позиций портфеля текущего пользователя
        db_session.query(Portfolio).filter_by(
            asset_type=asset_type_name, user_id=current_user.id
        ).update({'asset_type': None})
        
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


@app.route('/api/hard-reset-portfolio', methods=['POST'])
@login_required
def hard_reset_portfolio():
    """
    Hard-reset: удалить все позиции, транзакции и обнулить кэш-баланс текущего пользователя.
    История цен (PriceHistory) не затрагивается.
    Требует подтверждения паролем пользователя.
    """
    data = request.get_json() or {}
    password = data.get('password', '')

    if not password:
        return jsonify({'success': False, 'error': 'Пароль не указан'}), 400

    if not current_user.check_password(password):
        return jsonify({'success': False, 'error': 'Неверный пароль'}), 403

    try:
        user_id = current_user.id

        portfolio_count = db_session.query(Portfolio).filter_by(user_id=user_id).count()
        transactions_count = db_session.query(Transaction).filter_by(user_id=user_id).count()

        db_session.query(Transaction).filter_by(user_id=user_id).delete()
        db_session.query(Portfolio).filter_by(user_id=user_id).delete()

        cash = db_session.query(CashBalance).filter_by(user_id=user_id).first()
        if cash:
            cash.balance = 0.0

        db_session.commit()

        write_access_log('hard_reset', username=current_user.username, success=True)

        return jsonify({
            'success': True,
            'deleted': {
                'portfolio': portfolio_count,
                'transactions': transactions_count,
                'cash_balance_reset': True
            },
            'message': (
                f'Hard-reset выполнен: удалено {portfolio_count} позиций портфеля, '
                f'{transactions_count} транзакций, баланс сброшен в 0.'
            )
        })
    except Exception as e:
        db_session.rollback()
        return jsonify({'success': False, 'error': str(e)}), 500


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
