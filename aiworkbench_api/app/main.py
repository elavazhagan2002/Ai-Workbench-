"""
Main FastAPI application.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.openapi.utils import get_openapi

from app.api.v1 import ai_assist, assessment_checklist, audit, auth, blogs, dashboard, domains, notifications, public, support, use_cases
from app.api.v1 import settings as settings_router
from app.core.config import settings
from app.core.database import Base, engine, run_migrations
from app.core.email_otp import redis_client as otp_redis_client
from app.core.logging_config import logger
from app.middleware.auth_middleware import AuthMiddleware
from app.middleware.logging_middleware import LoggingMiddleware
from app.middleware.security_headers_middleware import SecurityHeadersMiddleware
from app.services.ai_field_enhancement_service import ai_field_enhancement_service
from app.services.init_service import init_default_data

# Create database tables
Base.metadata.create_all(bind=engine)

# Run migrations to add missing columns
run_migrations()

# Initialize default data
init_default_data()

# Create FastAPI app
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    docs_url=settings.DOCS_URL,
    redoc_url=settings.REDOC_URL,
    openapi_url=settings.OPENAPI_URL,
)
@app.on_event("startup")
async def _startup_checks():
    try:
        otp_redis_client.ping()
        logger.info("Redis connection successful")
    except Exception as e:
        logger.warning(f"Redis connection failed: {e}")

    if settings.SMTP_USER and settings.SMTP_PASSWORD:
        logger.info("SMTP configuration detected")
    else:
        logger.warning("SMTP credentials missing")

    ai_field_enhancement_service.log_startup_diagnostics()
    if settings.LLM_STARTUP_SELF_TEST_ENABLED:
        connectivity_result = ai_field_enhancement_service.run_provider_connectivity_test()
        log_method = logger.info if connectivity_result.get("status") == "ok" else logger.warning
        log_method(
            "event=llm_provider_startup_self_test status=%s provider=%s model=%s base_url=%s "
            "api_key_fingerprint=%s detail=%s",
            connectivity_result.get("status", "unknown"),
            connectivity_result.get("provider", "unknown"),
            connectivity_result.get("model") or "missing",
            connectivity_result.get("base_url") or "missing",
            connectivity_result.get("api_key_fingerprint", "missing"),
            connectivity_result.get("detail", "n/a"),
        )

# CORS middleware - all settings from config
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=settings.CORS_ALLOW_ORIGIN_REGEX,
    allow_credentials=settings.CORS_ALLOW_CREDENTIALS,
    allow_methods=settings.CORS_ALLOW_METHODS,
    allow_headers=settings.CORS_ALLOW_HEADERS,
)

# Custom middleware (order matters - logging first, then auth, then security headers)
app.add_middleware(LoggingMiddleware)
app.add_middleware(AuthMiddleware)
app.add_middleware(SecurityHeadersMiddleware)

# Custom Swagger UI at configured endpoint (no authentication)
@app.get(settings.CUSTOM_DOCS_URL, include_in_schema=False)
async def custom_swagger_ui_html():
    """Custom Swagger UI endpoint without authentication."""
    return get_swagger_ui_html(
        openapi_url=settings.OPENAPI_URL,
        title=f"{settings.APP_NAME} - Swagger UI",
        oauth2_redirect_url=settings.SWAGGER_OAUTH2_REDIRECT_URL,
        swagger_js_url=settings.SWAGGER_UI_JS_URL,
        swagger_css_url=settings.SWAGGER_UI_CSS_URL,
    )


@app.get("/redoc", include_in_schema=False)
async def redoc_html():
    """ReDoc endpoint without authentication."""
    return get_redoc_html(
        openapi_url=settings.OPENAPI_URL,
        title=f"{settings.APP_NAME} - ReDoc",
    )


# Custom OpenAPI schema
def custom_openapi():
    """Generate custom OpenAPI schema."""
    if app.openapi_schema:
        return app.openapi_schema

    openapi_schema = get_openapi(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        description="AI Workbench API - Enterprise Grade Backend",
        routes=app.routes,
    )

    # Add security schemes
    openapi_schema["components"]["securitySchemes"] = {
        "BearerAuth": {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
        }
    }

    app.openapi_schema = openapi_schema
    return app.openapi_schema


app.openapi = custom_openapi

# Health check endpoint (public)
@app.get("/")
async def root():
    """Root endpoint."""
    return {"message": settings.APP_NAME, "version": settings.APP_VERSION}


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy", "version": settings.APP_VERSION}

# Include API routers
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(public.router, prefix="/api/public", tags=["Public"])
app.include_router(support.router, prefix="/api/support", tags=["Support"])
app.include_router(ai_assist.router, prefix="/api/v1/ai", tags=["AI Assist"])
app.include_router(blogs.router, prefix="/api/blogs", tags=["Blogs"])
app.include_router(domains.router, prefix="/api/domains", tags=["Domains"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(notifications.router, prefix="/api/notifications", tags=["Notifications"])
app.include_router(use_cases.router, prefix="/api/use-cases", tags=["Use Cases"])
app.include_router(settings_router.router, prefix="/api/settings", tags=["Settings"])
app.include_router(assessment_checklist.router, prefix="/api/settings/assessment-checklist", tags=["Assessment Checklist"])
app.include_router(audit.router, prefix="/api/audit", tags=["Audit"])

logger.info(f"{settings.APP_NAME} v{settings.APP_VERSION} initialized successfully")
logger.info(f"Environment: {settings.ENVIRONMENT}")
logger.info(f"Database: {settings.DATABASE_TYPE}")
