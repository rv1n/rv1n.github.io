"""
Сервис для получения и кэширования курсов валют (основной фокус: перевод в рубли)
Источник: официальный JSON API ЦБ РФ
"""

import requests
from datetime import datetime, timedelta
from typing import Optional, Dict


class CurrencyService:
    """
    Простой сервис курсов валют:
    - тянет курсы с ЦБ РФ
    - кэширует их на сутки
    - отдает коэффициент перевода в рубли
    """

    CBR_URL = "https://www.cbr-xml-daily.ru/daily_json.js"

    def __init__(self):
        self._rates: Dict[str, float] = {"RUB": 1.0}
        self._prev_rates: Dict[str, float] = {}
        self._last_update: Optional[datetime] = None
        # Минимальный интервал обновления (на всякий случай, если дернуть много раз)
        self._min_update_interval = timedelta(minutes=10)

    def _should_update(self) -> bool:
        if self._last_update is None:
            return True
        now = datetime.now()
        # Обновляем, если прошёл день или истек минимальный интервал (на случай падения сервиса)
        if now.date() != self._last_update.date():
            return True
        if now - self._last_update > self._min_update_interval and not self._rates:
            return True
        return False

    def _update_rates(self) -> None:
        """
        Тянет курсы с ЦБ и обновляет локальный кэш.
        Базовая валюта ЦБ — RUB.
        """
        try:
            resp = requests.get(self.CBR_URL, timeout=5)
            resp.raise_for_status()
            data = resp.json()

            rates: Dict[str, float] = {"RUB": 1.0}
            prev_rates: Dict[str, float] = {}
            valutes = data.get("Valute", {})
            for code, v in valutes.items():
                # v['Value'] — сколько RUB за Nominal единиц валюты
                nominal = float(v.get("Nominal", 1)) or 1.0
                value = float(v.get("Value", 0))
                prev_value = float(v.get("Previous", 0)) if v.get("Previous") is not None else 0.0
                code_upper = code.upper()
                if value > 0:
                    rates[code_upper] = value / nominal  # 1 единица валюты в RUB
                if prev_value > 0:
                    prev_rates[code_upper] = prev_value / nominal

            self._rates = rates
            self._prev_rates = prev_rates
            self._last_update = datetime.now()
            print("[CurrencyService] Курсы валют обновлены")
        except Exception as e:
            print(f"[CurrencyService] Ошибка обновления курсов: {e}")
            # В случае ошибки не трогаем старые курсы

    def get_rate_to_rub(self, currency_code: str) -> float:
        """
        Вернуть курс: 1 единица currency_code = X RUB.
        Неизвестную валюту считаем как RUB (курс = 1).
        """
        if not currency_code:
            return 1.0

        code = currency_code.upper()

        if self._should_update():
            self._update_rates()

        return self._rates.get(code, 1.0)

    def get_rates_info(self, codes: Optional[list[str]] = None) -> Dict[str, Dict[str, float]]:
        """
        Вернуть словарь по нескольким валютам:
        {
          'USD': {'rate': X, 'change': dX, 'change_percent': p},
          ...
        }
        """
        if self._should_update():
            self._update_rates()

        if codes is None:
            codes = list(self._rates.keys())

        info: Dict[str, Dict[str, float]] = {}
        for raw_code in codes:
            code = raw_code.upper()
            # Гарантированно получаем курс (при необходимости подтягиваем из ЦБ)
            rate = self.get_rate_to_rub(code)
            prev = self._prev_rates.get(code, rate)
            change = rate - prev
            if prev:
                change_percent = (change / prev) * 100
            else:
                change_percent = 0.0
            info[code] = {
                "rate": rate,
                "change": change,
                "change_percent": change_percent,
            }
        return info
