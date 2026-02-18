"""
Модель настроек приложения
"""
from sqlalchemy import Column, Integer, String, DateTime
from datetime import datetime
from models.database import Base


class Settings(Base):
    """
    Модель настроек приложения
    
    Attributes:
        id: Уникальный идентификатор (всегда 1, так как настройки единственные)
        price_logging_hour: Час для автоматического логирования цен (0-23)
        price_logging_minute: Минута для автоматического логирования цен (0-59)
        date_updated: Дата последнего обновления
    """
    __tablename__ = 'settings'
    
    id = Column(Integer, primary_key=True, default=1)
    price_logging_hour = Column(Integer, default=0, nullable=False)  # По умолчанию 00:00
    price_logging_minute = Column(Integer, default=0, nullable=False)  # По умолчанию 00:00
    date_updated = Column(DateTime, default=datetime.now, onupdate=datetime.now)
    
    def __repr__(self):
        return f'<Settings price_logging_time={self.price_logging_hour:02d}:{self.price_logging_minute:02d}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'price_logging_hour': self.price_logging_hour,
            'price_logging_minute': self.price_logging_minute,
            'price_logging_time': f'{self.price_logging_hour:02d}:{self.price_logging_minute:02d}',
            'date_updated': self.date_updated.isoformat() if self.date_updated else None
        }
