"""
Модель портфеля для хранения информации об активах
"""
from sqlalchemy import Column, Integer, String, Float, DateTime
from datetime import datetime
from models.database import Base


class Portfolio(Base):
    """
    Модель позиции в портфеле
    
    Attributes:
        id: Уникальный идентификатор
        ticker: Тикер акции (например, SBER, GAZP)
        company_name: Название компании
        quantity: Количество акций
        average_buy_price: Средняя цена покупки
        category: Категория (сектор экономики)
        date_added: Дата добавления в портфель
    """
    __tablename__ = 'portfolio'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    ticker = Column(String(20), nullable=False, unique=True)  # unique=True для автоматического усреднения цены
    company_name = Column(String(200), nullable=False)
    quantity = Column(Float, nullable=False)
    average_buy_price = Column(Float, nullable=False)
    category = Column(String(100), nullable=True)  # Категория (сектор)
    date_added = Column(DateTime, default=datetime.now)
    
    def __repr__(self):
        return f'<Portfolio {self.ticker}: {self.quantity} @ {self.average_buy_price}>'
