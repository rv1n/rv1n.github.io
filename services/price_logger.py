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
                    
                    # Создаем запись в истории
                    price_log = PriceHistory(
                        ticker=ticker,
                        company_name=company_name,
                        price=quote_data.get('price', 0),
                        change=quote_data.get('change', 0),
                        change_percent=quote_data.get('change_percent', 0),
                        volume=quote_data.get('volume', 0),
                        logged_at=datetime.now(self.moscow_tz)
                    )
                    
                    db_session.add(price_log)
                    logged_count += 1
                    
                    print(f"[{datetime.now(self.moscow_tz)}] Залогирована цена для {ticker}: {quote_data.get('price')} ₽")
                    
                except Exception as e:
                    print(f"[{datetime.now(self.moscow_tz)}] Ошибка логирования цены для {ticker}: {e}")
                    continue
            
            # Сохраняем все изменения в БД
            db_session.commit()
            
            print(f"[{datetime.now(self.moscow_tz)}] Успешно залогировано цен: {logged_count}/{len(unique_tickers)}")
            
        except Exception as e:
            print(f"[{datetime.now(self.moscow_tz)}] Ошибка при логировании цен: {e}")
            db_session.rollback()
    
    def get_price_history(self, ticker=None, days=30):
        """
        Получить историю цен
        
        Args:
            ticker: Тикер акции (если None, возвращает все)
            days: Количество дней истории
            
        Returns:
            Список записей истории цен
        """
        try:
            query = db_session.query(PriceHistory)
            
            if ticker:
                query = query.filter(PriceHistory.ticker == ticker.upper())
            
            # Сортируем по дате (от новых к старым)
            query = query.order_by(PriceHistory.logged_at.desc())
            
            # Ограничиваем количество записей (примерно days записей на тикер)
            if ticker:
                query = query.limit(days)
            else:
                # Для всех тикеров берем больше записей
                query = query.limit(days * 50)  # 50 тикеров максимум
            
            results = query.all()
            
            return [item.to_dict() for item in results]
            
        except Exception as e:
            print(f"Ошибка получения истории цен: {e}")
            return []
    
    def get_price_history_grouped(self, days=30):
        """
        Получить историю цен, сгруппированную по датам и тикерам
        
        Args:
            days: Количество дней истории
            
        Returns:
            Словарь с историей цен, сгруппированной по датам
        """
        try:
            history = self.get_price_history(ticker=None, days=days)
            
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
