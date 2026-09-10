"""
Run script for the FastAPI backend.
Run this from the backend directory: python run.py
All server settings are loaded from environment variables via app.core.config
"""
import os
import sys
from pathlib import Path

# Add the backend directory to Python path
backend_dir = Path(__file__).parent.absolute()
sys.path.insert(0, str(backend_dir))

# Change to backend directory to ensure relative imports work
os.chdir(backend_dir)

import uvicorn

from app.core.config import settings
from app.core.logging_config import logger

if __name__ == "__main__":
    # All settings loaded from environment variables via settings
    logger.info(f"Starting server on {settings.HOST}:{settings.PORT}")
    logger.info(f"Environment: {settings.ENVIRONMENT}")
    logger.info(f"Reload enabled: {settings.RELOAD}")

    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.RELOAD and settings.ENVIRONMENT == "development",
        workers=settings.WORKERS if settings.ENVIRONMENT == "production" and not settings.RELOAD else 1,
    )
