"""
Сервис для логирования цен акций
"""
from datetime import datetime
from models.database import db_session
from models.portfolio import Portfolio
from models.price_history import PriceHistory
from services.moex_service import MOEXService
import pytz
import threading


class PriceLogger:
    """
    Сервис для логирования истории цен акций
    
    Сохраняет текущие цены всех акций из портфеля в БД
    """
    
    def __init__(self, moex_service: MOEXService):
        self.moex_service = moex_service
        self.moscow_tz = pytz.timezone('Europe/Moscow')
        self._logging_lock = threading.Lock()  # Защита от одновременного выполнения
    
    def log_all_prices(self, force=False):
        """
        Логирование цен для всех уникальных тикеров в портфеле
        
        Вызывается ежедневно в 00:00 МСК планировщиком или периодически каждые 3 часа
        Защищено от дублирования: проверяет, были ли уже залогированы цены сегодня
        
        Args:
            force: Если True, логирует цены даже если запись за сегодня уже есть
        """
        # Защита от одновременного выполнения
        if not self._logging_lock.acquire(blocking=False):
            moscow_time = datetime.now(self.moscow_tz)
            print(f"[{moscow_time}] Логирование уже выполняется, пропускаем дубликат")
            return
        
        try:
            moscow_time = datetime.now(self.moscow_tz)
            print(f"[{moscow_time}] ===== НАЧАЛО ЛОГИРОВАНИЯ ЦЕН =====")
            print(f"[{moscow_time}] Принудительное логирование: {force}")
            from datetime import date, timedelta
            
            # Получаем все уникальные тикеры из портфеля
            portfolio_items = db_session.query(Portfolio).all()
            
            if not portfolio_items:
                print(f"[{datetime.now(self.moscow_tz)}] Портфель пуст, нечего логировать")
                return
            
            # Собираем уникальные тикеры с типами инструментов
            unique_tickers = {}
            for item in portfolio_items:
                if item.ticker not in unique_tickers:
                    instrument_type = item.instrument_type.name if hasattr(item, 'instrument_type') and item.instrument_type else 'STOCK'
                    unique_tickers[item.ticker] = {
                        'company_name': item.company_name,
                        'instrument_type': instrument_type
                    }
            
            # Проверяем, были ли уже залогированы цены сегодня
            # Используем начало текущего дня по московскому времени
            now_moscow = datetime.now(self.moscow_tz)
            today_start = now_moscow.replace(hour=0, minute=0, second=0, microsecond=0)
            today_end = today_start + timedelta(days=1)
            
            # Проверяем наличие записей за сегодня для всех тикеров
            existing_logs_today = db_session.query(PriceHistory).filter(
                PriceHistory.logged_at >= today_start,
                PriceHistory.logged_at < today_end
            ).all()
            
            # Создаем множество тикеров, для которых уже есть записи сегодня
            tickers_logged_today = {log.ticker for log in existing_logs_today}
            
            # Если для всех тикеров уже есть записи сегодня и не принудительное логирование, пропускаем
            if not force and tickers_logged_today.issuperset(unique_tickers.keys()):
                print(f"[{datetime.now(self.moscow_tz)}] Цены уже залогированы сегодня для всех тикеров. Пропускаем дублирование.")
                return
            
            logged_count = 0
            skipped_count = 0
            
            # Логируем цену для каждого уникального тикера
            for ticker, ticker_info in unique_tickers.items():
                try:
                    # Пропускаем, если для этого тикера уже есть запись сегодня (если не принудительное логирование)
                    if not force and ticker in tickers_logged_today:
                        skipped_count += 1
                        print(f"[{datetime.now(self.moscow_tz)}] Пропуск {ticker}: цена уже залогирована сегодня")
                        continue
                    
                    company_name = ticker_info['company_name']
                    instrument_type = ticker_info['instrument_type']
                    
                    # Получаем текущую цену с MOEX
                    # Если для первого типа инструмента данных нет (например, тикер облигации помечен как STOCK),
                    # пробуем альтернативный тип, чтобы гарантировать получение цены
                    quote_data = None
                    types_to_try = [instrument_type]
                    if instrument_type == 'STOCK':
                        types_to_try.append('BOND')
                    elif instrument_type == 'BOND':
                        types_to_try.append('STOCK')
                    
                    used_instrument_type = instrument_type
                    for itype in types_to_try:
                        quote_data = self.moex_service.get_current_price(ticker, itype)
                        if quote_data:
                            used_instrument_type = itype
                            break
                    
                    if not quote_data:
                        print(f"[{datetime.now(self.moscow_tz)}] Не удалось получить данные для {ticker} (пробовали типы: {types_to_try})")
                        continue
                    
                    current_price = quote_data.get('price', 0)
                    
                    # Получаем последнюю запись из истории для расчета изменения
                    # Исключаем записи за сегодня, чтобы брать предыдущий день
                    last_history_entry = db_session.query(PriceHistory).filter(
                        PriceHistory.ticker == ticker,
                        PriceHistory.logged_at < today_start
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
                    
                    # Проверяем, нет ли уже записи для этого тикера в текущей минуте
                    # Это предотвращает дублирование при одновременных вызовах
                    now_moscow = datetime.now(self.moscow_tz)
                    current_minute_start = now_moscow.replace(second=0, microsecond=0)
                    current_minute_end = current_minute_start.replace(second=59, microsecond=999999)
                    
                    existing_in_minute = db_session.query(PriceHistory).filter(
                        PriceHistory.ticker == ticker,
                        PriceHistory.logged_at >= current_minute_start,
                        PriceHistory.logged_at <= current_minute_end
                    ).first()
                    
                    # Даже при принудительном логировании (force=True) не создаем
                    # несколько записей в одну и ту же минуту, чтобы избежать
                    # визуальных дублей в истории цен.
                    if existing_in_minute:
                        skipped_count += 1
                        print(f"[{datetime.now(self.moscow_tz)}] Пропуск {ticker}: запись уже существует в текущей минуте")
                        continue
                    
                    # Создаем запись в истории
                    from models.portfolio import InstrumentType
                    instrument_type_enum = InstrumentType[used_instrument_type] if used_instrument_type in ['STOCK', 'BOND'] else InstrumentType.STOCK
                    
                    price_log = PriceHistory(
                        ticker=ticker,
                        company_name=company_name,
                        price=current_price,
                        change=round(price_change, 2),
                        change_percent=round(price_change_percent, 2),
                        volume=quote_data.get('volume', 0),
                        instrument_type=instrument_type_enum,
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
            
            moscow_time = datetime.now(self.moscow_tz)
            if skipped_count > 0:
                print(f"[{moscow_time}] Успешно залогировано цен: {logged_count}/{len(unique_tickers)} (пропущено дубликатов: {skipped_count})")
            else:
                print(f"[{moscow_time}] Успешно залогировано цен: {logged_count}/{len(unique_tickers)}")
            print(f"[{moscow_time}] ===== ЛОГИРОВАНИЕ ЦЕН ЗАВЕРШЕНО =====")
            
        except Exception as e:
            moscow_time = datetime.now(self.moscow_tz)
            print(f"[{moscow_time}] ОШИБКА при логировании цен: {e}")
            import traceback
            traceback.print_exc()
            db_session.rollback()
        finally:
            # Всегда освобождаем lock
            self._logging_lock.release()
    
    def get_price_history(self, ticker=None, days=None, date_from=None, date_to=None, limit=None):
        """
        Получить историю цен
        
        Args:
            ticker: Тикер акции (если None, возвращает все)
            days: Количество дней истории (если не указаны date_from/date_to)
            date_from: Дата начала (формат: YYYY-MM-DD)
            date_to: Дата окончания (формат: YYYY-MM-DD)
            limit: Максимальное количество записей (опционально)
            
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
            
            # Применяем limit, если указан
            if limit:
                query = query.limit(limit)
            
            results = query.all()
            
            return [item.to_dict() for item in results]
            
        except Exception as e:
            print(f"Ошибка получения истории цен: {e}")
            return []
    
    def get_price_history_grouped(self, days=None, date_from=None, date_to=None, limit=None):
        """
        Получить историю цен, сгруппированную по датам и тикерам
        Для каждого тикера в каждый день оставляется только последняя запись
        
        Args:
            days: Количество дней истории (если не указаны date_from/date_to)
            date_from: Дата начала (формат: YYYY-MM-DD)
            date_to: Дата окончания (формат: YYYY-MM-DD)
            limit: Максимальное количество записей (опционально)
            
        Returns:
            Словарь с историей цен, сгруппированной по датам
        """
        try:
            # Увеличиваем лимит, чтобы получить больше данных для дедупликации
            # После дедупликации останется меньше записей
            query_limit = limit * 3 if limit else None
            
            history = self.get_price_history(
                ticker=None,
                days=days,
                date_from=date_from,
                date_to=date_to,
                limit=query_limit,
            )
            
            # Дедуплицируем: для каждого тикера в каждый день оставляем только последнюю запись
            # Используем словарь (date, ticker) -> последняя запись
            deduplicated = {}
            for item in history:
                date = item['logged_at'].split(' ')[0]  # Только дата
                ticker = item.get('ticker', '')
                key = (date, ticker)
                
                # Если записи для этого ключа еще нет, или текущая запись новее - сохраняем её
                if key not in deduplicated:
                    deduplicated[key] = item
                else:
                    # Сравниваем время: если текущая запись новее, заменяем
                    current_time = item.get('logged_at', '')
                    existing_time = deduplicated[key].get('logged_at', '')
                    if current_time > existing_time:
                        deduplicated[key] = item
            
            # Группируем по датам
            grouped = {}
            for (date, ticker), item in deduplicated.items():
                if date not in grouped:
                    grouped[date] = []
                grouped[date].append(item)
            
            # Сортируем записи в каждой дате по времени (от новых к старым)
            for date in grouped:
                grouped[date].sort(key=lambda x: x.get('logged_at', ''), reverse=True)
            
            # Если был указан limit, ограничиваем общее количество записей
            if limit:
                total_items = sum(len(items) for items in grouped.values())
                if total_items > limit:
                    # Сортируем даты по убыванию и ограничиваем количество
                    sorted_dates = sorted(grouped.keys(), reverse=True)
                    remaining = limit
                    result = {}
                    for date in sorted_dates:
                        if remaining <= 0:
                            break
                        items = grouped[date]
                        if len(items) <= remaining:
                            result[date] = items
                            remaining -= len(items)
                        else:
                            result[date] = items[:remaining]
                            break
                    return result
            
            return grouped
            
        except Exception as e:
            print(f"Ошибка группировки истории цен: {e}")
            return {}
