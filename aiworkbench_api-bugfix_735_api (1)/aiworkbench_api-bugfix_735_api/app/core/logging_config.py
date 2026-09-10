"""
Enterprise logging configuration.
"""
import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

from .config import settings


def setup_logging(
    log_level: str | None = None,
    log_to_console: bool | None = None,
    log_to_file: bool | None = None,
    log_file: str | None = None
) -> logging.Logger:
    """
    Configure enterprise-grade logging.

    Args:
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        log_to_console: Whether to log to console
        log_to_file: Whether to log to file
        log_file: Path to log file

    Returns:
        Configured logger instance
    """
    # Use settings defaults if not provided
    log_level = log_level or settings.LOG_LEVEL
    log_to_console = log_to_console if log_to_console is not None else settings.LOG_TO_CONSOLE
    log_to_file = log_to_file if log_to_file is not None else settings.LOG_TO_FILE
    log_file = log_file or settings.get_log_file_path()

    # Get root logger
    logger = logging.getLogger("ai_workbench")
    logger.setLevel(getattr(logging, log_level.upper()))

    # Remove existing handlers to avoid duplicates
    logger.handlers.clear()

    # Create formatter using settings
    formatter = logging.Formatter(
        fmt=settings.LOG_FORMAT,
        datefmt=settings.LOG_DATE_FORMAT
    )

    # Console handler
    if log_to_console:
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(getattr(logging, log_level.upper()))
        console_handler.setFormatter(formatter)
        logger.addHandler(console_handler)

    # File handler with rotation
    if log_to_file:
        log_path = Path(log_file)
        log_path.parent.mkdir(parents=True, exist_ok=True)

        file_handler = RotatingFileHandler(
            log_file,
            maxBytes=settings.LOG_FILE_MAX_BYTES,
            backupCount=settings.LOG_FILE_BACKUP_COUNT,
            encoding="utf-8"
        )
        file_handler.setLevel(getattr(logging, log_level.upper()))
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)

    # Prevent propagation to root logger
    logger.propagate = False

    return logger


# Initialize logger
logger = setup_logging()
