"""РћС‡РёСЃС‚РєР° history: РѕСЃС‚Р°РІРёС‚СЊ РїРѕ 1 Р·Р°РїРёСЃРё (РїРѕСЃР»РµРґРЅСЋСЋ) РЅР° РґРµРЅСЊ РґР»СЏ РєР°Р¶РґРѕРіРѕ С‚РёРєРµСЂР°.

Р—Р°РїСѓСЃРєР°С‚СЊ РёР· РєРѕСЂРЅСЏ РїСЂРѕРµРєС‚Р° (Р’РђР–РќРћ: РїРµСЂРµРґ СЌС‚РёРј СЃРґРµР»Р°Р№С‚Рµ СЂРµР·РµСЂРІРЅСѓСЋ РєРѕРїРёСЋ Р‘Р”):
    PYTHONPATH=. python scripts/cleanup_price_history_daily.py
"""
from datetime import datetime
from typing import List

from sqlalchemy import func, and_

from models.database import db_session
from models.price_history import PriceHistory


def main() -> None:
    print("[cleanup] start", datetime.now())
    total_rows = db_session.query(PriceHistory).count()
    print(f"[cleanup] total rows in PriceHistory: {total_rows}")

    # 1. Р”Р»СЏ РєР°Р¶РґРѕР№ РїР°СЂС‹ (ticker, date) РЅР°С…РѕРґРёРј РјР°РєСЃРёРјР°Р»СЊРЅС‹Р№ logged_at
    subq = (
        db_session.query(
            PriceHistory.ticker.label("ticker"),
            func.date(PriceHistory.logged_at).label("d"),
            func.max(PriceHistory.logged_at).label("max_ts"),
        )
        .group_by(PriceHistory.ticker, func.date(PriceHistory.logged_at))
        .subquery()
    )

    # 2. РќР°С…РѕРґРёРј id Р·Р°РїРёСЃРµР№, РєРѕС‚РѕСЂС‹Рµ РЅСѓР¶РЅРѕ РћРЎРўРђР’РРўР¬ (РїРѕ max_ts)
    keep_ids: List[int] = [
        row.id
        for row in db_session.query(PriceHistory.id)
        .join(
            subq,
            and_(
                PriceHistory.ticker == subq.c.ticker,
                func.date(PriceHistory.logged_at) == subq.c.d,
                PriceHistory.logged_at == subq.c.max_ts,
            ),
        )
    ]
    keep_ids_set = set(keep_ids)
    print(f"[cleanup] unique ticker/day rows to keep: {len(keep_ids_set)}")
    print(f"[cleanup] rows to delete: {total_rows - len(keep_ids_set)}")

    if not keep_ids_set:
        print("[cleanup] nothing to delete")
        return

    # 3. РЈРґР°Р»СЏРµРј РѕСЃС‚Р°Р»СЊРЅС‹Рµ Р·Р°РїРёСЃРё Р±Р°С‚С‡Р°РјРё
    deleted_total = 0
    batch_size = 1000

    while True:
        rows = (
            db_session.query(PriceHistory.id)
            .filter(~PriceHistory.id.in_(keep_ids_set))
            .limit(batch_size)
            .all()
        )
        if not rows:
            break

        ids_to_delete = [r.id for r in rows]
        deleted_total += len(ids_to_delete)

        db_session.query(PriceHistory).filter(
            PriceHistory.id.in_(ids_to_delete)
        ).delete(synchronize_session=False)
        db_session.commit()
        print(f"[cleanup] deleted {deleted_total} rows so far...")

    print(f"[cleanup] done, deleted {deleted_total} extra history rows")


if __name__ == "__main__":
    main()
