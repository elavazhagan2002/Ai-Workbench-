"""
Application configuration settings.
All configuration is externalized and can be set via environment variables.
"""
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # ==================== Application Settings ====================
    APP_NAME: str = "AI Governance Workbench API"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    ENVIRONMENT: Literal["development", "staging", "production"] = "development"

    # ==================== Server Settings ====================
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    RELOAD: bool = False  # Auto-reload on code changes (development only)
    WORKERS: int = 1  # Number of worker processes (production)

    # ==================== Database Settings ====================
    DATABASE_TYPE: Literal["sqlite", "mysql"] = "sqlite"

    # SQLite Configuration
    SQLITE_DATABASE_PATH: str = "./ai_workbench.db"  # Relative to backend directory
    SQLITE_CHECK_SAME_THREAD: bool = False  # Required for SQLite with FastAPI

    # File storage (e.g. use case reference documents). Path can be absolute or relative to backend directory.
    FILE_STORAGE_ROOT: str = "./file_storage"
    USE_CASE_DOCS_SUBDIR: str = "use_case_docs"
    BLOG_CONTENT_SUBDIR: str = "blog_content"

    # Demo videos (read-only folder used for mapping pre-recorded demo videos to use cases)
    DEMO_VIDEOS_ROOT: str = "./demo_videos"

    # MySQL Configuration
    MYSQL_HOST: str = "localhost"
    MYSQL_PORT: int = 3306
    MYSQL_USER: str = "root"
    MYSQL_PASSWORD: str = "root"
    MYSQL_DATABASE: str = "ai_workbench"
    MYSQL_POOL_PRE_PING: bool = True  # Verify connections before using
    MYSQL_POOL_SIZE: int = 5  # Connection pool size
    MYSQL_MAX_OVERFLOW: int = 10  # Max connections beyond pool_size
    MYSQL_POOL_RECYCLE: int = 3600  # Recycle connections after 1 hour

    # ==================== Security Settings ====================
    SECRET_KEY: str = "your-secret-key-change-in-production"

    # Client Credentials (for frontend authentication)
    CLIENT_ID: str = "ai-workbench-frontend"
    CLIENT_SECRET: str = "change-this-secret-in-production"

    # JWT Settings (for client authentication)
    JWT_SECRET_KEY: str = "your-jwt-secret-key-change-in-production"  # Should be different from SECRET_KEY
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60  # 1 hour
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7  # 7 days

    # Default admin bootstrap (optional; set via env to create/reset initial admin - never commit .env with real values)
    ADMIN_EMAIL: str | None = None
    ADMIN_INIT_PASSWORD: str | None = None

    # Session Settings (for user authentication)
    SESSION_COOKIE_NAME: str = "ai_workbench_session"
    SESSION_EXPIRE_HOURS: int = 24  # Session expires after 24 hours
    SESSION_COOKIE_HTTPONLY: bool = True  # HTTP-only cookie (not accessible via JavaScript)
    SESSION_COOKIE_SECURE: bool = False  # In production, set to True via validator if not overridden
    SESSION_COOKIE_SAMESITE: str = "lax"  # SameSite cookie policy

    # Client IP / proxy settings used by new-IP MFA and rate limiting.
    # Only accept X-Forwarded-For / X-Real-IP when the immediate peer is in this trusted proxy list.
    TRUSTED_PROXY_CIDRS: str | list[str] = "127.0.0.1/32,::1/128"

    # ==================== CORS Settings ====================
    # Must allow credentials for session cookies to work
    CORS_ORIGINS: str | list[str] = "http://localhost:5174,http://localhost:3000"
    CORS_ALLOW_ORIGIN_REGEX: str | None = None
    CORS_ALLOW_CREDENTIALS: bool = True  # Required for session cookies
    CORS_ALLOW_METHODS: str | list[str] = "*"
    CORS_ALLOW_HEADERS: str | list[str] = "*"

    @field_validator("TRUSTED_PROXY_CIDRS", "CORS_ORIGINS", "CORS_ALLOW_METHODS", "CORS_ALLOW_HEADERS", mode="before")
    @classmethod
    def parse_list_field(cls, v):
        """Parse comma-separated string into list."""
        if isinstance(v, str):
            return [item.strip() for item in v.split(",") if item.strip()]
        return v

    # ===== NEW CODE START =====
    # DEBUG env var validation:
    # - Accepts "true"/"false" (case-insensitive) and common boolean-like values.
    # - If invalid (e.g., "release"), coerces to False to avoid startup failure.
    @field_validator("DEBUG", mode="before")
    @classmethod
    def parse_debug_bool(cls, v):
        if isinstance(v, bool):
            return v
        if v is None:
            return False
        if isinstance(v, (int, float)):
            return bool(v)
        if isinstance(v, str):
            s = v.strip().lower()
            if s in ("true", "1", "yes", "y", "on"):
                return True
            if s in ("false", "0", "no", "n", "off", ""):
                return False
            return False
        return False
    # ===== NEW CODE END =====

    @model_validator(mode="after")
    def production_secrets_and_session_secure(self):
        """Apply environment-specific security and development defaults."""
        if self.ENVIRONMENT == "development" and not self.CORS_ALLOW_ORIGIN_REGEX:
            object.__setattr__(
                self,
                "CORS_ALLOW_ORIGIN_REGEX",
                r"^https?://(localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(:\d+)?$",
            )
        if self.ENVIRONMENT != "production":
            return self
        # Require non-default secrets in production
        default_secret_phrases = ("change-in-production", "your-secret-key-change-in-production", "your-jwt-secret-key-change-in-production")
        if any(phrase in self.SECRET_KEY for phrase in default_secret_phrases):
            raise ValueError("Production requires SECRET_KEY to be set via environment (no default).")
        if any(phrase in self.JWT_SECRET_KEY for phrase in default_secret_phrases):
            raise ValueError("Production requires JWT_SECRET_KEY to be set via environment (no default).")
        if "change-this-secret" in self.CLIENT_SECRET or "change-in-production" in self.CLIENT_SECRET:
            raise ValueError("Production requires CLIENT_SECRET to be set via environment (no default).")
        # Enforce secure cookie in production (override can still set via env to False if needed)
        object.__setattr__(self, "SESSION_COOKIE_SECURE", True)
        return self

    # ==================== Logging Settings ====================
    LOG_LEVEL: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    LOG_FILE: str = "logs/app.log"  # Relative to backend directory or absolute path
    LOG_FILE_MAX_BYTES: int = 10485760  # 10MB
    LOG_FILE_BACKUP_COUNT: int = 5
    LOG_TO_CONSOLE: bool = True
    LOG_TO_FILE: bool = True
    LOG_FORMAT: str = "%(asctime)s - %(name)s - %(levelname)s - %(module)s:%(lineno)d - %(message)s"
    LOG_DATE_FORMAT: str = "%Y-%m-%d %H:%M:%S"

    # ==================== Email Settings (for notifications/forgot password) ====================
    EMAIL_PROVIDER: Literal["smtp", "microsoft_graph"] = "smtp"
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str | None = None
    SMTP_FROM_EMAIL: str = "noreply@aiworkbench.com"
    SMTP_FROM_NAME: str = "AI Governance Workbench"
    SMTP_USE_TLS: bool = True


    MS_TENANT_ID: str = ""
    MS_CLIENT_ID: str = ""
    MS_CLIENT_SECRET: str = ""
    MS_SENDER_USER_ID: str = ""  # mailbox UPN/email, e.g. ai_support@yourdomain.com
    MS_GRAPH_SCOPE: str = "https://graph.microsoft.com/.default"
    MS_AUTHORITY_HOST: str = "https://login.microsoftonline.com"
    MS_GRAPH_BASE_URL: str = "https://graph.microsoft.com/v1.0"
    # ==================== Cloudflare Turnstile (optional, for registration) ====================
    TURNSTILE_SECRET_KEY: str = ""  # Server-side secret; if set, registration requires valid Turnstile token

    # ===== MODIFIED CODE START =====
    # Redis configuration for production-grade OTP storage (app.core.email_otp)
    # ==================== Redis Settings (for OTP/session scaling) ====================
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_DB: int = 0
    REDIS_PASSWORD: str | None = None
    # ===== MODIFIED CODE END =====

    # ==================== AI Enhancement Settings ====================
    LLM_ENABLED: bool = True
    LLM_PROVIDER: str | None = None
    LLM_API_KEY: str | None = None
    LLM_MODEL: str | None = None
    LLM_BASE_URL: str | None = None
    LLM_TIMEOUT_SECONDS: float = 20.0
    LLM_MAX_RETRIES: int = 1
    LLM_RETRY_BACKOFF_SECONDS: float = 0.5
    LLM_TEMPERATURE: float = 0.1
    LLM_MAX_TOKENS: int = 1100
    LLM_AZURE_API_VERSION: str = "2024-02-01"
    LLM_AZURE_DEPLOYMENT: str | None = None
    LLM_ANTHROPIC_VERSION: str = "2023-06-01"
    LLM_GEMINI_API_VERSION: str = "v1beta"
    LLM_STARTUP_SELF_TEST_ENABLED: bool = False

    # ==================== Office preview (Aspose) ====================
    # Headless PPT/PPTX + XLS/XLSX rendering. No Microsoft Office / LibreOffice required.
    ASPOSE_PREVIEW_ENABLED: bool = True
    ASPOSE_LICENSE_PATH: str | None = None
    ASPOSE_SLIDES_LICENSE_PATH: str | None = None
    ASPOSE_CELLS_LICENSE_PATH: str | None = None

    # ==================== API Documentation Settings ====================
    DOCS_URL: str | None = None  # Set to "/docs" to enable default Swagger
    REDOC_URL: str | None = None  # Set to "/redoc" to enable default ReDoc
    OPENAPI_URL: str = "/openapi.json"
    CUSTOM_DOCS_URL: str = "/doc"  # Custom Swagger UI endpoint

    # ==================== Swagger UI Settings ====================
    SWAGGER_UI_JS_URL: str = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"
    SWAGGER_UI_CSS_URL: str = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"
    SWAGGER_OAUTH2_REDIRECT_URL: str = "/doc/oauth2-redirect"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True
        extra = "ignore"  # Ignore extra fields not defined in the model (e.g., old JWT settings)

    def get_database_url(self) -> str:
        """Get database URL based on database type."""
        if self.DATABASE_TYPE == "mysql":
            return (
                f"mysql+pymysql://{self.MYSQL_USER}:{self.MYSQL_PASSWORD}"
                f"@{self.MYSQL_HOST}:{self.MYSQL_PORT}/{self.MYSQL_DATABASE}"
            )
        else:
            # SQLite - resolve path relative to backend directory
            db_path = Path(self.SQLITE_DATABASE_PATH)
            if not db_path.is_absolute():
                # Make path relative to backend directory
                backend_dir = Path(__file__).parent.parent.parent
                db_path = backend_dir / db_path
            return f"sqlite:///{db_path}"

    def get_log_file_path(self) -> str:
        """Get absolute path to log file."""
        log_path = Path(self.LOG_FILE)
        if log_path.is_absolute():
            return str(log_path)
        # Make path relative to backend directory
        backend_dir = Path(__file__).parent.parent.parent
        return str(backend_dir / log_path)

    def get_use_case_docs_root(self) -> Path:
        """Get absolute path to the root directory for use case reference documents (external storage)."""
        root = Path(self.FILE_STORAGE_ROOT)
        if not root.is_absolute():
            backend_dir = Path(__file__).parent.parent.parent
            root = backend_dir / root
        return root / self.USE_CASE_DOCS_SUBDIR

    def get_blog_content_root(self) -> Path:
        """Absolute path for blog/article files (under FILE_STORAGE_ROOT)."""
        root = Path(self.FILE_STORAGE_ROOT)
        if not root.is_absolute():
            backend_dir = Path(__file__).parent.parent.parent
            root = backend_dir / root
        return root / self.BLOG_CONTENT_SUBDIR

    def get_demo_videos_root(self) -> Path:
        """Get absolute path to the root directory that contains demo videos."""
        root = Path(self.DEMO_VIDEOS_ROOT)
        if not root.is_absolute():
            backend_dir = Path(__file__).parent.parent.parent
            root = backend_dir / root
        return root

    def _resolve_optional_file(self, value: str | None) -> Path | None:
        raw = (value or "").strip()
        if not raw:
            return None
        path = Path(raw)
        if not path.is_absolute():
            backend_dir = Path(__file__).parent.parent.parent
            path = backend_dir / path
        return path if path.is_file() else None

    def get_aspose_slides_license_path(self) -> Path | None:
        return self._resolve_optional_file(self.ASPOSE_SLIDES_LICENSE_PATH) or self._resolve_optional_file(
            self.ASPOSE_LICENSE_PATH
        )

    def get_aspose_cells_license_path(self) -> Path | None:
        return self._resolve_optional_file(self.ASPOSE_CELLS_LICENSE_PATH) or self._resolve_optional_file(
            self.ASPOSE_LICENSE_PATH
        )

    @field_validator(
        "LLM_PROVIDER",
        "LLM_API_KEY",
        "LLM_MODEL",
        "LLM_BASE_URL",
        "LLM_AZURE_API_VERSION",
        "LLM_AZURE_DEPLOYMENT",
        "LLM_ANTHROPIC_VERSION",
        "LLM_GEMINI_API_VERSION",
        mode="before",
    )
    @classmethod
    def normalize_optional_text(cls, v):
        """Normalize optional text settings by stripping whitespace and treating empty strings as missing."""
        if v is None:
            return None
        if isinstance(v, str):
            value = v.strip()
            return value or None
        return v

    @field_validator("LLM_ENABLED", "LLM_STARTUP_SELF_TEST_ENABLED", mode="before")
    @classmethod
    def parse_llm_boolean_settings(cls, v):
        """Parse LLM boolean settings from common env-style string values."""
        if isinstance(v, bool):
            return v
        if v is None:
            return False
        if isinstance(v, (int, float)):
            return bool(v)
        if isinstance(v, str):
            normalized = v.strip().lower()
            if normalized in {"true", "1", "yes", "y", "on"}:
                return True
            if normalized in {"false", "0", "no", "n", "off", ""}:
                return False
        raise ValueError("Expected a boolean value.")

    @field_validator("LLM_TIMEOUT_SECONDS", "LLM_RETRY_BACKOFF_SECONDS", "LLM_TEMPERATURE", mode="before")
    @classmethod
    def parse_llm_float_settings(cls, v):
        """Parse LLM numeric timeout/backoff settings from trimmed env values."""
        if isinstance(v, bool):
            raise ValueError("Expected a numeric value.")
        if isinstance(v, (int, float)):
            return float(v)
        if isinstance(v, str):
            normalized = v.strip()
            if not normalized:
                raise ValueError("Expected a numeric value.")
            return float(normalized)
        return v

    @field_validator("LLM_MAX_RETRIES", "LLM_MAX_TOKENS", mode="before")
    @classmethod
    def parse_llm_int_settings(cls, v):
        """Parse LLM retry settings from trimmed env values."""
        if isinstance(v, bool):
            raise ValueError("Expected an integer value.")
        if isinstance(v, int):
            return v
        if isinstance(v, float) and v.is_integer():
            return int(v)
        if isinstance(v, str):
            normalized = v.strip()
            if not normalized:
                raise ValueError("Expected an integer value.")
            return int(normalized)
        return v

    @field_validator("LLM_BASE_URL")
    @classmethod
    def validate_llm_base_url(cls, v: str | None) -> str | None:
        """Ensure the configured LLM base URL is a valid HTTP(S) endpoint."""
        if v is None:
            return None
        normalized = v.rstrip("/")
        parsed = urlparse(normalized)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("LLM_BASE_URL must be a valid http or https URL.")
        return normalized

    @field_validator("LLM_PROVIDER")
    @classmethod
    def validate_llm_provider(cls, v: str | None) -> str | None:
        """Normalize and validate the configured provider identifier when supplied."""
        if v is None:
            return None
        normalized = v.strip().lower().replace(" ", "_")
        allowed = {
            "openai_compatible",
            "openai-compatible",
            "compat",
            "generic",
            "generic_openai",
            "openai",
            "groq",
            "openrouter",
            "together",
            "xai",
            "grok",
            "local",
            "local_openai",
            "azure",
            "azure_openai",
            "anthropic",
            "gemini",
            "ollama",
        }
        if normalized not in allowed:
            raise ValueError(
                "LLM_PROVIDER must be one of: openai_compatible, openai, groq, openrouter, together, "
                "xai, grok, local_openai, azure_openai, anthropic, gemini, ollama."
            )
        return normalized

    @field_validator("LLM_TIMEOUT_SECONDS")
    @classmethod
    def validate_llm_timeout(cls, v: float) -> float:
        """Ensure the configured LLM timeout is positive."""
        if v <= 0:
            raise ValueError("LLM_TIMEOUT_SECONDS must be greater than 0.")
        return v

    @field_validator("LLM_TEMPERATURE")
    @classmethod
    def validate_llm_temperature(cls, v: float) -> float:
        """Keep temperature within a broadly safe cross-provider range."""
        if v < 0:
            raise ValueError("LLM_TEMPERATURE must be 0 or greater.")
        if v > 2:
            raise ValueError("LLM_TEMPERATURE must be 2 or less.")
        return v

    @field_validator("LLM_MAX_RETRIES")
    @classmethod
    def validate_llm_max_retries(cls, v: int) -> int:
        """Keep retries bounded to a small non-negative value suitable for request/response APIs."""
        if v < 0:
            raise ValueError("LLM_MAX_RETRIES must be 0 or greater.")
        if v > 5:
            raise ValueError("LLM_MAX_RETRIES must be 5 or less.")
        return v

    @field_validator("LLM_RETRY_BACKOFF_SECONDS")
    @classmethod
    def validate_llm_retry_backoff(cls, v: float) -> float:
        """Ensure the configured retry backoff is non-negative and reasonably bounded."""
        if v < 0:
            raise ValueError("LLM_RETRY_BACKOFF_SECONDS must be 0 or greater.")
        if v > 30:
            raise ValueError("LLM_RETRY_BACKOFF_SECONDS must be 30 or less.")
        return v

    @field_validator("LLM_MAX_TOKENS")
    @classmethod
    def validate_llm_max_tokens(cls, v: int) -> int:
        """Ensure the configured token budget is positive."""
        if v <= 0:
            raise ValueError("LLM_MAX_TOKENS must be greater than 0.")
        return v

    @model_validator(mode="after")
    def validate_llm_configuration(self):
        """Allow incomplete env LLM settings; admin portal can supply runtime config."""
        # Soft check only: do not fail process startup. Runtime validation happens in LLMGateway.
        return self

# Create logs directory if it doesn't exist
_logs_dir = Path(__file__).parent.parent.parent / "logs"
_logs_dir.mkdir(exist_ok=True)

settings = Settings()
