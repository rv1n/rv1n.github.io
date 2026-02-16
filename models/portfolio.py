"""
Модель портфеля для хранения информации об активах
"""
from sqlalchemy import Column, Integer, String, Float, DateTime, Enum
from datetime import datetime
from models.database import Base
import enum


class InstrumentType(enum.Enum):
    """Типы финансовых инструментов"""
    STOCK = "Акция"
    BOND = "Облигация"


class Portfolio(Base):
    """
    Модель позиции в портфеле
    
    Attributes:
        id: Уникальный идентификатор
        ticker: Тикер инструмента (например, SBER, GAZP, SU26238RMFS4)
        company_name: Название компании/эмитента
        quantity: Количество инструментов
        average_buy_price: Средняя цена покупки
        category: Категория (сектор экономики)
        asset_type: Вид актива
        instrument_type: Тип инструмента (акция/облигация)
        date_added: Дата добавления в портфель
    """
    __tablename__ = 'portfolio'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    ticker = Column(String(20), nullable=False, unique=True)  # unique=True для автоматического усреднения цены
    company_name = Column(String(200), nullable=False)
    quantity = Column(Float, nullable=False)
    average_buy_price = Column(Float, nullable=False)
    category = Column(String(100), nullable=True)  # Категория (сектор)
    asset_type = Column(String(100), nullable=True)  # Вид актива
    instrument_type = Column(Enum(InstrumentType), nullable=False, default=InstrumentType.STOCK)  # Тип инструмента
    bond_facevalue = Column(Float, nullable=True)  # Номинал облигации (для облигаций)
    bond_currency = Column(String(10), nullable=True)  # Валюта номинала облигации (SUR, USD, EUR и т.д.)
    date_added = Column(DateTime, default=datetime.now)
    
    def __repr__(self):
        return f'<Portfolio {self.ticker}: {self.quantity} @ {self.average_buy_price}>'
