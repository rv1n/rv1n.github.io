"""
Настройка подключения к базе данных SQLite
"""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import scoped_session, sessionmaker
from sqlalchemy.ext.declarative import declarative_base

# DATABASE_URL можно переопределить через переменную окружения:
#   sqlite:////var/www/portfolio/data/portfolio.db  (абсолютный путь, 4 слеша)
#   sqlite:///portfolio.db                          (относительный, для разработки)
_db_url = os.environ.get('DATABASE_URL', 'sqlite:///portfolio.db')
engine = create_engine(_db_url, echo=False)

# Создаем сессию БД
db_session = scoped_session(sessionmaker(autocommit=False, autoflush=False, bind=engine))

# Базовый класс для моделей
Base = declarative_base()
Base.query = db_session.query_property()


def init_db():
    """
    Инициализация базы данных - создание всех таблиц
    """
    from models.portfolio import Portfolio
    from models.price_history import PriceHistory
    from models.transaction import Transaction
    from models.category import Category
    from models.asset_type import AssetType
    from models.cash_balance import CashBalance
    from models.settings import Settings
    from models.user import User
    from models.access_log import AccessLog
    Base.metadata.create_all(bind=engine)
    
    # Создаем настройки по умолчанию, если их еще нет
    settings = db_session.query(Settings).filter(Settings.id == 1).first()
    if not settings:
        default_settings = Settings(id=1, price_logging_hour=0, price_logging_minute=0)
        db_session.add(default_settings)
        db_session.commit()