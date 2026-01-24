"""
Главный файл Flask приложения для отслеживания котировок MOEX
"""
from flask import Flask, render_template, jsonify, request
from models.database import init_db, db_session
from models.portfolio import Portfolio
from services.moex_service import MOEXService
import atexit

app = Flask(__name__)
app.config['SECRET_KEY'] = 'your-secret-key-here'

# Инициализация БД
init_db()

# Инициализация сервиса MOEX
moex_service = MOEXService()


@app.route('/')
def index():
    """Главная страница с портфелем"""
    return render_template('index.html')


@app.route('/api/portfolio', methods=['GET'])
def get_portfolio():
    """
    Получить весь портфель с актуальными ценами
    """
    try:
        portfolio_items = db_session.query(Portfolio).all()
        result = []
        
        for item in portfolio_items:
            # Получаем актуальную цену с MOEX
            current_price_data = moex_service.get_current_price(item.ticker)
            
            if current_price_data:
                current_price = current_price_data.get('price', 0)
                price_change = current_price_data.get('change', 0)
                price_change_percent = current_price_data.get('change_percent', 0)
                volume = current_price_data.get('volume', 0)
                last_update = current_price_data.get('last_update', '')
            else:
                current_price = 0
                price_change = 0
                price_change_percent = 0
                volume = 0
                last_update = ''
            
            # Расчеты прибыли/убытка
            total_cost = item.quantity * current_price
            total_buy_cost = item.quantity * item.average_buy_price
            profit_loss = total_cost - total_buy_cost
            profit_loss_percent = ((current_price - item.average_buy_price) / item.average_buy_price * 100) if item.average_buy_price > 0 else 0
            
            result.append({
                'id': item.id,
                'ticker': item.ticker,
                'company_name': item.company_name,
                'quantity': item.quantity,
                'average_buy_price': item.average_buy_price,
                'current_price': current_price,
                'price_change': price_change,
                'price_change_percent': price_change_percent,
                'volume': volume,
                'total_cost': total_cost,
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
    Добавить новую позицию в портфель
    """
    try:
        data = request.json
        ticker = data.get('ticker', '').upper().strip()
        company_name = data.get('company_name', '').strip()
        quantity = float(data.get('quantity', 0))
        average_buy_price = float(data.get('average_buy_price', 0))
        
        if not ticker or quantity <= 0 or average_buy_price <= 0:
            return jsonify({
                'success': False,
                'error': 'Неверные данные: тикер, количество и цена должны быть положительными'
            }), 400
        
        # Проверяем, нет ли уже такого тикера
        existing = db_session.query(Portfolio).filter_by(ticker=ticker).first()
        if existing:
            return jsonify({
                'success': False,
                'error': f'Тикер {ticker} уже есть в портфеле'
            }), 400
        
        new_item = Portfolio(
            ticker=ticker,
            company_name=company_name or ticker,
            quantity=quantity,
            average_buy_price=average_buy_price
        )
        
        db_session.add(new_item)
        db_session.commit()
        
        return jsonify({
            'success': True,
            'message': f'Позиция {ticker} добавлена в портфель'
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


@app.teardown_appcontext
def shutdown_session(exception=None):
    """Закрытие сессии БД после запроса"""
    db_session.remove()


def close_db():
    """Закрытие соединения с БД при завершении приложения"""
    db_session.remove()


atexit.register(close_db)


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
