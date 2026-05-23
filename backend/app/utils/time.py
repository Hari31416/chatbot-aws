from datetime import datetime, timezone


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def utcnow_iso() -> str:
    return utcnow().isoformat()


def to_epoch_seconds(value: datetime) -> int:
    return int(value.timestamp())
