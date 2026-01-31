"""
Главный файл Flask приложения для отслеживания котировок MOEX
"""
from flask import Flask, render_template, jsonify, request
from models.database import init_db, db_session
from models.portfolio import Portfolio
from models.price_history import PriceHistory
from models.transaction import Transaction, TransactionType
from services.moex_service import MOEXService
from services.price_logger import PriceLogger
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from datetime import datetime
import atexit
import pytz

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here'

# Инициализация БД
init_db()

# Инициализация сервисов
moex_service = MOEXService()
price_logger = PriceLogger(moex_service)

# Инициализация планировщика задач
scheduler = BackgroundScheduler(timezone=pytz.timezone('Europe/Moscow'))

# Добавляем задачу логирования цен каждый день в 00:00 МСК
scheduler.add_job(
    func=price_logger.log_all_prices,
    trigger=CronTrigger(hour=0, minute=0, timezone='Europe/Moscow'),
    id='daily_price_logging',
    name='Ежедневное логирование цен в 00:00 МСК',
    replace_existing=True
)

# Запускаем планировщик
scheduler.start()
print("Планировщик запущен. Логирование цен будет выполняться каждый день в 00:00 МСК")


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
        portfolio_items = db_session.query(Portfolio).all()
        result = []
        
        for item in portfolio_items:
            # Получаем актуальную цену с MOEX
            current_price_data = moex_service.get_current_price(item.ticker)
            
            if current_price_data:
                current_price = current_price_data.get('price', 0)
                last_update = current_price_data.get('last_update', '')
            else:
                current_price = 0
                last_update = ''
            
            # Вычисляем среднюю цену покупки из истории транзакций
            buy_transactions = db_session.query(Transaction).filter(
                Transaction.ticker == item.ticker,
                Transaction.operation_type == TransactionType.BUY
            ).all()
            
            if buy_transactions:
                # Взвешенная средняя цена: sum(price * quantity) / sum(quantity)
                total_cost = sum(t.price * t.quantity for t in buy_transactions)
                total_quantity = sum(t.quantity for t in buy_transactions)
                calculated_avg_price = total_cost / total_quantity if total_quantity > 0 else item.average_buy_price
            else:
                # Если транзакций нет, используем цену из портфеля
                calculated_avg_price = item.average_buy_price
            
            # Получаем последнюю цену из истории для расчета изменения
            last_history_entry = db_session.query(PriceHistory).filter(
                PriceHistory.ticker == item.ticker
            ).order_by(PriceHistory.logged_at.desc()).first()
            
            # Рассчитываем изменение: последняя залогированная цена - цена покупки
            if last_history_entry and calculated_avg_price > 0:
                last_logged_price = last_history_entry.price
                price_change = last_logged_price - calculated_avg_price
                price_change_percent = (price_change / calculated_avg_price * 100) if calculated_avg_price > 0 else 0
            else:
                # Если истории нет, изменение = 0
                last_logged_price = calculated_avg_price  # используем цену покупки как базу
                price_change = 0
                price_change_percent = 0
            
            # Расчеты прибыли/убытка (используем ту же логику - относительно последней залогированной цены)
            total_logged_value = item.quantity * last_logged_price
            total_buy_cost = item.quantity * calculated_avg_price
            profit_loss = total_logged_value - total_buy_cost
            profit_loss_percent = price_change_percent  # то же самое, что и изменение в процентах
            
            result.append({
                'id': item.id,
                'ticker': item.ticker,
                'company_name': item.company_name,
                'category': item.category if hasattr(item, 'category') else None,
                'quantity': item.quantity,
                'average_buy_price': calculated_avg_price,
                'current_price': current_price,
                'price_change': price_change,
                'price_change_percent': price_change_percent,
                'total_cost': total_logged_value,  # стоимость по последней залогированной цене
                'total_buy_cost': total_buy_cost,
                'profit_loss': profit_loss,
                'profit_loss_percent': profit_loss_percent,
                'last_update': last_update,
                'date_added': item.date_added.isoformat() if item.date_added else None
            })
        
        # Общие расчеты портфеля
        total_portfolio_value = sum(item['total_cost'] for item in result)
        total_portfolio_cost = sum(item['total_buy_cost'] for item in result)
        total_portfolio_pnl = total_portfolio_value - total_portfolio_cost
        total_portfolio_pnl_percent = ((total_portfolio_value - total_portfolio_cost) / total_portfolio_cost * 100) if total_portfolio_cost > 0 else 0
        
        return jsonify({
            'success': True,
            'portfolio': result,
            'summary': {
                'total_value': total_portfolio_value,
                'total_cost': total_portfolio_cost,
                'total_pnl': total_portfolio_pnl,
                'total_pnl_percent': total_portfolio_pnl_percent
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
        quantity = float(data.get('quantity', 0))
        buy_price = float(data.get('average_buy_price', 0))
        
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


@app.route('/api/validate-ticker/<ticker>', methods=['GET'])
def validate_ticker(ticker):
    """
    Проверить существование тикера на MOEX
    """
    try:
        ticker = ticker.upper().strip()
        
        if not ticker:
            return jsonify({
                'success': False,
                'error': 'Тикер не указан'
            }), 400
        
        # Пытаемся получить информацию о тикере
        quote_data = moex_service.get_current_price(ticker)
        security_info = moex_service.get_security_info(ticker)
        
        if quote_data or security_info:
            # Тикер существует
            company_name = ''
            if security_info:
                company_name = security_info.get('short_name') or security_info.get('name') or ''
            
            return jsonify({
                'success': True,
                'ticker': ticker,
                'exists': True,
                'company_name': company_name,
                'current_price': quote_data.get('price') if quote_data else None
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
        
        # Создание новой транзакции
        transaction = Transaction(
            date=transaction_date,
            ticker=data['ticker'].upper(),
            company_name=data.get('company_name', ''),
            operation_type=operation_type,
            price=price,
            quantity=quantity,
            total=total,
            notes=data.get('notes', '')
        )
        
        db_session.add(transaction)
        db_session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Транзакция успешно добавлена',
            'transaction': transaction.to_dict()
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
        
        db_session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Транзакция успешно обновлена',
            'transaction': transaction.to_dict()
        })
        
    except Exception as e:
        db_session.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/transactions/<int:transaction_id>', methods=['DELETE'])
def delete_transaction(transaction_id):
    """
    Удалить транзакцию
    """
    try:
        transaction = db_session.query(Transaction).filter(Transaction.id == transaction_id).first()
        
        if not transaction:
            return jsonify({
                'success': False,
                'error': 'Транзакция не найдена'
            }), 404
        
        db_session.delete(transaction)
        db_session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Транзакция успешно удалена'
        })
        
    except Exception as e:
        db_session.rollback()
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
    - days: количество дней истории (по умолчанию 30)
    """
    try:
        ticker = request.args.get('ticker')
        days = request.args.get('days', 30, type=int)
        
        if ticker:
            # История для конкретного тикера
            history = price_logger.get_price_history(ticker=ticker, days=days)
        else:
            # История для всех тикеров, сгруппированная по датам
            history = price_logger.get_price_history_grouped(days=days)
        
        return jsonify({
            'success': True,
            'history': history,
            'ticker': ticker,
            'days': days
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/log-prices-now', methods=['POST'])
def log_prices_now():
    """
    Ручное логирование цен (для тестирования)
    
    В продакшене это выполняется автоматически в 00:00 МСК
    """
    try:
        price_logger.log_all_prices()
        return jsonify({
            'success': True,
            'message': 'Цены успешно залогированы'
        })
    except Exception as e:
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


atexit.register(close_db)


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
