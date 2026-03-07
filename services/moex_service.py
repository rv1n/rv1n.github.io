"""
Сервис для работы с MOEX ISS API
Документация: https://www.moex.com/a2193
"""
import requests
from datetime import datetime, timedelta
from typing import Optional, Dict, List
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
    
    def get_bulk_prices(self, tickers: List[str], instrument_type: str = 'STOCK') -> Dict[str, float]:
        """
        Получить текущие цены сразу для нескольких тикеров одним запросом к MOEX.
        Используется для логирования истории цен. Поддерживаются только STOCK и BOND;
        для остальных типов (металлы, индексы и т.п.) будет возвращен пустой результат.
        
        Returns:
            Словарь { 'TICKER': price_float }
        """
        result: Dict[str, float] = {}
        if not tickers:
            return result
        
        instrument_type = (instrument_type or 'STOCK').upper()
        if instrument_type == 'BOND':
            engine, market = 'stock', 'bonds'
        elif instrument_type == 'STOCK':
            engine, market = 'stock', 'shares'
        else:
            # Для экзотики (металлы, валютные индексы) пока оставляем поштучные запросы
            return result

        # MOEX принимает список тикеров через параметр securities
        securities_list = ','.join(sorted({t.upper().strip() for t in tickers if t}))
        if not securities_list:
            return result

        url = f"{self.BASE_URL}/engines/{engine}/markets/{market}/securities.json"
        params = {
            'iss.meta': 'off',
            'iss.only': 'marketdata',
            # SECID нужен, чтобы различать тикеры
            'marketdata.columns': 'SECID,LAST,MARKETPRICE,CLOSEPRICE,WAPRICE'
        }

        data = self._make_request(url, params | {'securities': securities_list})
        if not data:
            return result

        marketdata = data.get('marketdata', {})
        cols = marketdata.get('columns', [])
        rows = marketdata.get('data', [])
        try:
            secid_idx = cols.index('SECID')
        except ValueError:
            return result

        # Индексы нужных цен
        def idx(name: str) -> Optional[int]:
            try:
                return cols.index(name)
            except ValueError:
                return None

        last_idx = idx('LAST')
        mp_idx = idx('MARKETPRICE')
        close_idx = idx('CLOSEPRICE')
        wap_idx = idx('WAPRICE')

        for row in rows or []:
            try:
                secid = str(row[secid_idx]).upper()
            except (TypeError, IndexError):
                continue
            if not secid:
                continue

            price_val = None
            # Для shares: MARKETPRICE = текущая рыночная цена (актуально для ETF), затем LAST
            # Для bonds порядок не меняем (используется last_idx и т.д.)
            price_order = (mp_idx, last_idx, close_idx, wap_idx) if instrument_type == 'STOCK' else (last_idx, mp_idx, close_idx, wap_idx)
            for i in price_order:
                if i is not None and i < len(row):
                    val = row[i]
                    if val is not None:
                        price_val = float(val)
                        break

            if price_val is not None:
                result[secid] = price_val

        return result
    
    def get_current_price(self, ticker: str, instrument_type: str = 'STOCK') -> Optional[Dict]:
        """
        Получить текущую цену и данные по тикеру
        
        Использует endpoint: /iss/engines/stock/markets/shares/securities/{ticker} для акций
        или /iss/engines/stock/markets/bonds/securities/{ticker} для облигаций
        
        Args:
            ticker: Тикер инструмента (например, SBER, GAZP для акций или SU26238RMFS4 для облигаций)
            instrument_type: Тип инструмента ('STOCK' или 'BOND')
            
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
        cache_key = f"{ticker}_{instrument_type}"
        cached_data = self._get_from_cache(cache_key)
        if cached_data:
            return cached_data
        
        # Универсальный подход: пробуем разные рынки, если первый не дал результата
        # Порядок: shares, bonds, selt, indices. Если данные пришли с currency/indices (индекс),
        # дополнительно проверяем stock/shares — там может торговаться ETF с тем же тикером;
        # при наличии данных с shares берём их (цена ETF), чтобы не записывать индекс вместо цены бумаги.
        markets_to_try = []
        if instrument_type == 'BOND':
            markets_to_try.append(('stock', 'bonds'))
        else:
            markets_to_try.append(('stock', 'shares'))
        markets_to_try.extend([
            ('stock', 'shares'),
            ('stock', 'bonds'),
            ('currency', 'selt'),
            ('currency', 'indices'),
        ])
        seen = set()
        unique_markets = []
        for market in markets_to_try:
            if market not in seen:
                seen.add(market)
                unique_markets.append(market)

        data = None
        used_market = None

        for engine, market in unique_markets:
            url = f"{self.BASE_URL}/engines/{engine}/markets/{market}/securities/{ticker}.json"
            params = {
                'iss.meta': 'off',
                'iss.json': 'extended',
                'securities.columns': 'SECID,LAST,OPEN,CHANGE,LASTTOPREVPRICE,VALTODAY,PREVPRICE,PREVLEGALCLOSEPRICE,DECIMALS',
                'marketdata.columns': 'LAST,OPEN,CHANGE,LASTTOPREVPRICE,VALTODAY,MARKETPRICE,CLOSEPRICE,WAPRICE'
            }
            if market == 'bonds':
                params['marketdata_yields.columns'] = 'SECID,PRICE,WAPRICE'
                params['securities.columns'] = 'SECID,LAST,OPEN,CHANGE,LASTTOPREVPRICE,VALTODAY,FACEVALUE,CURRENCYID,FACEUNIT,DECIMALS'

            data = self._make_request(url, params)
            if data and len(data) >= 2:
                data_dict = data[1]
                if data_dict.get('securities') or data_dict.get('marketdata'):
                    used_market = (engine, market)
                    break

        # Универсально: если источник — currency/indices, пробуем взять цену с stock/shares (ETF)
        if data and used_market == ('currency', 'indices'):
            url_shares = f"{self.BASE_URL}/engines/stock/markets/shares/securities/{ticker}.json"
            params_shares = {
                'iss.meta': 'off',
                'iss.json': 'extended',
                'securities.columns': 'SECID,LAST,OPEN,CHANGE,LASTTOPREVPRICE,VALTODAY,PREVPRICE,PREVLEGALCLOSEPRICE,DECIMALS',
                'marketdata.columns': 'LAST,OPEN,CHANGE,LASTTOPREVPRICE,VALTODAY,MARKETPRICE,CLOSEPRICE,WAPRICE'
            }
            data_shares = self._make_request(url_shares, params_shares)
            if data_shares and len(data_shares) >= 2:
                d = data_shares[1]
                if d.get('securities') or d.get('marketdata'):
                    data = data_shares
                    used_market = ('stock', 'shares')

        if not data:
            if instrument_type not in ['STOCK', 'BOND'] or ticker == 'GOLD':
                print(f"[MOEXService] Не удалось получить данные для {ticker} ни на одном из рынков: {[f'{e}/{m}' for e, m in unique_markets]}")
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
            marketdata_yields_table = data_dict.get('marketdata_yields', [])
            
            # Парсим marketdata (более актуальные данные)
            # Берем последний элемент массива, так как он содержит актуальные данные
            marketdata_dict = {}
            marketdata_index = -1  # Индекс выбранной записи marketdata
            if marketdata_table and isinstance(marketdata_table, list):
                # Ищем последний элемент с непустыми данными и наибольшим объемом торгов
                best_item = None
                best_volume = 0
                best_index = -1
                for idx, item in enumerate(marketdata_table):
                    if isinstance(item, dict) and item.get('LAST') is not None:
                        volume = item.get('VALTODAY') or item.get('VOLTODAY') or 0
                        try:
                            volume = int(float(volume)) if volume else 0
                        except (ValueError, TypeError):
                            volume = 0
                        # Выбираем запись с наибольшим объемом торгов
                        if volume > best_volume:
                            best_item = item
                            best_volume = volume
                            best_index = idx
                
                # Если нашли запись с объемом, используем её, иначе берем последнюю с LAST
                if best_item:
                    marketdata_dict = best_item
                    marketdata_index = best_index
                else:
                    # Fallback 1: берем последнюю запись с LAST
                    for idx, item in enumerate(reversed(marketdata_table)):
                        if isinstance(item, dict) and item.get('LAST') is not None:
                            marketdata_dict = item
                            # Вычисляем оригинальный индекс
                            marketdata_index = len(marketdata_table) - 1 - idx
                            break
                    
                    # Fallback 2: для замороженных/неактивных инструментов (LAST=None) —
                    # берем последнюю запись с MARKETPRICE (это уже цена в рублях на MOEX)
                    if not marketdata_dict:
                        for idx, item in enumerate(reversed(marketdata_table)):
                            if isinstance(item, dict) and item.get('MARKETPRICE') is not None:
                                marketdata_dict = item
                                marketdata_index = len(marketdata_table) - 1 - idx
                                break
            
            # Для облигаций (только если использовался рынок bonds) проверяем marketdata_yields, если LAST пустой
            if used_market and used_market[1] == 'bonds' and (not marketdata_dict.get('LAST') or marketdata_dict.get('LAST') == ''):
                if marketdata_yields_table and isinstance(marketdata_yields_table, list):
                    # Берем последний элемент с данными
                    for item in reversed(marketdata_yields_table):
                        if isinstance(item, dict):
                            # Используем PRICE или WAPRICE из marketdata_yields
                            price = item.get('PRICE') or item.get('WAPRICE')
                            if price is not None:
                                # Создаем словарь с ценой для дальнейшей обработки
                                marketdata_dict = {'LAST': price}
                                break
            
            # Парсим securities (резервные данные)
            # Пытаемся найти запись, соответствующую выбранной записи marketdata
            securities_dict = {}
            decimals = None  # Количество знаков после запятой
            if securities_table and isinstance(securities_table, list):
                # Если нашли индекс в marketdata, пытаемся использовать соответствующий индекс в securities
                if marketdata_index >= 0 and marketdata_index < len(securities_table):
                    matching_item = securities_table[marketdata_index]
                    if isinstance(matching_item, dict):
                        securities_dict = matching_item
                        # Получаем DECIMALS из соответствующей записи
                        if 'DECIMALS' in matching_item:
                            try:
                                decimals = int(matching_item['DECIMALS'])
                            except (ValueError, TypeError):
                                decimals = None
                
                # Если не нашли соответствие, используем последний элемент
                if not securities_dict and len(securities_table) > 0:
                    last_item = securities_table[-1]
                    if isinstance(last_item, dict):
                        securities_dict = last_item
                        # Получаем DECIMALS из последней записи
                        if 'DECIMALS' in last_item:
                            try:
                                decimals = int(last_item['DECIMALS'])
                            except (ValueError, TypeError):
                                decimals = None
            
            # Для некоторых инструментов (драгоценные металлы, валютные индексы) может не быть marketdata, используем securities
            if (not marketdata_dict.get('LAST') or marketdata_dict.get('LAST') == '') and securities_dict.get('LAST'):
                # Используем данные из securities, если marketdata пустой
                marketdata_dict = securities_dict.copy()
            
            # Получаем цену (приоритет marketdata, затем securities)
            # Для рынка shares (акции, ETF): MARKETPRICE = текущая рыночная цена, LAST = последняя сделка.
            # У ETF при редких сделках LAST может быть с прошлой сессии — предпочитаем MARKETPRICE для актуальности.
            # Для облигаций и прочих рынков оставляем прежний приоритет (LAST / WAPRICE).
            is_shares = used_market and used_market[1] == 'shares'
            if is_shares:
                last_price = (
                    marketdata_dict.get('MARKETPRICE') or  # Текущая рыночная цена (актуально для ETF)
                    marketdata_dict.get('LAST') or
                    marketdata_dict.get('WAPRICE') or
                    marketdata_dict.get('CLOSEPRICE') or
                    securities_dict.get('LAST') or
                    securities_dict.get('PREVPRICE') or
                    securities_dict.get('PREVLEGALCLOSEPRICE') or
                    securities_dict.get('PRICE') or
                    securities_dict.get('WAPRICE') or
                    securities_dict.get('CLOSE')
                )
            elif decimals is not None and decimals > 2:
                last_price = (
                    marketdata_dict.get('LAST') or
                    marketdata_dict.get('WAPRICE') or
                    marketdata_dict.get('MARKETPRICE') or
                    marketdata_dict.get('CLOSEPRICE') or
                    securities_dict.get('LAST') or
                    securities_dict.get('PREVPRICE') or
                    securities_dict.get('PREVLEGALCLOSEPRICE') or
                    securities_dict.get('PRICE') or
                    securities_dict.get('WAPRICE') or
                    securities_dict.get('CLOSE')
                )
            else:
                last_price = (
                    marketdata_dict.get('WAPRICE') or
                    marketdata_dict.get('LAST') or
                    marketdata_dict.get('MARKETPRICE') or
                    marketdata_dict.get('CLOSEPRICE') or
                    securities_dict.get('LAST') or
                    securities_dict.get('PREVPRICE') or
                    securities_dict.get('PREVLEGALCLOSEPRICE') or
                    securities_dict.get('PRICE') or
                    securities_dict.get('WAPRICE') or
                    securities_dict.get('CLOSE')
                )
            
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
            
            # Округляем цену в зависимости от decimals
            # Если decimals указан, округляем до этого количества знаков, иначе до 2
            price_rounding = decimals if decimals is not None else 2
            # Ограничиваем максимальное количество знаков до 5
            price_rounding = min(price_rounding, 5)
            
            result = {
                'price': round(last_price, price_rounding),
                'change': round(change, price_rounding),
                'change_percent': round(change_percent, 2),
                'volume': volume,
                'last_update': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            }
            
            # Добавляем DECIMALS, если он был получен
            if decimals is not None:
                result['decimals'] = decimals
            
            # Для облигаций (только если использовался рынок bonds) добавляем информацию о номинале и валюте
            if used_market and used_market[1] == 'bonds':
                facevalue = securities_dict.get('FACEVALUE')
                # FACEUNIT — валюта номинала (USD для RU000A105SG2 и т.п.)
                face_unit = securities_dict.get('FACEUNIT')
                # CURRENCYID — валюта обращения (часто SUR для рублёвых торгов)
                currency_id = securities_dict.get('CURRENCYID')
                
                if facevalue:
                    try:
                        result['facevalue'] = float(facevalue)
                    except (ValueError, TypeError):
                        result['facevalue'] = 1000.0  # Значение по умолчанию
                else:
                    result['facevalue'] = 1000.0  # Значение по умолчанию

                # В качестве валюты номинала используем FACEUNIT, а если его нет — CURRENCYID
                # Это значение дальше трактуется как валюта номинала в приложении.
                if face_unit:
                    result['currency_id'] = face_unit
                else:
                    result['currency_id'] = currency_id if currency_id else 'SUR'  # SUR = рубли по умолчанию
            
            # Сохраняем в кэш
            self._save_to_cache(cache_key, result)
            
            return result
            
        except (KeyError, ValueError, TypeError, IndexError) as e:
            print(f"Ошибка парсинга данных MOEX для {ticker}: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def get_raw_market_securities(self, ticker: str, instrument_type: str = 'STOCK') -> Optional[Dict]:
        """
        Получить сырые блоки marketdata и securities из ISS для отображения во вкладках отладки.
        Returns: { 'securities': [...], 'marketdata': [...], 'marketdata_yields': [...] or None }
        """
        ticker = ticker.upper().strip()
        engine = 'stock'
        market = 'bonds' if instrument_type == 'BOND' else 'shares'
        url = f"{self.BASE_URL}/engines/{engine}/markets/{market}/securities/{ticker}.json"
        params = {
            'iss.meta': 'off',
            'iss.json': 'extended',
            'securities.columns': 'SECID,BOARDID,SHORTNAME,SECNAME,PREVPRICE,PREVLEGALCLOSEPRICE,STATUS,LOTSIZE,CURRENCYID,DECIMALS,MINSTEP,STEPPRICE,LISTLEVEL,PREVDATE',
            'marketdata.columns': 'SECID,BOARDID,LAST,OPEN,HIGH,LOW,CHANGE,LASTCHANGEPRC,VALUE,MARKETPRICE,CLOSEPRICE,WAPRICE,VALTODAY,VOLTODAY,LASTTOPREVPRICE'
        }
        if market == 'bonds':
            params['securities.columns'] = 'SECID,BOARDID,SHORTNAME,SECNAME,PREVPRICE,PREVLEGALCLOSEPRICE,FACEVALUE,CURRENCYID,FACEUNIT,DECIMALS,LOTSIZE,MATDATE'
            params['marketdata_yields.columns'] = 'SECID,BOARDID,PRICE,WAPRICE,YIELD,ACCRUEDINT'
        data = self._make_request(url, params)
        if not data or len(data) < 2:
            return None
        data_dict = data[1]
        result = {
            'securities': data_dict.get('securities', []),
            'marketdata': data_dict.get('marketdata', [])
        }
        if market == 'bonds':
            result['marketdata_yields'] = data_dict.get('marketdata_yields', [])
        else:
            result['marketdata_yields'] = None
        return result
    
    def get_security_info(self, ticker: str, instrument_type: str = 'STOCK') -> Optional[Dict]:
        """
        Получить общую информацию о ценной бумаге
        
        Args:
            ticker: Тикер инструмента
            instrument_type: Тип инструмента ('STOCK' или 'BOND')
            
        Returns:
            Словарь с информацией о бумаге или None
        """
        ticker = ticker.upper().strip()
        url = f"{self.BASE_URL}/securities/{ticker}.json"
        
        params = {
            'iss.meta': 'off',
            'iss.json': 'extended'
        }
        
        data = self._make_request(url, params)
        
        if not data or len(data) < 2:
            return None
        
        result = {}
        trading_params = {}
        
        try:
            data_dict = data[1]
            
            # Сначала пробуем получить из description
            description_table = data_dict.get('description', [])
            if description_table and isinstance(description_table, list):
                fields = {}
                for item in description_table:
                    if isinstance(item, dict):
                        name = item.get('name')
                        value = item.get('value')
                        if not name:
                            continue
                        # Базовые поля
                        if name == 'SECID':
                            result['ticker'] = value
                        elif name == 'NAME':
                            result['name'] = value
                        elif name == 'SHORTNAME':
                            result['short_name'] = value
                        # Сохраняем все поля в словарь для детального отображения в UI
                        fields[name] = value
                
                if fields:
                    result['fields'] = fields
            
            # Получаем информацию о торговых параметрах из boards (лоты, шаги цены)
            boards_table = data_dict.get('boards', [])
            if boards_table and isinstance(boards_table, list):
                # Берем первый активный board (обычно это основной режим торгов)
                for board in boards_table:
                    if isinstance(board, dict):
                        lotsize = board.get('lotsize')
                        minstep = board.get('minstep')
                        stepprice = board.get('stepprice')
                        if lotsize is not None and lotsize != '':
                            try:
                                trading_params['lotsize'] = int(float(lotsize))
                            except (ValueError, TypeError):
                                pass
                        if minstep is not None and minstep != '':
                            try:
                                trading_params['minstep'] = float(minstep)
                            except (ValueError, TypeError):
                                pass
                        if stepprice is not None and stepprice != '':
                            try:
                                trading_params['stepprice'] = float(stepprice)
                            except (ValueError, TypeError):
                                pass
                        # Если нашли хотя бы один параметр, используем этот board
                        if trading_params:
                            break
            
            # Всегда пробуем получить из markets endpoint (более надежный источник для облигаций)
            # Если trading_params пустой или нужно обновить данные, проверяем markets endpoint
            if instrument_type and (not trading_params or not trading_params.get('lotsize')):
                market = 'bonds' if instrument_type == 'BOND' else 'shares'
                market_url = f"{self.BASE_URL}/engines/stock/markets/{market}/securities/{ticker}.json"
                market_params = {
                    'iss.meta': 'off',
                    'iss.json': 'extended',
                    'securities.columns': 'SECID,LOTSIZE,MINSTEP,STEPPRICE'
                }
                market_data = self._make_request(market_url, market_params)
                if market_data and len(market_data) >= 2:
                    market_dict = market_data[1]
                    securities_table = market_dict.get('securities', [])
                    if securities_table and isinstance(securities_table, list):
                        # Ищем запись с максимальным LOTSIZE (обычно это основной режим торгов)
                        # или берем первую с LOTSIZE > 1, если есть
                        best_sec = None
                        max_lotsize = 0
                        for sec in securities_table:
                            if isinstance(sec, dict):
                                lotsize = sec.get('LOTSIZE')
                                if lotsize is not None and lotsize != '':
                                    try:
                                        lotsize_int = int(float(lotsize))
                                        if lotsize_int > max_lotsize:
                                            max_lotsize = lotsize_int
                                            best_sec = sec
                                    except (ValueError, TypeError):
                                        pass
                        
                        # Если нашли лучшую запись, используем её (перезаписываем, если markets endpoint дал лучшие данные)
                        if best_sec:
                            lotsize = best_sec.get('LOTSIZE')
                            minstep = best_sec.get('MINSTEP')
                            stepprice = best_sec.get('STEPPRICE')
                            if lotsize is not None and lotsize != '':
                                try:
                                    lotsize_int = int(float(lotsize))
                                    # Используем данные из markets endpoint, если они лучше (больше lotsize) или если их еще нет
                                    if not trading_params.get('lotsize') or lotsize_int > trading_params.get('lotsize', 0):
                                        trading_params['lotsize'] = lotsize_int
                                except (ValueError, TypeError):
                                    pass
                            if minstep is not None and minstep != '':
                                try:
                                    if not trading_params.get('minstep'):
                                        trading_params['minstep'] = float(minstep)
                                except (ValueError, TypeError):
                                    pass
                            if stepprice is not None and stepprice != '':
                                try:
                                    if not trading_params.get('stepprice'):
                                        trading_params['stepprice'] = float(stepprice)
                                except (ValueError, TypeError):
                                    pass
            
            # Если не нашли в description, пробуем в boards как запасной вариант для названия
            if not result.get('name') and boards_table and isinstance(boards_table, list) and len(boards_table) > 0:
                first_board = boards_table[0]
                if isinstance(first_board, dict):
                    secid = first_board.get('secid')
                    title = first_board.get('title') or first_board.get('shortname')
                    if secid and title:
                        if not result.get('ticker'):
                            result['ticker'] = secid
                        if not result.get('name'):
                            result['name'] = title
                        if not result.get('short_name'):
                            result['short_name'] = title
            
            # Добавляем торговые параметры к результату
            if trading_params:
                result['trading_params'] = trading_params
            
            # Если нашли хотя бы название или тикер, возвращаем результат
            if result.get('name') or result.get('short_name') or result.get('ticker'):
                # Раньше здесь была подробная отладочная печать информации о бумаге,
                # но она сильно засоряла логи и тормозила работу при частых запросах.
                # Если понадобится, можно временно раскомментировать:
                # print(f\"Информация о бумаге {ticker}: {result}\")
                return result
                        
        except Exception as e:
            print(f"Ошибка получения информации о бумаге {ticker}: {e}")
            import traceback
            traceback.print_exc()
        
        return None

    def get_raw_index_marketdata(self, secid: str) -> Optional[Dict]:
        """
        Сырые данные индекса (marketdata) с ISS для отладки (например LQDTM iNAV).
        Возвращает marketdata как список dict (нормализовано для отображения в таблице).
        """
        try:
            url = f"{self.BASE_URL}/engines/stock/markets/index/boards/SNDX/securities/{secid}.json"
            data = self._make_request(url, {'iss.meta': 'off'})
            if not data:
                return None
            if isinstance(data, list) and len(data) >= 2:
                data_dict = data[1]
            else:
                data_dict = data if isinstance(data, dict) else {}
            md = data_dict.get('marketdata')
            if not md:
                return None
            # ISS без extended возвращает { 'columns': [...], 'data': [[...], ...] }
            if isinstance(md, dict) and 'columns' in md and 'data' in md:
                cols = md['columns']
                rows = md.get('data', [])
                out = [dict(zip(cols, row)) for row in rows]
                return {'marketdata': out}
            return {'marketdata': md if isinstance(md, list) else []}
        except Exception as e:
            print(f"Ошибка получения сырых данных индекса {secid}: {e}")
            return None

    def _get_index_current(self, secid: str) -> Optional[Dict]:
        """
        Получить текущее значение индекса (IMOEX, IMOEX2 и т.д.) и дневное изменение.
        Возвращает {'value': float, 'change': float, 'change_percent': float} или None.
        """
        try:
            url = f"{self.BASE_URL}/engines/stock/markets/index/boards/SNDX/securities/{secid}.json"
            resp = requests.get(url, params={'iss.meta': 'off'}, timeout=10)
            resp.raise_for_status()
            data = resp.json()

            marketdata = data.get('marketdata', {})
            columns = marketdata.get('columns', [])
            rows = marketdata.get('data', [])

            if not rows:
                return None

            row = rows[0]
            def col(name):
                try:
                    return row[columns.index(name)]
                except (ValueError, IndexError):
                    return None

            current = col('CURRENTVALUE') or col('LASTVALUE') or col('LAST')
            open_val = col('OPENVALUE') or col('OPEN')
            low = col('LOW')
            high = col('HIGH')

            if current is None:
                return None

            change = (current - open_val) if open_val else None
            change_percent = (change / open_val * 100) if (open_val and change is not None) else None

            return {
                'value': float(current),
                'change': float(change) if change is not None else 0.0,
                'change_percent': float(change_percent) if change_percent is not None else 0.0,
                'low': float(low) if low else None,
                'high': float(high) if high else None,
            }
        except Exception as e:
            print(f"Ошибка получения текущего {secid}: {e}")
            return None

    def get_imoex_current(self) -> Optional[Dict]:
        """Текущее значение IMOEX."""
        return self._get_index_current('IMOEX')

    def get_imoex2_current(self) -> Optional[Dict]:
        """Текущее значение IMOEX2 (расширенная сессия)."""
        return self._get_index_current('IMOEX2')

    def get_imoex_history(self, date_from: str, date_to: str) -> list:
        """
        Получить историю значений индекса IMOEX за период.
        date_from, date_to: строки формата 'YYYY-MM-DD'
        Возвращает список {'date': 'YYYY-MM-DD', 'value': float}
        """
        url = f"{self.BASE_URL}/history/engines/stock/markets/index/boards/SNDX/securities/IMOEX.json"
        results = []
        start = 0
        while True:
            try:
                resp = requests.get(url, params={
                    'from': date_from, 'till': date_to,
                    'limit': 500, 'start': start
                }, timeout=15)
                resp.raise_for_status()
                data = resp.json()
                history = data.get('history', {})
                columns = history.get('columns', [])
                rows = history.get('data', [])
                if not rows:
                    break
                date_idx = columns.index('TRADEDATE')
                close_idx = columns.index('CLOSE')
                for row in rows:
                    if row[close_idx] is not None:
                        results.append({'date': row[date_idx], 'value': float(row[close_idx])})
                start += len(rows)
                if len(rows) < 500:
                    break
            except Exception as e:
                print(f"Ошибка получения истории IMOEX: {e}")
                break
        return results
