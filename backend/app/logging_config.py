from __future__ import annotations

import logging
import os


def configure_logging() -> None:
    """Configure root logger once at application startup.

    Log level is read from the ``LOG_LEVEL`` environment variable (default
    ``INFO``).  Lambda writes stdout/stderr directly to CloudWatch, so a plain
    text format is used so that each log line is one CloudWatch log event.
    """
    log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    # Suppress noisy third-party loggers at WARNING unless debug is requested.
    if log_level != "DEBUG":
        logging.getLogger("botocore").setLevel(logging.WARNING)
        logging.getLogger("boto3").setLevel(logging.WARNING)
        logging.getLogger("urllib3").setLevel(logging.WARNING)
        logging.getLogger("LiteLLM").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """Return a module-level logger with the given name."""
    return logging.getLogger(name)
