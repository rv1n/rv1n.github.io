"""
Модель для хранения баланса свободных денег от продаж активов
"""
from sqlalchemy import Column, Integer, Float
from models.database import Base


class CashBalance(Base):
    """
    Модель для хранения баланса свободных денег от продаж
    
    Хранит сумму рублей, полученных от продажи активов,
    которая может быть использована для покупки новых активов
    """
    __tablename__ = 'cash_balance'
    
    id = Column(Integer, primary_key=True, default=1)  # Всегда одна запись с id=1
    balance = Column(Float, default=0.0, nullable=False)  # Баланс в рублях
    
    def __repr__(self):
        return f'<CashBalance {self.balance} ₽>'
    
    def to_dict(self):
        """Преобразование объекта в словарь"""
        return {
            'id': self.id,
            'balance': self.balance
        }
