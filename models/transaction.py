"""
Модель для хранения истории покупок/продаж инструментов
"""
from sqlalchemy import Column, Integer, String, Float, DateTime, Enum, ForeignKey
from models.database import Base
from models.portfolio import InstrumentType
from datetime import datetime
import enum


class TransactionType(enum.Enum):
    """Типы транзакций"""
    BUY = "Покупка"
    SELL = "Продажа"


class Transaction(Base):
    """
    Модель для хранения истории покупок и продаж инструментов
    
    Содержит всю информацию о совершённых операциях
    """
    __tablename__ = 'transactions'
    
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=True)
    date = Column(DateTime, default=datetime.now, nullable=False, index=True)
    ticker = Column(String(20), nullable=False, index=True)
    company_name = Column(String(200))
    operation_type = Column(Enum(TransactionType), nullable=False, index=True)
    price = Column(Float, nullable=False)
    quantity = Column(Float, nullable=False)
    total = Column(Float, nullable=False)  # Сумма = цена * количество
    instrument_type = Column(Enum(InstrumentType), nullable=False, default=InstrumentType.STOCK)  # Тип инструмента
    notes = Column(String(500))  # Дополнительные заметки
    
    def __repr__(self):
        return f'<Transaction {self.operation_type.value} {self.ticker} - {self.quantity} @ {self.price}>'
    
    def to_dict(self):
        """Преобразование объекта в словарь"""
        return {
            'id': self.id,
            'date': self.date.strftime('%Y-%m-%d %H:%M:%S') if self.date else None,
            'ticker': self.ticker,
            'company_name': self.company_name,
            'operation_type': self.operation_type.value,
            'price': self.price,
            'quantity': self.quantity,
            'total': self.total,
            'instrument_type': self.instrument_type.value if self.instrument_type else 'Акция',
            'notes': self.notes
        }
