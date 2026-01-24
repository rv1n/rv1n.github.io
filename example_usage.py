"""
Пример использования MOEX Service для тестирования
Запустите этот файл для проверки работы с MOEX API
"""
from services.moex_service import MOEXService

def test_moex_service():
    """Тестирование сервиса MOEX"""
    print("=" * 50)
    print("Тестирование MOEX Service")
    print("=" * 50)
    
    moex = MOEXService()
    
    # Тестируем популярные тикеры
    test_tickers = ['SBER', 'GAZP', 'LKOH', 'YNDX']
    
    for ticker in test_tickers:
        print(f"\n📊 Получение данных для {ticker}...")
        data = moex.get_current_price(ticker)
        
        if data:
            print(f"✅ Успешно получены данные:")
            print(f"   Цена: {data['price']} ₽")
            print(f"   Изменение: {data['change']:+.2f} ₽ ({data['change_percent']:+.2f}%)")
            print(f"   Объем: {data['volume']:,}")
            print(f"   Обновлено: {data['last_update']}")
        else:
            print(f"❌ Не удалось получить данные для {ticker}")
    
    # Тестируем кэширование
    print("\n" + "=" * 50)
    print("Тестирование кэширования...")
    print("=" * 50)
    
    ticker = 'SBER'
    print(f"\nПервый запрос для {ticker}:")
    import time
    start = time.time()
    data1 = moex.get_current_price(ticker)
    time1 = time.time() - start
    print(f"Время выполнения: {time1:.3f} сек")
    
    print(f"\nВторой запрос для {ticker} (из кэша):")
    start = time.time()
    data2 = moex.get_current_price(ticker)
    time2 = time.time() - start
    print(f"Время выполнения: {time2:.3f} сек")
    print(f"Ускорение: {time1/time2:.1f}x" if time2 > 0 else "Мгновенно")

if __name__ == '__main__':
    test_moex_service()
