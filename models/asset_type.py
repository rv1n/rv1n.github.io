"""
Модель видов активов для управления видами активов портфеля
"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from datetime import datetime
from models.database import Base


class AssetType(Base):
    """
    Модель вида актива
    
    Attributes:
        id: Уникальный идентификатор
        name: Название вида актива
        date_created: Дата создания
    """
    __tablename__ = 'asset_types'
    __table_args__ = (UniqueConstraint('name', 'user_id', name='uq_asset_type_name_user'),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    user_id = Column(Integer, ForeignKey('users.id'), nullable=True)
    date_created = Column(DateTime, default=datetime.now)
    
    def __repr__(self):
        return f'<AssetType {self.name}>'
    
    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'date_created': self.date_created.isoformat() if self.date_created else None
        }
