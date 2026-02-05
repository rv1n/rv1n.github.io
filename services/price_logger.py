"""
Сервис для логирования цен акций
"""
from datetime import datetime
from models.database import db_session
from models.portfolio import Portfolio
from models.price_history import PriceHistory
from services.moex_service import MOEXService
import pytz


class PriceLogger:
    """
    Сервис для логирования истории цен акций
    
    Сохраняет текущие цены всех акций из портфеля в БД
    """
    
    def __init__(self, moex_service: MOEXService):
        self.moex_service = moex_service
        self.moscow_tz = pytz.timezone('Europe/Moscow')
    
    def log_all_prices(self):
        """
        Логирование цен для всех уникальных тикеров в портфеле
        
        Вызывается ежедневно в 00:00 МСК планировщиком
        """
        try:
            # Получаем все уникальные тикеры из портфеля
            portfolio_items = db_session.query(Portfolio).all()
            
            if not portfolio_items:
                print(f"[{datetime.now(self.moscow_tz)}] Портфель пуст, нечего логировать")
                return
            
            # Собираем уникальные тикеры
            unique_tickers = {}
            for item in portfolio_items:
                if item.ticker not in unique_tickers:
                    unique_tickers[item.ticker] = item.company_name
            
            logged_count = 0
            
            # Логируем цену для каждого уникального тикера
            for ticker, company_name in unique_tickers.items():
                try:
                    # Получаем текущую цену с MOEX
                    quote_data = self.moex_service.get_current_price(ticker)
                    
                    if not quote_data:
                        print(f"[{datetime.now(self.moscow_tz)}] Не удалось получить данные для {ticker}")
                        continue
                    
                    current_price = quote_data.get('price', 0)
                    
                    # Получаем последнюю запись из истории для расчета изменения
                    last_history_entry = db_session.query(PriceHistory).filter(
                        PriceHistory.ticker == ticker
                    ).order_by(PriceHistory.logged_at.desc()).first()
                    
                    if last_history_entry and current_price > 0:
                        # Рассчитываем изменение относительно предыдущей записи
                        last_logged_price = last_history_entry.price
                        price_change = current_price - last_logged_price
                        price_change_percent = (price_change / last_logged_price * 100) if last_logged_price > 0 else 0
                    else:
                        # Если это первая запись, изменение = 0
                        price_change = 0
                        price_change_percent = 0
                    
                    # Создаем запись в истории
                    price_log = PriceHistory(
                        ticker=ticker,
                        company_name=company_name,
                        price=current_price,
                        change=round(price_change, 2),
                        change_percent=round(price_change_percent, 2),
                        volume=quote_data.get('volume', 0),
                        logged_at=datetime.now(self.moscow_tz)
                    )
                    
                    db_session.add(price_log)
                    logged_count += 1
                    
                    print(f"[{datetime.now(self.moscow_tz)}] Залогирована цена для {ticker}: {current_price} ₽ (изменение: {price_change:+.2f} ₽, {price_change_percent:+.2f}%)")
                    
                except Exception as e:
                    print(f"[{datetime.now(self.moscow_tz)}] Ошибка логирования цены для {ticker}: {e}")
                    continue
            
            # Сохраняем все изменения в БД
            db_session.commit()
            
            print(f"[{datetime.now(self.moscow_tz)}] Успешно залогировано цен: {logged_count}/{len(unique_tickers)}")
            
        except Exception as e:
            print(f"[{datetime.now(self.moscow_tz)}] Ошибка при логировании цен: {e}")
            db_session.rollback()
    
    def get_price_history(self, ticker=None, days=None, date_from=None, date_to=None):
        """
        Получить историю цен
        
        Args:
            ticker: Тикер акции (если None, возвращает все)
            days: Количество дней истории (если не указаны date_from/date_to)
            date_from: Дата начала (формат: YYYY-MM-DD)
            date_to: Дата окончания (формат: YYYY-MM-DD)
            
        Returns:
            Список записей истории цен
        """
        try:
            from datetime import datetime, timedelta
            
            query = db_session.query(PriceHistory)
            
            if ticker:
                query = query.filter(PriceHistory.ticker == ticker.upper())
            
            # Фильтрация по датам
            if date_from:
                date_from_dt = datetime.strptime(date_from, '%Y-%m-%d')
                query = query.filter(PriceHistory.logged_at >= date_from_dt)
            
            if date_to:
                date_to_dt = datetime.strptime(date_to, '%Y-%m-%d')
                # Добавляем 1 день, чтобы включить весь день date_to
                date_to_dt = date_to_dt + timedelta(days=1)
                query = query.filter(PriceHistory.logged_at < date_to_dt)
            
            # Если даты не указаны, используем days
            if not date_from and not date_to and days:
                cutoff_date = datetime.now() - timedelta(days=days)
                query = query.filter(PriceHistory.logged_at >= cutoff_date)
            
            # Сортируем по дате (от новых к старым)
            query = query.order_by(PriceHistory.logged_at.desc())
            
            results = query.all()
            
            return [item.to_dict() for item in results]
            
        except Exception as e:
            print(f"Ошибка получения истории цен: {e}")
            return []
    
    def get_price_history_grouped(self, days=None, date_from=None, date_to=None):
        """
        Получить историю цен, сгруппированную по датам и тикерам
        
        Args:
            days: Количество дней истории (если не указаны date_from/date_to)
            date_from: Дата начала (формат: YYYY-MM-DD)
            date_to: Дата окончания (формат: YYYY-MM-DD)
            
        Returns:
            Словарь с историей цен, сгруппированной по датам
        """
        try:
            history = self.get_price_history(ticker=None, days=days, date_from=date_from, date_to=date_to)
            
            # Группируем по датам
            grouped = {}
            for item in history:
                date = item['logged_at'].split(' ')[0]  # Только дата
                
                if date not in grouped:
                    grouped[date] = []
                
                grouped[date].append(item)
            
            return grouped
            
        except Exception as e:
            print(f"Ошибка группировки истории цен: {e}")
            return {}
