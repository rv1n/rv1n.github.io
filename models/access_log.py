"""
Модель для хранения логов доступа к приложению
"""
from sqlalchemy import Column, Integer, String, DateTime, Boolean
from datetime import datetime
from models.database import Base


class AccessLog(Base):
    """
    Лог подключения к приложению.

    Записывается при:
    - попытке входа (успешной и неуспешной)
    - открытии главной страницы
    """
    __tablename__ = 'access_logs'

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime, default=datetime.now, nullable=False, index=True)
    ip_address = Column(String(45), nullable=True)   # IPv4 или IPv6
    username = Column(String(100), nullable=True)    # Имя пользователя (если известно)
    event = Column(String(50), nullable=False)       # login_ok / login_fail / page_open
    success = Column(Boolean, default=True, nullable=False)
    os_info = Column(String(100), nullable=True)     # ОС из User-Agent
    browser_info = Column(String(100), nullable=True) # Браузер из User-Agent
    user_agent = Column(String(500), nullable=True)  # Полный User-Agent

    def to_dict(self):
        return {
            'id': self.id,
            'timestamp': self.timestamp.strftime('%Y-%m-%d %H:%M:%S') if self.timestamp else None,
            'ip_address': self.ip_address,
            'username': self.username,
            'event': self.event,
            'success': self.success,
            'os_info': self.os_info,
            'browser_info': self.browser_info,
        }
