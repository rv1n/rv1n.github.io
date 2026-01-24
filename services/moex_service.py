"""
Сервис для работы с MOEX ISS API
Документация: https://www.moex.com/a2193
"""
import requests
from datetime import datetime, timedelta
from typing import Optional, Dict
import time


class MOEXService:
    """
    Сервис для получения данных с Московской биржи через ISS API
    
    Использует кэширование для оптимизации запросов (минимум 1-2 секунды)
    """
    
    BASE_URL = 'https://iss.moex.com/iss'
    CACHE_DURATION = timedelta(seconds=2)  # Кэш на 2 секунды
    
    def __init__(self):
        self._cache = {}  # Кэш для хранения последних запросов
        self._cache_timestamps = {}  # Временные метки кэша
    
    def _get_from_cache(self, ticker: str) -> Optional[Dict]:
        """
        Получить данные из кэша, если они еще актуальны
        
        Args:
            ticker: Тикер акции
            
        Returns:
            Словарь с данными или None, если кэш устарел
        """
        if ticker in self._cache:
            cache_time = self._cache_timestamps.get(ticker)
            if cache_time and datetime.now() - cache_time < self.CACHE_DURATION:
                return self._cache[ticker]
        return None
    
    def _save_to_cache(self, ticker: str, data: Dict):
        """
        Сохранить данные в кэш
        
        Args:
            ticker: Тикер акции
            data: Данные для кэширования
        """
        self._cache[ticker] = data
        self._cache_timestamps[ticker] = datetime.now()
    
    def _make_request(self, url: str, params: Optional[Dict] = None) -> Optional[Dict]:
        """
        Выполнить HTTP запрос к MOEX API с обработкой ошибок
        
        Args:
            url: URL для запроса
            params: Параметры запроса
            
        Returns:
            JSON ответ или None в случае ошибки
        """
        try:
            response = requests.get(url, params=params, timeout=5)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            print(f"Ошибка запроса к MOEX API: {e}")
            return None
        except Exception as e:
            print(f"Неожиданная ошибка при запросе к MOEX: {e}")
            return None
    
    def get_current_price(self, ticker: str) -> Optional[Dict]:
        """
        Получить текущую цену и данные по тикеру
        
        Использует endpoint: /iss/engines/stock/markets/shares/securities/{ticker}
        
        Args:
            ticker: Тикер акции (например, SBER, GAZP)
            
        Returns:
            Словарь с данными:
            {
                'price': float,           # Текущая цена
                'change': float,          # Изменение цены (абсолютное)
                'change_percent': float,  # Изменение цены (%)
                'volume': int,            # Объем торгов
                'last_update': str        # Время последнего обновления
            }
            или None в случае ошибки
        """
        ticker = ticker.upper().strip()
        
        # Проверяем кэш
        cached_data = self._get_from_cache(ticker)
        if cached_data:
            return cached_data
        
        # Формируем URL для запроса
        # Используем endpoint для получения информации о ценных бумагах
        url = f"{self.BASE_URL}/engines/stock/markets/shares/securities/{ticker}.json"
        
        # Параметры запроса: получаем данные о последней сделке
        params = {
            'iss.meta': 'off',  # Отключаем метаданные для ускорения
            'iss.json': 'extended',  # Расширенный формат JSON
            'securities.columns': 'SECID,LAST,OPEN,CHANGE,LASTTOPREVPRICE,VALTODAY',
            'marketdata.columns': 'LAST,OPEN,CHANGE,LASTTOPREVPRICE,VALTODAY'
        }
        
        data = self._make_request(url, params)
        
        if not data:
            return None
        
        try:
            # Структура ответа MOEX: [metadata, data]
            # data содержит словари с ключами: securities, marketdata
            # Каждая таблица - это массив объектов (словарей)
            # Первый элемент может быть заголовком, последний - актуальными данными
            if len(data) < 2:
                return None
            
            data_dict = data[1]
            securities_table = data_dict.get('securities', [])
            marketdata_table = data_dict.get('marketdata', [])
            
            # Парсим marketdata (более актуальные данные)
            # Берем последний элемент массива, так как он содержит актуальные данные
            marketdata_dict = {}
            if marketdata_table and isinstance(marketdata_table, list):
                # Ищем последний элемент с непустыми данными
                for item in reversed(marketdata_table):
                    if isinstance(item, dict) and item.get('LAST') is not None:
                        marketdata_dict = item
                        break
            
            # Парсим securities (резервные данные)
            securities_dict = {}
            if securities_table and isinstance(securities_table, list):
                # Берем последний элемент
                if len(securities_table) > 0:
                    last_item = securities_table[-1]
                    if isinstance(last_item, dict):
                        securities_dict = last_item
            
            # Получаем цену (приоритет marketdata, затем securities)
            last_price = marketdata_dict.get('LAST') or securities_dict.get('LAST')
            
            if last_price is None or last_price == '':
                return None
            
            try:
                last_price = float(last_price)
            except (ValueError, TypeError):
                return None
            
            # Получаем изменение цены
            change = marketdata_dict.get('CHANGE')
            if change is None:
                # Если CHANGE нет, используем LASTTOPREVPRICE
                change = marketdata_dict.get('LASTTOPREVPRICE', 0)
            
            try:
                change = float(change) if change is not None else 0
            except (ValueError, TypeError):
                change = 0
            
            # Получаем цену открытия для расчета процента
            open_price = marketdata_dict.get('OPEN')
            if open_price:
                try:
                    open_price = float(open_price)
                except (ValueError, TypeError):
                    open_price = None
            
            # Вычисляем процентное изменение
            if open_price and open_price > 0:
                change_percent = (change / open_price) * 100
            elif last_price > 0:
                # Если нет OPEN, используем LAST для приблизительного расчета
                change_percent = (change / last_price) * 100 if change else 0
            else:
                change_percent = 0
            
            # Объем торгов
            volume = marketdata_dict.get('VALTODAY') or marketdata_dict.get('VOLTODAY') or 0
            try:
                volume = int(float(volume)) if volume else 0
            except (ValueError, TypeError):
                volume = 0
            
            result = {
                'price': round(last_price, 2),
                'change': round(change, 2),
                'change_percent': round(change_percent, 2),
                'volume': volume,
                'last_update': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            }
            
            # Сохраняем в кэш
            self._save_to_cache(ticker, result)
            
            return result
            
        except (KeyError, ValueError, TypeError, IndexError) as e:
            print(f"Ошибка парсинга данных MOEX для {ticker}: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def get_security_info(self, ticker: str) -> Optional[Dict]:
        """
        Получить общую информацию о ценной бумаге
        
        Args:
            ticker: Тикер акции
            
        Returns:
            Словарь с информацией о бумаге или None
        """
        ticker = ticker.upper().strip()
        url = f"{self.BASE_URL}/engines/stock/markets/shares/securities/{ticker}.json"
        
        params = {
            'iss.meta': 'off',
            'securities.columns': 'SECID,SECNAME,SHORTNAME'
        }
        
        data = self._make_request(url, params)
        
        if not data or len(data) < 2:
            return None
        
        try:
            data_dict = data[1]
            securities_table = data_dict.get('securities', [])
            
            if securities_table and isinstance(securities_table, list) and len(securities_table) > 0:
                # Берем последний элемент (актуальные данные)
                securities_dict = securities_table[-1]
                if isinstance(securities_dict, dict):
                    return {
                        'ticker': securities_dict.get('SECID'),
                        'name': securities_dict.get('SECNAME'),
                        'short_name': securities_dict.get('SHORTNAME')
                    }
        except Exception as e:
            print(f"Ошибка получения информации о бумаге {ticker}: {e}")
        
        return None
