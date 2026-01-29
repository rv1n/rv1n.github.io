"""
Модель для хранения истории цен акций
"""
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from models.database import Base
from datetime import datetime


class PriceHistory(Base):
    """
    Модель для хранения ежедневной истории цен акций
    
    Цены логируются каждый день в 00:00 МСК
    """
    __tablename__ = 'price_history'
    
    id = Column(Integer, primary_key=True)
    ticker = Column(String(20), nullable=False, index=True)
    company_name = Column(String(200))
    price = Column(Float, nullable=False)
    change = Column(Float, default=0.0)
    change_percent = Column(Float, default=0.0)
    volume = Column(Integer, default=0)
    logged_at = Column(DateTime, default=datetime.now, nullable=False, index=True)
    
    def __repr__(self):
        return f'<PriceHistory {self.ticker} - {self.price} at {self.logged_at}>'
    
    def to_dict(self):
        """Преобразование объекта в словарь"""
        return {
            'id': self.id,
            'ticker': self.ticker,
            'company_name': self.company_name,
            'price': self.price,
            'change': self.change,
            'change_percent': self.change_percent,
            'volume': self.volume,
            'logged_at': self.logged_at.strftime('%Y-%m-%d %H:%M:%S') if self.logged_at else None
        }
