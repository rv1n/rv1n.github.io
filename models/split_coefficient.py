"""
Модель коэффициентов сплита/дробления акций.
"""
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Date, DateTime, ForeignKey
from models.database import Base


class SplitCoefficient(Base):
    """
    Корпоративные действия по тикеру.

    coefficient хранит мультипликатор сплита (например, 10 для сплита 1:10).
    Для приведения исторической цены к текущей шкале используется деление
    на накопленный коэффициент всех сплитов после даты цены.
    """
    __tablename__ = 'split_coefficients'

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=False, index=True)
    ticker = Column(String(20), nullable=False, index=True)
    effective_date = Column(Date, nullable=False, index=True)
    coefficient = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.now, nullable=False)

    def to_dict(self):
        return {
            'id': self.id,
            'ticker': self.ticker,
            'effective_date': self.effective_date.strftime('%Y-%m-%d') if self.effective_date else None,
            'coefficient': self.coefficient,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M:%S') if self.created_at else None,
        }
