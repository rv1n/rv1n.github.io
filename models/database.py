"""
Настройка подключения к базе данных SQLite
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import scoped_session, sessionmaker
from sqlalchemy.ext.declarative import declarative_base

# Создаем движок SQLite
engine = create_engine('sqlite:///portfolio.db', echo=False)

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
    Base.metadata.create_all(bind=engine)
