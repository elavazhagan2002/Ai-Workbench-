"""
Database connection and session management.
"""
from fastapi import HTTPException
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

from .config import settings
from .field_limits import (
    EXPECTED_BENEFITS_MAX_LENGTH,
    INTENDED_USE_MAX_LENGTH,
    USE_CASE_DESCRIPTION_MAX_LENGTH,
)
from .logging_config import logger

# Get database URL from settings
DATABASE_URL = settings.get_database_url()

# Create engine with appropriate configuration
if settings.DATABASE_TYPE == "sqlite":
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": settings.SQLITE_CHECK_SAME_THREAD},
        echo=settings.DEBUG
    )
    logger.info(f"Initialized SQLite database: {DATABASE_URL}")
else:
    # MySQL with connection pooling
    engine = create_engine(
        DATABASE_URL,
        echo=settings.DEBUG,
        pool_pre_ping=settings.MYSQL_POOL_PRE_PING,
        pool_size=settings.MYSQL_POOL_SIZE,
        max_overflow=settings.MYSQL_MAX_OVERFLOW,
        pool_recycle=settings.MYSQL_POOL_RECYCLE,
    )
    logger.info(
        f"Initialized MySQL database: {settings.MYSQL_HOST}:{settings.MYSQL_PORT}/"
        f"{settings.MYSQL_DATABASE} (pool_size={settings.MYSQL_POOL_SIZE})"
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    """
    Database session dependency for FastAPI.

    Yields:
        Database session
    """
    db = SessionLocal()
    try:
        yield db
        logger.debug("Database session created")
    except HTTPException:
        # Re-raise HTTPExceptions (like 401 Unauthorized) without logging as database errors
        raise
    except Exception as e:
        logger.error(f"Database session error: {str(e)}")
        db.rollback()
        raise
    finally:
        db.close()
        logger.debug("Database session closed")


def _get_sqlite_table_sql(conn, table_name: str) -> str:
    row = conn.execute(
        text("SELECT sql FROM sqlite_master WHERE type='table' AND name=:table_name"),
        {"table_name": table_name},
    ).fetchone()
    return row[0] if row and row[0] else ""


def _normalize_sql(sql: str) -> str:
    return " ".join((sql or "").lower().split())


def _get_sqlite_column_names(conn, table_name: str) -> set[str]:
    rows = conn.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
    return {row[1] for row in rows}


def _sqlite_rebuild_use_cases_table(conn):
    existing_columns = _get_sqlite_column_names(conn, "use_cases")
    copy_columns = [
        "use_case_id",
        "domain_id",
        "use_case_name",
        "use_case_title",
        "use_case_description",
        "intended_use",
        "expected_benefits",
        "department",
        "ai_category",
        "feasibility",
        "status",
        "intended_audience",
        "target_audience_type",
        "impacted_stakeholders",
        "technical_owner",
        "business_owner",
        "solution_design_overview",
        "human_in_loop_strategy",
        "bias_assessment_performed",
        "protected_attributes",
        "balancing_strategy",
        "rejection_reason",
        "created_by",
        "created_dt",
        "modified_by",
        "modified_dt",
        "demo_video_path",
    ]
    select_columns = []
    for column_name in copy_columns:
        if column_name not in existing_columns:
            select_columns.append(f"NULL AS {column_name}")
        elif column_name == "ai_category":
            select_columns.append(
                "CASE ai_category "
                "WHEN 'C' THEN 'P' "
                "WHEN 'D' THEN 'A' "
                "WHEN 'H' THEN 'S' "
                "WHEN 'P' THEN 'P' "
                "WHEN 'G' THEN 'G' "
                "WHEN 'A' THEN 'A' "
                "WHEN 'S' THEN 'S' "
                "ELSE NULL END AS ai_category"
            )
        else:
            select_columns.append(column_name)

    conn.execute(text("PRAGMA foreign_keys=OFF"))
    try:
        conn.execute(text("DROP TABLE IF EXISTS use_cases_new"))
        conn.execute(text(f"""
            CREATE TABLE use_cases_new (
                use_case_id VARCHAR(36) PRIMARY KEY,
                domain_id VARCHAR(36) NOT NULL,
                use_case_name VARCHAR(30) NOT NULL,
                use_case_title VARCHAR(100),
                use_case_description VARCHAR({USE_CASE_DESCRIPTION_MAX_LENGTH}),
                intended_use VARCHAR({INTENDED_USE_MAX_LENGTH}),
                expected_benefits VARCHAR({EXPECTED_BENEFITS_MAX_LENGTH}),
                department VARCHAR(30),
                ai_category CHAR(1) CHECK (ai_category IN ('P', 'G', 'A', 'S')),
                feasibility TEXT CHECK (feasibility IN ('Yes', 'No', 'Yes (Difficult)')),
                status TEXT DEFAULT 'New' CHECK (status IN ('New', 'Analysis', 'Review', 'Estimate', 'ROI', 'AI Assessment', 'Approved', 'Rejected', 'Development', 'Testing', 'Production', 'Retired')),
                intended_audience VARCHAR(200),
                target_audience_type TEXT,
                impacted_stakeholders TEXT,
                technical_owner VARCHAR(36),
                business_owner VARCHAR(36),
                solution_design_overview TEXT,
                human_in_loop_strategy VARCHAR(500),
                bias_assessment_performed BOOLEAN DEFAULT 0 NOT NULL,
                protected_attributes VARCHAR(500),
                balancing_strategy VARCHAR(1000),
                rejection_reason TEXT,
                created_by VARCHAR(36),
                created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
                modified_by VARCHAR(36),
                modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
                demo_video_path VARCHAR(300),
                FOREIGN KEY (domain_id) REFERENCES domains(domain_id) ON DELETE CASCADE,
                FOREIGN KEY (technical_owner) REFERENCES users(user_id),
                FOREIGN KEY (business_owner) REFERENCES users(user_id),
                FOREIGN KEY (created_by) REFERENCES users(user_id),
                FOREIGN KEY (modified_by) REFERENCES users(user_id)
            )
        """))
        conn.execute(text(f"""
            INSERT INTO use_cases_new (
                {", ".join(copy_columns)}
            )
            SELECT
                {", ".join(select_columns)}
            FROM use_cases
        """))
        conn.execute(text("DROP TABLE use_cases"))
        conn.execute(text("ALTER TABLE use_cases_new RENAME TO use_cases"))
    finally:
        conn.execute(text("PRAGMA foreign_keys=ON"))


def _sqlite_rebuild_use_case_risks_table(conn):
    existing_columns = _get_sqlite_column_names(conn, "use_case_risks")
    copy_columns = [
        "risk_id",
        "use_case_id",
        "risk_category",
        "risk_title",
        "risk_description",
        "risk_likelihood",
        "risk_impact",
        "mitigation_strategy",
        "risk_status",
        "risk_closure_comment",
        "created_by",
        "created_dt",
        "modified_by",
        "modified_dt",
    ]
    select_columns = [
        column_name if column_name in existing_columns else f"NULL AS {column_name}"
        for column_name in copy_columns
    ]

    conn.execute(text("PRAGMA foreign_keys=OFF"))
    try:
        conn.execute(text("DROP TABLE IF EXISTS use_case_risks_new"))
        conn.execute(text("""
            CREATE TABLE use_case_risks_new (
                risk_id INTEGER PRIMARY KEY AUTOINCREMENT,
                use_case_id VARCHAR(36) NOT NULL,
                risk_category TEXT CHECK (risk_category IN ('Business', 'Technical', 'Compliance', 'Operational', 'Data Quality')),
                risk_title VARCHAR(50),
                risk_description TEXT,
                risk_likelihood TEXT CHECK (risk_likelihood IN ('low', 'medium', 'high', 'critical')),
                risk_impact TEXT CHECK (risk_impact IN ('low', 'medium', 'high', 'critical')),
                mitigation_strategy TEXT,
                risk_status TEXT DEFAULT 'open' CHECK (risk_status IN ('open', 'closed', 'cancelled')),
                risk_closure_comment VARCHAR(200),
                created_by VARCHAR(36),
                created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
                modified_by VARCHAR(36),
                modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (use_case_id) REFERENCES use_cases(use_case_id) ON DELETE CASCADE,
                FOREIGN KEY (created_by) REFERENCES users(user_id),
                FOREIGN KEY (modified_by) REFERENCES users(user_id)
            )
        """))
        conn.execute(text(f"""
            INSERT INTO use_case_risks_new (
                {", ".join(copy_columns)}
            )
            SELECT
                {", ".join(select_columns)}
            FROM use_case_risks
        """))
        conn.execute(text("DROP TABLE use_case_risks"))
        conn.execute(text("ALTER TABLE use_case_risks_new RENAME TO use_case_risks"))
    finally:
        conn.execute(text("PRAGMA foreign_keys=ON"))


def _sqlite_rebuild_use_case_risk_reviews_table(conn):
    existing_columns = _get_sqlite_column_names(conn, "use_case_risk_reviews")
    copy_columns = [
        "risk_review_id",
        "use_case_id",
        "risk_category",
        "risk_title",
        "risk_description",
        "risk_likelihood",
        "risk_impact",
        "assigned_to",
        "mitigation_strategy",
        "closure_comment",
        "status",
        "created_by",
        "created_dt",
        "modified_by",
        "modified_dt",
    ]
    select_columns = [
        column_name if column_name in existing_columns else f"NULL AS {column_name}"
        for column_name in copy_columns
    ]

    conn.execute(text("PRAGMA foreign_keys=OFF"))
    try:
        conn.execute(text("DROP TABLE IF EXISTS use_case_risk_reviews_new"))
        conn.execute(text("""
            CREATE TABLE use_case_risk_reviews_new (
                risk_review_id INTEGER PRIMARY KEY AUTOINCREMENT,
                use_case_id VARCHAR(36) NOT NULL,
                risk_category TEXT CHECK (risk_category IN ('Operational', 'Business', 'Technical')),
                risk_title VARCHAR(50),
                risk_description TEXT,
                risk_likelihood TEXT CHECK (risk_likelihood IN ('low', 'medium', 'high', 'critical')),
                risk_impact TEXT CHECK (risk_impact IN ('low', 'medium', 'high', 'critical')),
                assigned_to VARCHAR(36),
                mitigation_strategy TEXT,
                closure_comment VARCHAR(500),
                status TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed')),
                created_by VARCHAR(36),
                created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
                modified_by VARCHAR(36),
                modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (use_case_id) REFERENCES use_cases(use_case_id) ON DELETE CASCADE,
                FOREIGN KEY (assigned_to) REFERENCES users(user_id),
                FOREIGN KEY (created_by) REFERENCES users(user_id),
                FOREIGN KEY (modified_by) REFERENCES users(user_id)
            )
        """))
        conn.execute(text(f"""
            INSERT INTO use_case_risk_reviews_new (
                {", ".join(copy_columns)}
            )
            SELECT
                {", ".join(select_columns)}
            FROM use_case_risk_reviews
        """))
        conn.execute(text("DROP TABLE use_case_risk_reviews"))
        conn.execute(text("ALTER TABLE use_case_risk_reviews_new RENAME TO use_case_risk_reviews"))
    finally:
        conn.execute(text("PRAGMA foreign_keys=ON"))


def run_migrations():
    """
    Run database migrations to add missing columns.
    This is called after Base.metadata.create_all() to handle schema updates.
    """
    logger.info("Checking for database migrations...")

    try:
        inspector = inspect(engine)
        columns = [col['name'] for col in inspector.get_columns('domains')]

        if 'owner_id' not in columns:
            logger.info("Adding owner_id column to domains table...")
            with engine.connect() as conn:
                try:
                    if settings.DATABASE_TYPE == "sqlite":
                        # SQLite doesn't support REFERENCES in ALTER TABLE ADD COLUMN
                        conn.execute(text("ALTER TABLE domains ADD COLUMN owner_id VARCHAR(36)"))
                    else:
                        # MySQL supports REFERENCES
                        conn.execute(text("ALTER TABLE domains ADD COLUMN owner_id VARCHAR(36) REFERENCES users(user_id)"))
                    conn.commit()
                    logger.info("Successfully added owner_id column to domains table")
                except Exception as e:
                    error_msg = str(e)
                    # If column already exists (race condition or already added), that's okay
                    if 'duplicate column' in error_msg.lower() or 'already exists' in error_msg.lower():
                        logger.debug("owner_id column already exists (may have been added concurrently)")
                    else:
                        logger.error(f"Error adding owner_id column: {error_msg}")
                        conn.rollback()
                        raise
        else:
            logger.debug("owner_id column already exists in domains table")
    except Exception as e:
        # If inspection fails, try to add the column anyway (will fail gracefully if it exists)
        logger.warning(f"Could not inspect table schema, attempting to add column: {str(e)}")
        with engine.connect() as conn:
            try:
                if settings.DATABASE_TYPE == "sqlite":
                    conn.execute(text("ALTER TABLE domains ADD COLUMN owner_id VARCHAR(36)"))
                else:
                    conn.execute(text("ALTER TABLE domains ADD COLUMN owner_id VARCHAR(36) REFERENCES users(user_id)"))
                conn.commit()
                logger.info("Successfully added owner_id column to domains table")
            except Exception as add_error:
                error_msg = str(add_error)
                # If column already exists, that's okay
                if 'duplicate column' in error_msg.lower() or 'already exists' in error_msg.lower() or 'duplicate column name' in error_msg.lower():
                    logger.debug("owner_id column already exists")
                else:
                    logger.error(f"Error adding owner_id column: {error_msg}")
                    conn.rollback()
                    # Don't raise - allow app to continue even if migration fails
                    # The error will be caught when trying to use the column

    # Add is_active column to users table (deactivate instead of delete)
    try:
        inspector = inspect(engine)
        if 'users' in inspector.get_table_names():
            columns = [col['name'] for col in inspector.get_columns('users')]
            if 'is_active' not in columns:
                logger.info("Adding is_active column to users table...")
                with engine.connect() as conn:
                    try:
                        if settings.DATABASE_TYPE == "sqlite":
                            conn.execute(text("ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT 1 NOT NULL"))
                        else:
                            conn.execute(text("ALTER TABLE users ADD COLUMN is_active BOOLEAN DEFAULT TRUE NOT NULL"))
                        conn.commit()
                        logger.info("Successfully added is_active column to users table")
                    except Exception as e:
                        error_msg = str(e)
                        if 'duplicate column' in error_msg.lower() or 'already exists' in error_msg.lower():
                            logger.debug("is_active column already exists")
                        else:
                            logger.error(f"Error adding is_active column: {error_msg}")
                            conn.rollback()
                            raise
            else:
                logger.debug("is_active column already exists in users table")
    except Exception as e:
        logger.warning(f"Could not add is_active to users: {str(e)}")

    # Add registration_status column to distinguish pending/rejected registrations from deactivated users
    try:
        inspector = inspect(engine)
        if 'users' in inspector.get_table_names():
            columns = [col['name'] for col in inspector.get_columns('users')]
            if 'registration_status' not in columns:
                logger.info("Adding registration_status column to users table...")
                with engine.connect() as conn:
                    try:
                        conn.execute(text("ALTER TABLE users ADD COLUMN registration_status VARCHAR(20) DEFAULT 'approved' NOT NULL"))
                        can_backfill_pending = 'interested_domain_id' in columns and 'domain_access' in inspector.get_table_names()
                        if can_backfill_pending and settings.DATABASE_TYPE == "sqlite":
                            conn.execute(text("""
                                UPDATE users
                                SET registration_status = 'pending'
                                WHERE is_active = 0
                                  AND interested_domain_id IS NOT NULL
                                  AND NOT EXISTS (
                                    SELECT 1 FROM domain_access da WHERE da.user_id = users.user_id
                                  )
                            """))
                        elif can_backfill_pending:
                            conn.execute(text("""
                                UPDATE users
                                SET registration_status = 'pending'
                                WHERE is_active = FALSE
                                  AND interested_domain_id IS NOT NULL
                                  AND NOT EXISTS (
                                    SELECT 1 FROM domain_access da WHERE da.user_id = users.user_id
                                  )
                            """))
                        if settings.DATABASE_TYPE == "sqlite":
                            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_users_registration_status ON users (registration_status)"))
                        conn.commit()
                        logger.info("Successfully added registration_status column to users table")
                    except Exception as e:
                        error_msg = str(e)
                        if 'duplicate column' in error_msg.lower() or 'already exists' in error_msg.lower():
                            logger.debug("registration_status column already exists")
                        else:
                            logger.error(f"Error adding registration_status column: {error_msg}")
                            conn.rollback()
                            raise
            else:
                logger.debug("registration_status column already exists in users table")
                if settings.DATABASE_TYPE == "sqlite":
                    with engine.connect() as conn:
                        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_users_registration_status ON users (registration_status)"))
                        conn.commit()
    except Exception as e:
        logger.warning(f"Could not add registration_status to users: {str(e)}")

    # Add organization_type column to users table (backed by organization_types lookup)
    try:
        inspector = inspect(engine)
        if 'users' in inspector.get_table_names():
            columns = [col['name'] for col in inspector.get_columns('users')]
            if 'organization_type' not in columns:
                logger.info("Adding organization_type column to users table...")
                with engine.connect() as conn:
                    try:
                        conn.execute(text("ALTER TABLE users ADD COLUMN organization_type VARCHAR(100)"))
                        conn.commit()
                        logger.info("Successfully added organization_type column to users table")
                    except Exception as e:
                        error_msg = str(e)
                        if 'duplicate column' in error_msg.lower() or 'already exists' in error_msg.lower():
                            logger.debug("organization_type column already exists")
                        else:
                            logger.error(f"Error adding organization_type column: {error_msg}")
                            conn.rollback()
                            raise
            else:
                logger.debug("organization_type column already exists in users table")
    except Exception as e:
        logger.warning(f"Could not add organization_type to users: {str(e)}")

    # Ensure organization_types lookup table exists
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        if 'organization_types' not in tables:
            logger.info("Creating organization_types lookup table...")
            with engine.connect() as conn:
                try:
                    if settings.DATABASE_TYPE == "sqlite":
                        conn.execute(text("""
                            CREATE TABLE IF NOT EXISTS organization_types (
                                org_type_id VARCHAR(36) PRIMARY KEY,
                                name VARCHAR(50) NOT NULL UNIQUE,
                                description VARCHAR(250),
                                created_by VARCHAR(36),
                                created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
                                modified_by VARCHAR(36),
                                modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP
                            )
                        """))
                    else:
                        conn.execute(text("""
                            CREATE TABLE IF NOT EXISTS organization_types (
                                org_type_id VARCHAR(36) PRIMARY KEY,
                                name VARCHAR(50) NOT NULL UNIQUE,
                                description VARCHAR(250),
                                created_by VARCHAR(36),
                                created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
                                modified_by VARCHAR(36),
                                modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP
                            )
                        """))
                    conn.commit()
                    logger.info("organization_types table ensured")
                except Exception as e:
                    error_msg = str(e)
                    if 'already exists' in error_msg.lower():
                        logger.debug("organization_types table already exists")
                    else:
                        logger.warning(f"Could not create organization_types table: {error_msg}")
                        conn.rollback()
        else:
            logger.debug("organization_types table already exists")
    except Exception as e:
        logger.warning(f"Could not verify/create organization_types table: {str(e)}")

    # Create anonymous_ideas table if it doesn't exist (for public idea submission)
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        if 'anonymous_ideas' not in tables:
            logger.info("Creating anonymous_ideas table...")
            with engine.connect() as conn:
                try:
                    if settings.DATABASE_TYPE == "sqlite":
                        conn.execute(text("""
                            CREATE TABLE anonymous_ideas (
                                idea_id VARCHAR(36) PRIMARY KEY,
                                domain_id VARCHAR(36),
                                idea_text TEXT NOT NULL,
                                submitted_by_name VARCHAR(100),
                                submitted_by_email VARCHAR(255),
                                submitted_by_organization VARCHAR(200),
                                status VARCHAR(20) DEFAULT 'new' NOT NULL,
                                qualified_use_case_id VARCHAR(36),
                                created_dt DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                                FOREIGN KEY (domain_id) REFERENCES domains(domain_id) ON DELETE SET NULL,
                                FOREIGN KEY (qualified_use_case_id) REFERENCES use_cases(use_case_id) ON DELETE SET NULL
                            )
                        """))
                    else:
                        conn.execute(text("""
                            CREATE TABLE anonymous_ideas (
                                idea_id VARCHAR(36) PRIMARY KEY,
                                domain_id VARCHAR(36),
                                idea_text TEXT NOT NULL,
                                submitted_by_name VARCHAR(100),
                                submitted_by_email VARCHAR(255),
                                submitted_by_organization VARCHAR(200),
                                status VARCHAR(20) DEFAULT 'new' NOT NULL,
                                qualified_use_case_id VARCHAR(36),
                                created_dt DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                                FOREIGN KEY (domain_id) REFERENCES domains(domain_id) ON DELETE SET NULL,
                                FOREIGN KEY (qualified_use_case_id) REFERENCES use_cases(use_case_id) ON DELETE SET NULL
                            )
                        """))
                    conn.commit()
                    logger.info("anonymous_ideas table created")
                except Exception as e:
                    error_msg = str(e)
                    logger.warning(f"Could not create anonymous_ideas table: {error_msg}")
                    conn.rollback()
        else:
            logger.debug("anonymous_ideas table already exists")
    except Exception as e:
        logger.warning(f"Could not verify/create anonymous_ideas table: {str(e)}")

    # Add submitted_by_email to anonymous_ideas if missing
    try:
        inspector = inspect(engine)
        if 'anonymous_ideas' in inspector.get_table_names():
            columns = [col['name'] for col in inspector.get_columns('anonymous_ideas')]
            if 'submitted_by_email' not in columns:
                logger.info("Adding submitted_by_email column to anonymous_ideas table...")
                with engine.connect() as conn:
                    try:
                        conn.execute(text("ALTER TABLE anonymous_ideas ADD COLUMN submitted_by_email VARCHAR(255)"))
                        conn.commit()
                        logger.info("Successfully added submitted_by_email to anonymous_ideas")
                    except Exception as e:
                        err = str(e).lower()
                        if 'duplicate' in err or 'already exists' in err:
                            logger.debug("submitted_by_email column already exists")
                        else:
                            logger.warning(f"Could not add submitted_by_email: {e}")
                            conn.rollback()
            else:
                logger.debug("submitted_by_email already exists in anonymous_ideas")
    except Exception as e:
        logger.warning(f"Could not check/add submitted_by_email: {str(e)}")

    # Create bug_reports table if it doesn't exist (bug/feature feedback with screenshot)
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        if 'bug_reports' not in tables:
            logger.info("Creating bug_reports table...")
            with engine.connect() as conn:
                try:
                    if settings.DATABASE_TYPE == "sqlite":
                        conn.execute(text("""
                            CREATE TABLE bug_reports (
                                report_id VARCHAR(36) PRIMARY KEY,
                                report_type VARCHAR(20) NOT NULL,
                                comments TEXT,
                                submitted_dt DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                                submitted_by VARCHAR(36),
                                screenshot TEXT,
                                release_number VARCHAR(50),
                                FOREIGN KEY (submitted_by) REFERENCES users(user_id) ON DELETE SET NULL
                            )
                        """))
                    else:
                        conn.execute(text("""
                            CREATE TABLE bug_reports (
                                report_id VARCHAR(36) PRIMARY KEY,
                                report_type VARCHAR(20) NOT NULL,
                                comments TEXT,
                                submitted_dt DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                                submitted_by VARCHAR(36),
                                screenshot LONGTEXT,
                                release_number VARCHAR(50),
                                FOREIGN KEY (submitted_by) REFERENCES users(user_id) ON DELETE SET NULL
                            )
                        """))
                    conn.commit()
                    logger.info("bug_reports table created")
                except Exception as e:
                    logger.warning(f"Could not create bug_reports table: {e}")
                    conn.rollback()
        else:
            logger.debug("bug_reports table already exists")
    except Exception as e:
        logger.warning(f"Could not verify/create bug_reports table: {str(e)}")

    # Add release_number to bug_reports if missing
    try:
        inspector = inspect(engine)
        if 'bug_reports' in inspector.get_table_names():
            columns = [col['name'] for col in inspector.get_columns('bug_reports')]
            if 'release_number' not in columns:
                logger.info("Adding release_number column to bug_reports table...")
                with engine.connect() as conn:
                    try:
                        conn.execute(text("ALTER TABLE bug_reports ADD COLUMN release_number VARCHAR(50)"))
                        conn.commit()
                        logger.info("Successfully added release_number to bug_reports")
                    except Exception as e:
                        err = str(e).lower()
                        if 'duplicate' in err or 'already exists' in err:
                            logger.debug("release_number column already exists in bug_reports")
                        else:
                            logger.warning(f"Could not add release_number to bug_reports: {e}")
                            conn.rollback()
            else:
                logger.debug("release_number already exists in bug_reports")
    except Exception as e:
        logger.warning(f"Could not check/add release_number to bug_reports: {str(e)}")

    # Add interested_domain_id to users table (for self-registration: domain to assign on approval)
    try:
        inspector = inspect(engine)
        if 'users' in inspector.get_table_names():
            columns = [col['name'] for col in inspector.get_columns('users')]
            if 'interested_domain_id' not in columns:
                logger.info("Adding interested_domain_id column to users table...")
                with engine.connect() as conn:
                    try:
                        if settings.DATABASE_TYPE == "sqlite":
                            conn.execute(text("ALTER TABLE users ADD COLUMN interested_domain_id VARCHAR(36)"))
                        else:
                            conn.execute(text(
                                "ALTER TABLE users ADD COLUMN interested_domain_id VARCHAR(36) "
                                "REFERENCES domains(domain_id) ON DELETE SET NULL"
                            ))
                        conn.commit()
                        logger.info("Successfully added interested_domain_id to users table")
                    except Exception as e:
                        error_msg = str(e)
                        if 'duplicate' in error_msg.lower() or 'already exists' in error_msg.lower():
                            logger.debug("interested_domain_id column already exists")
                        else:
                            logger.warning(f"Could not add interested_domain_id: {error_msg}")
                            conn.rollback()
            else:
                logger.debug("interested_domain_id column already exists in users table")
    except Exception as e:
        logger.warning(f"Could not check/add interested_domain_id: {str(e)}")

    # Update use_cases table constraint/column sizes to current definitions
    try:
        inspector = inspect(engine)
        if 'use_cases' in inspector.get_table_names():
            with engine.connect() as conn:
                if settings.DATABASE_TYPE == "sqlite":
                    try:
                        normalized_sql = _normalize_sql(_get_sqlite_table_sql(conn, "use_cases"))
                        needs_constraint_update = (
                            (
                                "ai_category in ('c', 'd', 'g')" in normalized_sql
                                and "ai_category in ('c', 'd', 'g', 'h')" not in normalized_sql
                            )
                            or (
                                "ai_category in ('c', 'd', 'g', 'h')" in normalized_sql
                                and "ai_category in ('p', 'g', 'a', 's')" not in normalized_sql
                            )
                        )
                        supports_description = (
                            f"use_case_description varchar({USE_CASE_DESCRIPTION_MAX_LENGTH})" in normalized_sql
                            or "use_case_description text" in normalized_sql
                        )
                        supports_benefits = (
                            f"expected_benefits varchar({EXPECTED_BENEFITS_MAX_LENGTH})" in normalized_sql
                            or "expected_benefits text" in normalized_sql
                        )
                        if needs_constraint_update or not supports_description or not supports_benefits:
                            logger.info("Rebuilding use_cases table to align AI category constraint and text field sizes...")
                            _sqlite_rebuild_use_cases_table(conn)
                            conn.commit()
                            logger.info("Successfully rebuilt use_cases table with current field sizes")
                        else:
                            logger.debug("use_cases table already has the current AI category constraint and field sizes")
                    except Exception as constraint_error:
                        error_msg = str(constraint_error)
                        if "no such table" in error_msg.lower() or "already exists" in error_msg.lower():
                            logger.debug(f"use_cases constraint update skipped: {error_msg}")
                        else:
                            logger.warning(f"Could not update use_cases constraint: {error_msg}")
                            conn.rollback()
                else:
                    try:
                        columns = {col["name"]: col for col in inspector.get_columns("use_cases")}
                        description_type = str(columns["use_case_description"]["type"]).lower() if "use_case_description" in columns else ""
                        benefits_type = str(columns["expected_benefits"]["type"]).lower() if "expected_benefits" in columns else ""
                        if (
                            f"varchar({USE_CASE_DESCRIPTION_MAX_LENGTH})" not in description_type
                            and "text" not in description_type
                        ):
                            conn.execute(
                                text(
                                    f"ALTER TABLE use_cases MODIFY COLUMN use_case_description VARCHAR({USE_CASE_DESCRIPTION_MAX_LENGTH}) NULL"
                                )
                            )
                            logger.info("Updated use_cases.use_case_description column size")
                        if (
                            f"varchar({EXPECTED_BENEFITS_MAX_LENGTH})" not in benefits_type
                            and "text" not in benefits_type
                        ):
                            conn.execute(
                                text(
                                    f"ALTER TABLE use_cases MODIFY COLUMN expected_benefits VARCHAR({EXPECTED_BENEFITS_MAX_LENGTH}) NULL"
                                )
                            )
                            logger.info("Updated use_cases.expected_benefits column size")
                        conn.commit()
                    except Exception as resize_error:
                        logger.warning(f"Could not update use_cases column sizes: {resize_error}")
                        conn.rollback()
    except Exception as e:
        logger.warning(f"Could not check/update use_cases constraint: {str(e)}")

    # Add intended_audience column to use_cases table
    try:
        inspector = inspect(engine)
        if 'use_cases' in inspector.get_table_names():
            columns = [col['name'] for col in inspector.get_columns('use_cases')]
            if 'intended_audience' not in columns:
                logger.info("Adding intended_audience column to use_cases table...")
                with engine.connect() as conn:
                    try:
                        conn.execute(text("ALTER TABLE use_cases ADD COLUMN intended_audience VARCHAR(200)"))
                        conn.commit()
                        logger.info("Successfully added intended_audience column to use_cases table")
                    except Exception as e:
                        error_msg = str(e)
                        if 'duplicate column' in error_msg.lower() or 'already exists' in error_msg.lower():
                            logger.debug("intended_audience column already exists")
                        else:
                            logger.warning(f"Could not add intended_audience column: {error_msg}")
                            conn.rollback()
            else:
                logger.debug("intended_audience column already exists in use_cases table")
    except Exception as e:
        logger.warning(f"Could not check/add intended_audience column: {str(e)}")

    # Add intended_use column to use_cases table
    try:
        inspector = inspect(engine)
        if 'use_cases' in inspector.get_table_names():
            columns = [col['name'] for col in inspector.get_columns('use_cases')]
            if 'intended_use' not in columns:
                logger.info("Adding intended_use column to use_cases table...")
                with engine.connect() as conn:
                    try:
                        conn.execute(text(f"ALTER TABLE use_cases ADD COLUMN intended_use VARCHAR({INTENDED_USE_MAX_LENGTH})"))
                        conn.commit()
                        logger.info("Successfully added intended_use column to use_cases table")
                    except Exception as e:
                        error_msg = str(e)
                        if 'duplicate column' in error_msg.lower() or 'already exists' in error_msg.lower():
                            logger.debug("intended_use column already exists")
                        else:
                            logger.warning(f"Could not add intended_use column: {error_msg}")
                            conn.rollback()
            else:
                logger.debug("intended_use column already exists in use_cases table")
    except Exception as e:
        logger.warning(f"Could not check/add intended_use column: {str(e)}")

    # Add demo_video_path column to use_cases if missing (for MySQL or already-updated SQLite schemas)
    try:
        inspector = inspect(engine)
        if 'use_cases' in inspector.get_table_names():
            columns = [col['name'] for col in inspector.get_columns('use_cases')]
            if 'demo_video_path' not in columns:
                logger.info("Adding demo_video_path column to use_cases table...")
                with engine.connect() as conn:
                    try:
                        conn.execute(text("ALTER TABLE use_cases ADD COLUMN demo_video_path VARCHAR(300)"))
                        conn.commit()
                        logger.info("Successfully added demo_video_path to use_cases table")
                    except Exception as e:
                        error_msg = str(e)
                        if 'duplicate column' in error_msg.lower() or 'already exists' in error_msg.lower():
                            logger.debug("demo_video_path column already exists")
                        else:
                            logger.warning(f"Could not add demo_video_path column: {error_msg}")
                            conn.rollback()
            else:
                logger.debug("demo_video_path column already exists in use_cases table")
    except Exception as e:
        logger.warning(f"Could not check/add demo_video_path column: {str(e)}")

    # Add technical_owner, business_owner, solution_design_overview to use_cases table
    try:
        inspector = inspect(engine)
        if 'use_cases' in inspector.get_table_names():
            columns = [col['name'] for col in inspector.get_columns('use_cases')]
            with engine.connect() as conn:
                for col_name, col_def in [
                    ('technical_owner', 'VARCHAR(36)' if settings.DATABASE_TYPE != "sqlite" else 'VARCHAR(36)'),
                    ('business_owner', 'VARCHAR(36)' if settings.DATABASE_TYPE != "sqlite" else 'VARCHAR(36)'),
                    ('solution_design_overview', 'TEXT'),
                ]:
                    if col_name not in columns:
                        try:
                            conn.execute(text(f"ALTER TABLE use_cases ADD COLUMN {col_name} {col_def}"))
                            conn.commit()
                            logger.info(f"Added {col_name} column to use_cases table")
                        except Exception as e:
                            error_msg = str(e)
                            if 'duplicate column' in error_msg.lower() or 'already exists' in error_msg.lower():
                                logger.debug(f"{col_name} column already exists")
                            else:
                                logger.warning(f"Could not add {col_name}: {error_msg}")
                                conn.rollback()
                    else:
                        logger.debug(f"{col_name} column already exists in use_cases table")
    except Exception as e:
        logger.warning(f"Could not check/add technical_owner, business_owner, solution_design_overview: {str(e)}")

    # Add rejection_reason column to use_cases table
    try:
        inspector = inspect(engine)
        if 'use_cases' in inspector.get_table_names():
            columns = [col['name'] for col in inspector.get_columns('use_cases')]
            if 'rejection_reason' not in columns:
                try:
                    with engine.connect() as conn:
                        conn.execute(text("ALTER TABLE use_cases ADD COLUMN rejection_reason TEXT"))
                        conn.commit()
                        logger.info("Added rejection_reason column to use_cases table")
                except Exception as e:
                    error_msg = str(e)
                    if 'duplicate column' in error_msg.lower() or 'already exists' in error_msg.lower():
                        logger.debug("rejection_reason column already exists")
                    else:
                        logger.warning(f"Could not add rejection_reason: {error_msg}")
            else:
                logger.debug("rejection_reason column already exists in use_cases table")
    except Exception as e:
        logger.warning(f"Could not check/add rejection_reason column: {str(e)}")

    # Add organization column to users table
    try:
        inspector = inspect(engine)
        if 'users' in inspector.get_table_names():
            columns = [col['name'] for col in inspector.get_columns('users')]
            if 'organization' not in columns:
                try:
                    with engine.connect() as conn:
                        conn.execute(text("ALTER TABLE users ADD COLUMN organization VARCHAR(100)"))
                        conn.commit()
                        logger.info("Added organization column to users table")
                except Exception as e:
                    error_msg = str(e)
                    if 'duplicate column' in error_msg.lower() or 'already exists' in error_msg.lower():
                        logger.debug("organization column already exists")
                    else:
                        logger.warning(f"Could not add organization: {error_msg}")
            else:
                logger.debug("organization column already exists in users table")
    except Exception as e:
        logger.warning(f"Could not check/add organization column: {str(e)}")

    # Create use_case_tags table if it doesn't exist
    try:
        inspector = inspect(engine)
        table_names = inspector.get_table_names()
        if 'use_case_tags' not in table_names:
            logger.info("Creating use_case_tags table...")
            with engine.connect() as conn:
                try:
                    if settings.DATABASE_TYPE == "sqlite":
                        conn.execute(text("""
                            CREATE TABLE use_case_tags (
                                tag_id INTEGER PRIMARY KEY AUTOINCREMENT,
                                use_case_id VARCHAR(36) NOT NULL,
                                tag_name VARCHAR(50) NOT NULL,
                                created_by VARCHAR(36),
                                created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
                                FOREIGN KEY (use_case_id) REFERENCES use_cases(use_case_id) ON DELETE CASCADE,
                                FOREIGN KEY (created_by) REFERENCES users(user_id)
                            )
                        """))
                    else:
                        conn.execute(text("""
                            CREATE TABLE use_case_tags (
                                tag_id INT AUTO_INCREMENT PRIMARY KEY,
                                use_case_id VARCHAR(36) NOT NULL,
                                tag_name VARCHAR(50) NOT NULL,
                                created_by VARCHAR(36),
                                created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
                                FOREIGN KEY (use_case_id) REFERENCES use_cases(use_case_id) ON DELETE CASCADE,
                                FOREIGN KEY (created_by) REFERENCES users(user_id)
                            )
                        """))
                    conn.commit()
                    logger.info("Successfully created use_case_tags table")
                except Exception as e:
                    error_msg = str(e)
                    if 'already exists' in error_msg.lower() or 'duplicate' in error_msg.lower():
                        logger.debug("use_case_tags table already exists")
                    else:
                        logger.warning(f"Could not create use_case_tags table: {error_msg}")
                        conn.rollback()
        else:
            logger.debug("use_case_tags table already exists")
    except Exception as e:
        logger.warning(f"Could not check/create use_case_tags table: {str(e)}")
        # Don't raise - allow app to continue

    # Add rating column to use_case_reviews table (1-5 star reviewer rating)
    try:
        inspector = inspect(engine)
        if 'use_case_reviews' in inspector.get_table_names():
            columns = [col['name'] for col in inspector.get_columns('use_case_reviews')]
            if 'rating' not in columns:
                logger.info("Adding rating column to use_case_reviews table...")
                with engine.connect() as conn:
                    try:
                        conn.execute(text("ALTER TABLE use_case_reviews ADD COLUMN rating INTEGER"))
                        conn.commit()
                        logger.info("Successfully added rating column to use_case_reviews table")
                    except Exception as e:
                        error_msg = str(e)
                        if 'duplicate column' in error_msg.lower() or 'already exists' in error_msg.lower():
                            logger.debug("rating column already exists")
                        else:
                            logger.warning(f"Could not add rating column: {error_msg}")
                            conn.rollback()
            else:
                logger.debug("rating column already exists in use_case_reviews table")
    except Exception as e:
        logger.warning(f"Could not check/add rating column: {str(e)}")

    # Ensure trusted login IP table exists for login MFA.
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        if 'user_login_ips' not in tables:
            logger.info("Creating user_login_ips table...")
            with engine.connect() as conn:
                try:
                    if settings.DATABASE_TYPE == "sqlite":
                        conn.execute(text("""
                            CREATE TABLE IF NOT EXISTS user_login_ips (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                user_id VARCHAR(36) NOT NULL,
                                ip_address VARCHAR(45) NOT NULL,
                                first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                verified_via_passcode BOOLEAN NOT NULL DEFAULT 1,
                                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                UNIQUE (user_id, ip_address),
                                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
                            )
                        """))
                    else:
                        conn.execute(text("""
                            CREATE TABLE IF NOT EXISTS user_login_ips (
                                id INTEGER PRIMARY KEY AUTO_INCREMENT,
                                user_id VARCHAR(36) NOT NULL,
                                ip_address VARCHAR(45) NOT NULL,
                                first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                verified_via_passcode BOOLEAN NOT NULL DEFAULT TRUE,
                                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                UNIQUE KEY uq_user_login_ips_user_ip (user_id, ip_address),
                                INDEX ix_user_login_ips_user_id (user_id),
                                INDEX ix_user_login_ips_ip_address (ip_address),
                                CONSTRAINT fk_user_login_ips_user_id FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
                            )
                        """))
                    if settings.DATABASE_TYPE == "sqlite":
                        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_user_login_ips_user_id ON user_login_ips (user_id)"))
                        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_user_login_ips_ip_address ON user_login_ips (ip_address)"))
                    conn.commit()
                    logger.info("user_login_ips table ensured")
                except Exception as e:
                    error_msg = str(e)
                    if 'already exists' in error_msg.lower():
                        logger.debug("user_login_ips table already exists")
                    else:
                        logger.warning(f"Could not create user_login_ips table: {error_msg}")
                        conn.rollback()
        else:
            logger.debug("user_login_ips table already exists")
    except Exception as e:
        logger.warning(f"Could not verify/create user_login_ips table: {str(e)}")

    # Authenticator-app TOTP columns on users.
    try:
        inspector = inspect(engine)
        if 'users' in inspector.get_table_names():
            columns = [col['name'] for col in inspector.get_columns('users')]
            additions = []
            if 'totp_secret' not in columns:
                additions.append("totp_secret TEXT")
            if 'totp_enabled' not in columns:
                additions.append(
                    "totp_enabled BOOLEAN DEFAULT 0 NOT NULL"
                    if settings.DATABASE_TYPE == "sqlite"
                    else "totp_enabled BOOLEAN DEFAULT FALSE NOT NULL"
                )
            if 'totp_prompt_seen' not in columns:
                additions.append(
                    "totp_prompt_seen BOOLEAN DEFAULT 0 NOT NULL"
                    if settings.DATABASE_TYPE == "sqlite"
                    else "totp_prompt_seen BOOLEAN DEFAULT FALSE NOT NULL"
                )
            if 'totp_confirmed_at' not in columns:
                additions.append("totp_confirmed_at DATETIME")
            if 'preferred_mfa_method' not in columns:
                additions.append("preferred_mfa_method VARCHAR(20) DEFAULT 'email' NOT NULL")
            if additions:
                logger.info("Adding TOTP columns to users table...")
                with engine.connect() as conn:
                    try:
                        for column_sql in additions:
                            col_name = column_sql.split()[0]
                            conn.execute(text(f"ALTER TABLE users ADD COLUMN {column_sql}"))
                            logger.info(f"Added users.{col_name}")
                        conn.commit()
                    except Exception as e:
                        error_msg = str(e)
                        if 'duplicate column' in error_msg.lower() or 'already exists' in error_msg.lower():
                            logger.debug("TOTP columns already exist")
                            conn.rollback()
                        else:
                            logger.error(f"Error adding TOTP columns: {error_msg}")
                            conn.rollback()
            else:
                logger.debug("TOTP columns already exist in users table")
    except Exception as e:
        logger.warning(f"Could not add TOTP columns to users: {str(e)}")

    # Update legacy use_case_risks table text fields if the table still exists
    try:
        inspector = inspect(engine)
        if 'use_case_risks' in inspector.get_table_names():
            with engine.connect() as conn:
                if settings.DATABASE_TYPE == "sqlite":
                    try:
                        normalized_sql = _normalize_sql(_get_sqlite_table_sql(conn, "use_case_risks"))
                        supports_risk_description = "risk_description text" in normalized_sql
                        supports_mitigation = "mitigation_strategy text" in normalized_sql
                        if not supports_risk_description or not supports_mitigation:
                            logger.info("Rebuilding legacy use_case_risks table to widen text fields...")
                            _sqlite_rebuild_use_case_risks_table(conn)
                            conn.commit()
                            logger.info("Successfully rebuilt legacy use_case_risks table")
                        else:
                            logger.debug("legacy use_case_risks table already supports current text field sizes")
                    except Exception as resize_error:
                        logger.warning(f"Could not rebuild legacy use_case_risks table: {resize_error}")
                        conn.rollback()
                else:
                    try:
                        columns = {col["name"]: col for col in inspector.get_columns("use_case_risks")}
                        risk_description_type = str(columns["risk_description"]["type"]).lower() if "risk_description" in columns else ""
                        mitigation_type = str(columns["mitigation_strategy"]["type"]).lower() if "mitigation_strategy" in columns else ""
                        if "text" not in risk_description_type:
                            conn.execute(text("ALTER TABLE use_case_risks MODIFY COLUMN risk_description TEXT NULL"))
                            logger.info("Updated use_case_risks.risk_description column size")
                        if "text" not in mitigation_type:
                            conn.execute(text("ALTER TABLE use_case_risks MODIFY COLUMN mitigation_strategy TEXT NULL"))
                            logger.info("Updated use_case_risks.mitigation_strategy column size")
                        conn.commit()
                    except Exception as resize_error:
                        logger.warning(f"Could not update legacy use_case_risks column sizes: {resize_error}")
                        conn.rollback()
    except Exception as e:
        logger.warning(f"Could not check/update legacy use_case_risks table: {str(e)}")

    # Create use_case_risk_reviews table (merged risks + reviews)
    try:
        inspector = inspect(engine)
        table_names = inspector.get_table_names()
        if 'use_case_risk_reviews' not in table_names:
            logger.info("Creating use_case_risk_reviews table...")
            with engine.connect() as conn:
                try:
                    if settings.DATABASE_TYPE == "sqlite":
                        conn.execute(text("""
                            CREATE TABLE use_case_risk_reviews (
                                risk_review_id INTEGER PRIMARY KEY AUTOINCREMENT,
                                use_case_id VARCHAR(36) NOT NULL,
                                risk_category TEXT CHECK (risk_category IN ('Operational', 'Business', 'Technical')),
                                risk_title VARCHAR(50),
                                risk_description TEXT,
                                risk_likelihood TEXT CHECK (risk_likelihood IN ('low', 'medium', 'high', 'critical')),
                                risk_impact TEXT CHECK (risk_impact IN ('low', 'medium', 'high', 'critical')),
                                assigned_to VARCHAR(36),
                                mitigation_strategy TEXT,
                                closure_comment VARCHAR(500),
                                status TEXT DEFAULT 'open' CHECK (status IN ('open', 'closed')),
                                created_by VARCHAR(36),
                                created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
                                modified_by VARCHAR(36),
                                modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
                                FOREIGN KEY (use_case_id) REFERENCES use_cases(use_case_id) ON DELETE CASCADE,
                                FOREIGN KEY (assigned_to) REFERENCES users(user_id),
                                FOREIGN KEY (created_by) REFERENCES users(user_id),
                                FOREIGN KEY (modified_by) REFERENCES users(user_id)
                            )
                        """))
                    else:
                        conn.execute(text("""
                            CREATE TABLE use_case_risk_reviews (
                                risk_review_id INT AUTO_INCREMENT PRIMARY KEY,
                                use_case_id VARCHAR(36) NOT NULL,
                                risk_category VARCHAR(30) CHECK (risk_category IN ('Operational', 'Business', 'Technical')),
                                risk_title VARCHAR(50),
                                risk_description TEXT,
                                risk_likelihood VARCHAR(20) CHECK (risk_likelihood IN ('low', 'medium', 'high', 'critical')),
                                risk_impact VARCHAR(20) CHECK (risk_impact IN ('low', 'medium', 'high', 'critical')),
                                assigned_to VARCHAR(36),
                                mitigation_strategy TEXT,
                                closure_comment VARCHAR(500),
                                status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'closed')),
                                created_by VARCHAR(36),
                                created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
                                modified_by VARCHAR(36),
                                modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                                FOREIGN KEY (use_case_id) REFERENCES use_cases(use_case_id) ON DELETE CASCADE,
                                FOREIGN KEY (assigned_to) REFERENCES users(user_id),
                                FOREIGN KEY (created_by) REFERENCES users(user_id),
                                FOREIGN KEY (modified_by) REFERENCES users(user_id)
                            )
                        """))
                    conn.commit()
                    logger.info("Successfully created use_case_risk_reviews table")
                except Exception as e:
                    error_msg = str(e)
                    if 'already exists' in error_msg.lower() or 'duplicate' in error_msg.lower():
                        logger.debug("use_case_risk_reviews table already exists")
                    else:
                        logger.warning(f"Could not create use_case_risk_reviews table: {error_msg}")
                        conn.rollback()
        else:
            logger.debug("use_case_risk_reviews table already exists")
    except Exception as e:
        logger.warning(f"Could not check/create use_case_risk_reviews table: {str(e)}")

    # One-time migrate data from use_case_risks to use_case_risk_reviews (if risks table exists and risk_reviews empty)
    try:
        inspector = inspect(engine)
        if 'use_case_risk_reviews' in inspector.get_table_names() and 'use_case_risks' in inspector.get_table_names():
            with engine.connect() as conn:
                count = conn.execute(text("SELECT COUNT(*) FROM use_case_risk_reviews")).scalar()
                if count == 0:
                    risk_count = conn.execute(text("SELECT COUNT(*) FROM use_case_risks")).scalar()
                    if risk_count and risk_count > 0:
                        logger.info("Migrating data from use_case_risks to use_case_risk_reviews...")
                        if settings.DATABASE_TYPE == "sqlite":
                            conn.execute(text("""
                                INSERT INTO use_case_risk_reviews
                                (use_case_id, risk_category, risk_title, risk_description, risk_likelihood, risk_impact,
                                 mitigation_strategy, closure_comment, status, created_by, created_dt, modified_by, modified_dt)
                                SELECT use_case_id,
                                       CASE WHEN risk_category IN ('Operational','Business','Technical') THEN risk_category ELSE 'Business' END,
                                       risk_title, risk_description,
                                       CASE WHEN risk_likelihood IN ('low','medium','high','critical') THEN risk_likelihood ELSE 'medium' END,
                                       CASE WHEN risk_impact IN ('low','medium','high','critical') THEN risk_impact ELSE 'medium' END,
                                       mitigation_strategy, risk_closure_comment,
                                       CASE WHEN risk_status IN ('open','closed') THEN risk_status ELSE 'closed' END,
                                       created_by, created_dt, modified_by, modified_dt
                                FROM use_case_risks
                            """))
                        else:
                            conn.execute(text("""
                                INSERT INTO use_case_risk_reviews
                                (use_case_id, risk_category, risk_title, risk_description, risk_likelihood, risk_impact,
                                 mitigation_strategy, closure_comment, status, created_by, created_dt, modified_by, modified_dt)
                                SELECT use_case_id,
                                       IF(risk_category IN ('Operational','Business','Technical'), risk_category, 'Business'),
                                       risk_title, risk_description,
                                       IF(risk_likelihood IN ('low','medium','high','critical'), risk_likelihood, 'medium'),
                                       IF(risk_impact IN ('low','medium','high','critical'), risk_impact, 'medium'),
                                       mitigation_strategy, risk_closure_comment,
                                       IF(risk_status IN ('open','closed'), risk_status, 'closed'),
                                       created_by, created_dt, modified_by, modified_dt
                                FROM use_case_risks
                            """))
                        conn.commit()
                        logger.info("Migrated use_case_risks data to use_case_risk_reviews")
    except Exception as e:
        logger.warning(f"Could not migrate use_case_risks to use_case_risk_reviews: {str(e)}")

    # Add rating column to use_case_comments table (1-5 star rating on comment)
    try:
        inspector = inspect(engine)
        if 'use_case_comments' in inspector.get_table_names():
            columns = [col['name'] for col in inspector.get_columns('use_case_comments')]
            if 'rating' not in columns:
                logger.info("Adding rating column to use_case_comments table...")
                with engine.connect() as conn:
                    try:
                        conn.execute(text("ALTER TABLE use_case_comments ADD COLUMN rating INTEGER"))
                        conn.commit()
                        logger.info("Successfully added rating column to use_case_comments table")
                    except Exception as e:
                        error_msg = str(e)
                        if 'duplicate column' in error_msg.lower() or 'already exists' in error_msg.lower():
                            logger.debug("rating column already exists")
                        else:
                            logger.warning(f"Could not add rating column: {error_msg}")
                            conn.rollback()
            else:
                logger.debug("rating column already exists in use_case_comments table")
    except Exception as e:
        logger.warning(f"Could not check/add rating column: {str(e)}")

    # Extend use_case_data with governance and usage metadata columns
    try:
        inspector = inspect(engine)
        if 'use_case_data' in inspector.get_table_names():
            columns = [col['name'] for col in inspector.get_columns('use_case_data')]
            boolean_default = "BOOLEAN DEFAULT 0 NOT NULL" if settings.DATABASE_TYPE == "sqlite" else "BOOLEAN DEFAULT FALSE NOT NULL"
            json_type = "JSON" if settings.DATABASE_TYPE != "sqlite" else "TEXT"
            column_definitions = [
                ('data_classification', 'VARCHAR(30)'),
                ('data_owner', 'VARCHAR(100)'),
                ('data_usage', json_type),
                ('is_pii_phi_involved', boolean_default),
                ('dataset_type', 'VARCHAR(20)'),
                ('data_lineage_available', boolean_default),
                ('data_quality_assessed', boolean_default),
                ('data_freshness_confirmed', boolean_default),
            ]
            with engine.connect() as conn:
                for col_name, col_def in column_definitions:
                    if col_name in columns:
                        continue
                    try:
                        conn.execute(text(f"ALTER TABLE use_case_data ADD COLUMN {col_name} {col_def}"))
                        conn.commit()
                        logger.info(f"Added {col_name} column to use_case_data table")
                    except Exception as e:
                        error_msg = str(e)
                        if 'duplicate column' in error_msg.lower() or 'already exists' in error_msg.lower():
                            logger.debug(f"{col_name} column already exists on use_case_data")
                        else:
                            logger.warning(f"Could not add {col_name} to use_case_data: {error_msg}")
                            conn.rollback()
    except Exception as e:
        logger.warning(f"Could not extend use_case_data columns: {str(e)}")

    # Migrate legacy AI category codes and refresh SQLite constraint when needed
    try:
        inspector = inspect(engine)
        if 'use_cases' in inspector.get_table_names():
            with engine.connect() as conn:
                if settings.DATABASE_TYPE == "sqlite":
                    normalized_sql = _normalize_sql(_get_sqlite_table_sql(conn, "use_cases"))
                    needs_ai_category_constraint_update = (
                        "ai_category in ('c', 'd', 'g', 'h')" in normalized_sql
                        and "ai_category in ('p', 'g', 'a', 's')" not in normalized_sql
                    )
                    if needs_ai_category_constraint_update:
                        logger.info("Rebuilding use_cases table to apply updated AI category constraint...")
                        _sqlite_rebuild_use_cases_table(conn)
                        conn.commit()
                        logger.info("Successfully rebuilt use_cases table with updated AI category constraint")
                else:
                    for old_code, new_code in (("C", "P"), ("D", "A"), ("H", "S")):
                        conn.execute(
                            text("UPDATE use_cases SET ai_category = :new_code WHERE ai_category = :old_code"),
                            {"new_code": new_code, "old_code": old_code},
                        )
                    conn.commit()
                    logger.info("Migrated legacy AI category codes on use_cases table")
    except Exception as e:
        logger.warning(f"Could not migrate AI category codes: {str(e)}")

    # Add target_audience_type column to use_cases table
    try:
        inspector = inspect(engine)
        if 'use_cases' in inspector.get_table_names():
            columns = [col['name'] for col in inspector.get_columns('use_cases')]
            if 'target_audience_type' not in columns:
                json_type = "JSON" if settings.DATABASE_TYPE != "sqlite" else "TEXT"
                with engine.connect() as conn:
                    try:
                        conn.execute(text(f"ALTER TABLE use_cases ADD COLUMN target_audience_type {json_type}"))
                        conn.commit()
                        logger.info("Added target_audience_type column to use_cases table")
                    except Exception as e:
                        error_msg = str(e)
                        if 'duplicate column' in error_msg.lower() or 'already exists' in error_msg.lower():
                            logger.debug("target_audience_type column already exists")
                        else:
                            logger.warning(f"Could not add target_audience_type column: {error_msg}")
                            conn.rollback()
    except Exception as e:
        logger.warning(f"Could not check/add target_audience_type column: {str(e)}")

    # Add impacted_stakeholders column to use_cases table
    try:
        inspector = inspect(engine)
        if 'use_cases' in inspector.get_table_names():
            columns = [col['name'] for col in inspector.get_columns('use_cases')]
            if 'impacted_stakeholders' not in columns:
                json_type = "JSON" if settings.DATABASE_TYPE != "sqlite" else "TEXT"
                with engine.connect() as conn:
                    try:
                        conn.execute(text(f"ALTER TABLE use_cases ADD COLUMN impacted_stakeholders {json_type}"))
                        conn.commit()
                        logger.info("Added impacted_stakeholders column to use_cases table")
                    except Exception as e:
                        error_msg = str(e)
                        if 'duplicate column' in error_msg.lower() or 'already exists' in error_msg.lower():
                            logger.debug("impacted_stakeholders column already exists")
                        else:
                            logger.warning(f"Could not add impacted_stakeholders column: {error_msg}")
                            conn.rollback()
    except Exception as e:
        logger.warning(f"Could not check/add impacted_stakeholders column: {str(e)}")

    # Add 'critical' to risk likelihood/impact on use_case_risk_reviews (SQLite requires table rebuild)
    try:
        inspector = inspect(engine)
        if 'use_case_risk_reviews' in inspector.get_table_names():
            with engine.connect() as conn:
                if settings.DATABASE_TYPE == "sqlite":
                    try:
                        normalized_sql = _normalize_sql(_get_sqlite_table_sql(conn, "use_case_risk_reviews"))
                        needs_critical_level = (
                            "risk_likelihood in ('low', 'medium', 'high')" in normalized_sql
                            and "risk_likelihood in ('low', 'medium', 'high', 'critical')" not in normalized_sql
                        )
                        if needs_critical_level:
                            logger.info("Rebuilding use_case_risk_reviews table to add critical risk level...")
                            _sqlite_rebuild_use_case_risk_reviews_table(conn)
                            conn.commit()
                            logger.info("Successfully rebuilt use_case_risk_reviews table with critical level")
                        else:
                            logger.debug("use_case_risk_reviews table already supports critical risk level")
                    except Exception as rebuild_error:
                        logger.warning(f"Could not rebuild use_case_risk_reviews table: {rebuild_error}")
                        conn.rollback()
    except Exception as e:
        logger.warning(f"Could not check/update use_case_risk_reviews risk levels: {str(e)}")

    # Add human_in_loop_strategy column to use_cases table
    try:
        inspector = inspect(engine)
        if 'use_cases' in inspector.get_table_names():
            columns = [col['name'] for col in inspector.get_columns('use_cases')]
            if 'human_in_loop_strategy' not in columns:
                with engine.connect() as conn:
                    try:
                        if settings.DATABASE_TYPE == "sqlite":
                            conn.execute(text("ALTER TABLE use_cases ADD COLUMN human_in_loop_strategy VARCHAR(500)"))
                        else:
                            conn.execute(text("ALTER TABLE use_cases ADD COLUMN human_in_loop_strategy VARCHAR(500) NULL"))
                        conn.commit()
                        logger.info("Added human_in_loop_strategy column to use_cases table")
                    except Exception as e:
                        error_msg = str(e)
                        if 'duplicate column' in error_msg.lower() or 'already exists' in error_msg.lower():
                            logger.debug("human_in_loop_strategy column already exists")
                        else:
                            logger.warning(f"Could not add human_in_loop_strategy column: {error_msg}")
                            conn.rollback()
    except Exception as e:
        logger.warning(f"Could not check/add human_in_loop_strategy column: {str(e)}")

    # Add Fairness & Bias Assessment fields to use_cases table
    try:
        inspector = inspect(engine)
        if 'use_cases' in inspector.get_table_names():
            columns = [col['name'] for col in inspector.get_columns('use_cases')]
            boolean_default = "BOOLEAN DEFAULT 0 NOT NULL" if settings.DATABASE_TYPE == "sqlite" else "BOOLEAN DEFAULT FALSE NOT NULL"
            fairness_bias_columns = [
                ('bias_assessment_performed', boolean_default),
                ('protected_attributes', 'VARCHAR(500)'),
                ('balancing_strategy', 'VARCHAR(1000)'),
            ]
            missing_columns = [
                (name, col_type) for name, col_type in fairness_bias_columns if name not in columns
            ]
            if missing_columns:
                with engine.connect() as conn:
                    for column_name, column_type in missing_columns:
                        try:
                            conn.execute(text(f"ALTER TABLE use_cases ADD COLUMN {column_name} {column_type}"))
                            conn.commit()
                            logger.info(f"Added {column_name} column to use_cases table")
                        except Exception as e:
                            error_msg = str(e)
                            if 'duplicate column' in error_msg.lower() or 'already exists' in error_msg.lower():
                                logger.debug(f"{column_name} column already exists")
                            else:
                                logger.warning(f"Could not add {column_name} column: {error_msg}")
                                conn.rollback()
    except Exception as e:
        logger.warning(f"Could not check/add Fairness & Bias Assessment columns: {str(e)}")

    # Ensure AI assessment checklist template tables exist
    try:
        inspector = inspect(engine)
        table_names = inspector.get_table_names()
        if 'assessment_checklist_templates' not in table_names:
            logger.info("Creating assessment checklist template tables...")
            json_type = "JSON" if settings.DATABASE_TYPE != "sqlite" else "TEXT"
            boolean_default = "BOOLEAN DEFAULT 0 NOT NULL" if settings.DATABASE_TYPE == "sqlite" else "BOOLEAN DEFAULT FALSE NOT NULL"
            with engine.connect() as conn:
                try:
                    if settings.DATABASE_TYPE == "sqlite":
                        conn.execute(text(f"""
                            CREATE TABLE assessment_checklist_templates (
                                template_id VARCHAR(36) PRIMARY KEY,
                                version_number INTEGER NOT NULL,
                                name VARCHAR(200) NOT NULL,
                                status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
                                    CHECK (status IN ('DRAFT', 'IN REVIEW', 'EFFECTIVE', 'DEPRECATED')),
                                is_active {boolean_default},
                                source_template_id VARCHAR(36),
                                created_by VARCHAR(36),
                                created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
                                modified_by VARCHAR(36),
                                modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
                                FOREIGN KEY (source_template_id) REFERENCES assessment_checklist_templates(template_id),
                                FOREIGN KEY (created_by) REFERENCES users(user_id),
                                FOREIGN KEY (modified_by) REFERENCES users(user_id)
                            )
                        """))
                        conn.execute(text("""
                            CREATE TABLE assessment_checklist_areas (
                                area_id INTEGER PRIMARY KEY AUTOINCREMENT,
                                template_id VARCHAR(36) NOT NULL,
                                seq_no INTEGER NOT NULL,
                                title VARCHAR(200) NOT NULL,
                                FOREIGN KEY (template_id) REFERENCES assessment_checklist_templates(template_id) ON DELETE CASCADE
                            )
                        """))
                        conn.execute(text(f"""
                            CREATE TABLE assessment_checklist_items (
                                item_id INTEGER PRIMARY KEY AUTOINCREMENT,
                                area_id INTEGER NOT NULL,
                                sno VARCHAR(20) NOT NULL,
                                assessment_item VARCHAR(500) NOT NULL,
                                category VARCHAR(50) NOT NULL CHECK (category IN (
                                    'Business', 'Governance', 'Legal & Compliance', 'Technical',
                                    'Security & Data Privacy', 'Operations'
                                )),
                                allowed_checklist_items {json_type},
                                base_score REAL NOT NULL DEFAULT 0,
                                penalty_factor REAL NOT NULL DEFAULT 1.0,
                                FOREIGN KEY (area_id) REFERENCES assessment_checklist_areas(area_id) ON DELETE CASCADE
                            )
                        """))
                    else:
                        conn.execute(text(f"""
                            CREATE TABLE assessment_checklist_templates (
                                template_id VARCHAR(36) PRIMARY KEY,
                                version_number INT NOT NULL,
                                name VARCHAR(200) NOT NULL,
                                status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
                                    CHECK (status IN ('DRAFT', 'IN REVIEW', 'EFFECTIVE', 'DEPRECATED')),
                                is_active {boolean_default},
                                source_template_id VARCHAR(36),
                                created_by VARCHAR(36),
                                created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
                                modified_by VARCHAR(36),
                                modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                                FOREIGN KEY (source_template_id) REFERENCES assessment_checklist_templates(template_id),
                                FOREIGN KEY (created_by) REFERENCES users(user_id),
                                FOREIGN KEY (modified_by) REFERENCES users(user_id)
                            )
                        """))
                        conn.execute(text("""
                            CREATE TABLE assessment_checklist_areas (
                                area_id INT AUTO_INCREMENT PRIMARY KEY,
                                template_id VARCHAR(36) NOT NULL,
                                seq_no INT NOT NULL,
                                title VARCHAR(200) NOT NULL,
                                FOREIGN KEY (template_id) REFERENCES assessment_checklist_templates(template_id) ON DELETE CASCADE
                            )
                        """))
                        conn.execute(text(f"""
                            CREATE TABLE assessment_checklist_items (
                                item_id INT AUTO_INCREMENT PRIMARY KEY,
                                area_id INT NOT NULL,
                                sno VARCHAR(20) NOT NULL,
                                assessment_item VARCHAR(500) NOT NULL,
                                category VARCHAR(50) NOT NULL CHECK (category IN (
                                    'Business', 'Governance', 'Legal & Compliance', 'Technical',
                                    'Security & Data Privacy', 'Operations'
                                )),
                                allowed_checklist_items {json_type},
                                base_score DOUBLE NOT NULL DEFAULT 0,
                                penalty_factor DOUBLE NOT NULL DEFAULT 1.0,
                                FOREIGN KEY (area_id) REFERENCES assessment_checklist_areas(area_id) ON DELETE CASCADE
                            )
                        """))
                    conn.commit()
                    logger.info("Assessment checklist template tables created")
                except Exception as e:
                    error_msg = str(e)
                    if 'already exists' in error_msg.lower() or 'duplicate' in error_msg.lower():
                        logger.debug("Assessment checklist tables already exist")
                    else:
                        logger.warning(f"Could not create assessment checklist tables: {error_msg}")
                        conn.rollback()
    except Exception as e:
        logger.warning(f"Could not verify/create assessment checklist tables: {str(e)}")

    # Add scoring columns to assessment checklist items if missing
    try:
        inspector = inspect(engine)
        if 'assessment_checklist_items' in inspector.get_table_names():
            item_columns = {col['name'] for col in inspector.get_columns('assessment_checklist_items')}
            with engine.connect() as conn:
                if 'base_score' not in item_columns:
                    logger.info("Adding base_score column to assessment_checklist_items...")
                    conn.execute(text(
                        "ALTER TABLE assessment_checklist_items ADD COLUMN base_score REAL NOT NULL DEFAULT 0"
                        if settings.DATABASE_TYPE == "sqlite"
                        else "ALTER TABLE assessment_checklist_items ADD COLUMN base_score DOUBLE NOT NULL DEFAULT 0"
                    ))
                if 'penalty_factor' not in item_columns:
                    logger.info("Adding penalty_factor column to assessment_checklist_items...")
                    conn.execute(text(
                        "ALTER TABLE assessment_checklist_items ADD COLUMN penalty_factor REAL NOT NULL DEFAULT 1.0"
                        if settings.DATABASE_TYPE == "sqlite"
                        else "ALTER TABLE assessment_checklist_items ADD COLUMN penalty_factor DOUBLE NOT NULL DEFAULT 1.0"
                    ))
                conn.commit()
    except Exception as e:
        logger.warning(f"Could not add assessment checklist scoring columns: {str(e)}")

    # Add risk classification ranges column to assessment checklist templates if missing
    try:
        inspector = inspect(engine)
        if 'assessment_checklist_templates' in inspector.get_table_names():
            template_columns = {col['name'] for col in inspector.get_columns('assessment_checklist_templates')}
            json_type = "JSON" if settings.DATABASE_TYPE != "sqlite" else "TEXT"
            with engine.connect() as conn:
                if 'risk_classification_ranges' not in template_columns:
                    logger.info("Adding risk_classification_ranges column to assessment_checklist_templates...")
                    conn.execute(text(
                        f"ALTER TABLE assessment_checklist_templates ADD COLUMN risk_classification_ranges {json_type}"
                    ))
                    conn.commit()
    except Exception as e:
        logger.warning(f"Could not add assessment checklist risk classification column: {str(e)}")

    # Use case assessment tables
    try:
        inspector = inspect(engine)
        table_names = inspector.get_table_names()
        if 'use_case_assessments' not in table_names:
            logger.info("Creating use case assessment tables...")
            json_type = "JSON" if settings.DATABASE_TYPE != "sqlite" else "TEXT"
            boolean_default = "BOOLEAN DEFAULT 0 NOT NULL" if settings.DATABASE_TYPE == "sqlite" else "BOOLEAN DEFAULT FALSE NOT NULL"
            with engine.connect() as conn:
                conn.execute(text(f"""
                    CREATE TABLE use_case_assessments (
                        assessment_id VARCHAR(36) PRIMARY KEY,
                        use_case_id VARCHAR(36) NOT NULL UNIQUE,
                        template_id VARCHAR(36) NOT NULL,
                        template_version_number INTEGER NOT NULL,
                        template_name VARCHAR(200) NOT NULL,
                        template_snapshot {json_type} NOT NULL,
                        status VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',
                        initiated_by VARCHAR(36) NOT NULL,
                        initiated_dt DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        closed_by VARCHAR(36),
                        closed_dt DATETIME,
                        next_review_date DATETIME,
                        total_score REAL,
                        risk_classification VARCHAR(20),
                        overall_findings TEXT,
                        area_summaries {json_type},
                        question_scores {json_type},
                        ai_prefill_applied {boolean_default},
                        modified_by VARCHAR(36),
                        modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        FOREIGN KEY (use_case_id) REFERENCES use_cases(use_case_id) ON DELETE CASCADE,
                        FOREIGN KEY (template_id) REFERENCES assessment_checklist_templates(template_id),
                        FOREIGN KEY (initiated_by) REFERENCES users(user_id),
                        FOREIGN KEY (closed_by) REFERENCES users(user_id),
                        FOREIGN KEY (modified_by) REFERENCES users(user_id)
                    )
                """))
                conn.execute(text(f"""
                    CREATE TABLE use_case_assessment_responses (
                        response_id VARCHAR(36) PRIMARY KEY,
                        assessment_id VARCHAR(36) NOT NULL,
                        template_item_id INTEGER NOT NULL,
                        area_id INTEGER NOT NULL,
                        sno VARCHAR(20) NOT NULL,
                        selected_answers {json_type},
                        comment TEXT,
                        answered_by VARCHAR(36),
                        answered_dt DATETIME,
                        last_modified_by VARCHAR(36),
                        last_modified_dt DATETIME,
                        FOREIGN KEY (assessment_id) REFERENCES use_case_assessments(assessment_id) ON DELETE CASCADE,
                        FOREIGN KEY (answered_by) REFERENCES users(user_id),
                        FOREIGN KEY (last_modified_by) REFERENCES users(user_id),
                        UNIQUE (assessment_id, template_item_id)
                    )
                """))
                conn.execute(text(f"""
                    CREATE TABLE use_case_assessment_response_history (
                        history_id VARCHAR(36) PRIMARY KEY,
                        assessment_id VARCHAR(36) NOT NULL,
                        template_item_id INTEGER NOT NULL,
                        sno VARCHAR(20) NOT NULL,
                        selected_answers {json_type},
                        comment TEXT,
                        changed_by VARCHAR(36) NOT NULL,
                        changed_dt DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        change_action VARCHAR(20) NOT NULL DEFAULT 'updated',
                        FOREIGN KEY (assessment_id) REFERENCES use_case_assessments(assessment_id) ON DELETE CASCADE,
                        FOREIGN KEY (changed_by) REFERENCES users(user_id)
                    )
                """))
                conn.commit()
    except Exception as e:
        logger.warning(f"Could not create use case assessment tables: {str(e)}")

    # Add permission_type column to permissions (workflow | usecase | portal)
    try:
        inspector = inspect(engine)
        if "permissions" in inspector.get_table_names():
            columns = [col["name"] for col in inspector.get_columns("permissions")]
            if "permission_type" not in columns:
                logger.info("Adding permission_type column to permissions table...")
                with engine.connect() as conn:
                    try:
                        conn.execute(
                            text(
                                "ALTER TABLE permissions ADD COLUMN permission_type VARCHAR(20) DEFAULT 'portal' NOT NULL"
                            )
                        )
                        conn.commit()
                        logger.info("Successfully added permission_type column to permissions table")
                    except Exception as e:
                        error_msg = str(e)
                        if "duplicate column" in error_msg.lower() or "already exists" in error_msg.lower():
                            logger.debug("permission_type column already exists")
                        else:
                            logger.warning(f"Could not add permission_type: {error_msg}")
                            conn.rollback()
            else:
                logger.debug("permission_type column already exists in permissions table")
    except Exception as e:
        logger.warning(f"Could not check/add permission_type: {str(e)}")

    # Expand use_cases status CHECK for Estimate, ROI, AI Assessment
    try:
        inspector = inspect(engine)
        if "use_cases" in inspector.get_table_names():
            with engine.connect() as conn:
                if settings.DATABASE_TYPE == "sqlite":
                    normalized_sql = _normalize_sql(_get_sqlite_table_sql(conn, "use_cases"))
                    needs_status_update = (
                        "'estimate'" not in normalized_sql
                        or "'roi'" not in normalized_sql
                        or "'ai assessment'" not in normalized_sql
                    )
                    if needs_status_update:
                        logger.info("Rebuilding use_cases table to expand workflow status constraint...")
                        _sqlite_rebuild_use_cases_table(conn)
                        conn.commit()
                        logger.info("Successfully rebuilt use_cases table with expanded workflow statuses")
                else:
                    # MySQL: drop and re-add CHECK if present; otherwise rely on app-level validation
                    try:
                        conn.execute(text("ALTER TABLE use_cases DROP CHECK check_status"))
                    except Exception:
                        pass
                    try:
                        conn.execute(
                            text(
                                "ALTER TABLE use_cases ADD CONSTRAINT check_status CHECK ("
                                "status IN ('New', 'Analysis', 'Review', 'Estimate', 'ROI', "
                                "'AI Assessment', 'Approved', 'Rejected', "
                                "'Development', 'Testing', 'Production', 'Retired'))"
                            )
                        )
                        conn.commit()
                        logger.info("Updated MySQL use_cases status CHECK constraint")
                    except Exception as e:
                        logger.warning(f"Could not update MySQL status CHECK: {str(e)}")
                        conn.rollback()
    except Exception as e:
        logger.warning(f"Could not expand use_cases status constraint: {str(e)}")

    # Analysis assignment + scoring columns on use_cases
    try:
        inspector = inspect(engine)
        if "use_cases" in inspector.get_table_names():
            columns = {col["name"] for col in inspector.get_columns("use_cases")}
            column_defs = [
                ("analysis_assigned_by", "VARCHAR(36)"),
                ("analysis_assigned_dt", "DATETIME"),
                ("analysis_due_date", "DATETIME"),
                ("tech_analysis_completed_dt", "DATETIME"),
                ("business_analysis_completed_dt", "DATETIME"),
                ("tech_analysis_rejected_dt", "DATETIME"),
                ("tech_analysis_rejection_note", "TEXT"),
                ("business_analysis_rejected_dt", "DATETIME"),
                ("business_analysis_rejection_note", "TEXT"),
                ("frequency_of_task", "VARCHAR(40)"),
                ("current_effort", "VARCHAR(40)"),
                ("user_group_size", "VARCHAR(40)"),
                ("efficiency_impact", "VARCHAR(40)"),
                ("quality_compliance_impact", "VARCHAR(60)"),
                ("user_urgency", "VARCHAR(60)"),
                ("process_impact", "VARCHAR(80)"),
                ("operational_compliance_risk", "VARCHAR(40)"),
                ("tool_complexity", "VARCHAR(80)"),
                ("host_system_capability", "VARCHAR(80)"),
                ("data_privacy_security", "VARCHAR(20)"),
                ("deployment_model", "VARCHAR(40)"),
                ("estimate_owner", "VARCHAR(36)"),
                ("estimate_assigned_by", "VARCHAR(36)"),
                ("estimate_assigned_dt", "DATETIME"),
                ("estimate_due_date", "DATETIME"),
                ("estimate_completed_dt", "DATETIME"),
                ("estimate_data", "TEXT" if settings.DATABASE_TYPE == "sqlite" else "JSON"),
                ("roi_owner", "VARCHAR(36)"),
                ("roi_assigned_by", "VARCHAR(36)"),
                ("roi_assigned_dt", "DATETIME"),
                ("roi_due_date", "DATETIME"),
                ("roi_completed_dt", "DATETIME"),
                ("roi_data", "TEXT" if settings.DATABASE_TYPE == "sqlite" else "JSON"),
                ("assessment_owner", "VARCHAR(36)"),
                ("assessment_assigned_by", "VARCHAR(36)"),
                ("assessment_assigned_dt", "DATETIME"),
                ("assessment_due_date", "DATETIME"),
                ("assessment_completed_dt", "DATETIME"),
            ]
            with engine.connect() as conn:
                for col_name, col_def in column_defs:
                    if col_name in columns:
                        continue
                    try:
                        conn.execute(text(f"ALTER TABLE use_cases ADD COLUMN {col_name} {col_def}"))
                        conn.commit()
                        logger.info(f"Added {col_name} column to use_cases table")
                    except Exception as e:
                        error_msg = str(e)
                        if "duplicate column" in error_msg.lower() or "already exists" in error_msg.lower():
                            logger.debug(f"{col_name} already exists on use_cases")
                        else:
                            logger.warning(f"Could not add {col_name} to use_cases: {error_msg}")
                            conn.rollback()
    except Exception as e:
        logger.warning(f"Could not add analysis columns to use_cases: {str(e)}")

    # In-app notifications inbox
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        if "notifications" not in tables:
            logger.info("Creating notifications table...")
            with engine.connect() as conn:
                try:
                    if settings.DATABASE_TYPE == "sqlite":
                        conn.execute(text("""
                            CREATE TABLE IF NOT EXISTS notifications (
                                notification_id VARCHAR(36) PRIMARY KEY,
                                recipient_user_id VARCHAR(36) NOT NULL,
                                actor_user_id VARCHAR(36) NULL,
                                type VARCHAR(50) NOT NULL,
                                title VARCHAR(200) NOT NULL,
                                message VARCHAR(500) NOT NULL,
                                severity VARCHAR(20) NOT NULL DEFAULT 'info',
                                entity_type VARCHAR(30) NULL,
                                entity_id VARCHAR(36) NULL,
                                domain_id VARCHAR(36) NULL,
                                link VARCHAR(300) NULL,
                                actions TEXT NULL,
                                payload TEXT NULL,
                                is_read BOOLEAN NOT NULL DEFAULT 0,
                                read_dt DATETIME NULL,
                                dismissed_dt DATETIME NULL,
                                created_dt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                FOREIGN KEY (recipient_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
                                FOREIGN KEY (actor_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
                                FOREIGN KEY (domain_id) REFERENCES domains(domain_id) ON DELETE SET NULL
                            )
                        """))
                        conn.execute(text(
                            "CREATE INDEX IF NOT EXISTS ix_notifications_recipient_user_id "
                            "ON notifications (recipient_user_id)"
                        ))
                        conn.execute(text(
                            "CREATE INDEX IF NOT EXISTS ix_notifications_type ON notifications (type)"
                        ))
                        conn.execute(text(
                            "CREATE INDEX IF NOT EXISTS ix_notifications_recipient_created "
                            "ON notifications (recipient_user_id, created_dt)"
                        ))
                        conn.execute(text(
                            "CREATE INDEX IF NOT EXISTS ix_notifications_recipient_unread "
                            "ON notifications (recipient_user_id, is_read)"
                        ))
                    else:
                        conn.execute(text("""
                            CREATE TABLE IF NOT EXISTS notifications (
                                notification_id VARCHAR(36) PRIMARY KEY,
                                recipient_user_id VARCHAR(36) NOT NULL,
                                actor_user_id VARCHAR(36) NULL,
                                type VARCHAR(50) NOT NULL,
                                title VARCHAR(200) NOT NULL,
                                message VARCHAR(500) NOT NULL,
                                severity VARCHAR(20) NOT NULL DEFAULT 'info',
                                entity_type VARCHAR(30) NULL,
                                entity_id VARCHAR(36) NULL,
                                domain_id VARCHAR(36) NULL,
                                link VARCHAR(300) NULL,
                                actions JSON NULL,
                                payload JSON NULL,
                                is_read BOOLEAN NOT NULL DEFAULT FALSE,
                                read_dt DATETIME NULL,
                                dismissed_dt DATETIME NULL,
                                created_dt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                INDEX ix_notifications_recipient_user_id (recipient_user_id),
                                INDEX ix_notifications_type (type),
                                INDEX ix_notifications_recipient_created (recipient_user_id, created_dt),
                                INDEX ix_notifications_recipient_unread (recipient_user_id, is_read),
                                CONSTRAINT fk_notifications_recipient
                                    FOREIGN KEY (recipient_user_id) REFERENCES users(user_id) ON DELETE CASCADE,
                                CONSTRAINT fk_notifications_actor
                                    FOREIGN KEY (actor_user_id) REFERENCES users(user_id) ON DELETE SET NULL,
                                CONSTRAINT fk_notifications_domain
                                    FOREIGN KEY (domain_id) REFERENCES domains(domain_id) ON DELETE SET NULL
                            )
                        """))
                    conn.commit()
                    logger.info("notifications table ensured")
                except Exception as e:
                    error_msg = str(e)
                    if "already exists" in error_msg.lower():
                        logger.debug("notifications table already exists")
                    else:
                        logger.warning(f"Could not create notifications table: {error_msg}")
                        conn.rollback()
        else:
            logger.debug("notifications table already exists")
    except Exception as e:
        logger.warning(f"Could not verify/create notifications table: {str(e)}")

    # Document type lookup + use_case_documents metadata
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        if "document_types" not in tables:
            logger.info("Creating document_types lookup table...")
            with engine.connect() as conn:
                try:
                    conn.execute(text("""
                        CREATE TABLE IF NOT EXISTS document_types (
                            doc_type_id VARCHAR(36) PRIMARY KEY,
                            name VARCHAR(80) NOT NULL UNIQUE,
                            description VARCHAR(250),
                            created_by VARCHAR(36),
                            created_dt DATETIME DEFAULT CURRENT_TIMESTAMP,
                            modified_by VARCHAR(36),
                            modified_dt DATETIME DEFAULT CURRENT_TIMESTAMP
                        )
                    """))
                    conn.commit()
                    logger.info("document_types table ensured")
                except Exception as e:
                    error_msg = str(e)
                    if "already exists" in error_msg.lower():
                        logger.debug("document_types table already exists")
                    else:
                        logger.warning(f"Could not create document_types table: {error_msg}")
                        conn.rollback()
        if "use_case_documents" in tables:
            doc_columns = [col["name"] for col in inspector.get_columns("use_case_documents")]
            document_column_defs = [
                ("document_type", "VARCHAR(80)"),
                ("source", "VARCHAR(40)"),
            ]
            with engine.connect() as conn:
                for col_name, col_def in document_column_defs:
                    if col_name in doc_columns:
                        continue
                    try:
                        conn.execute(text(f"ALTER TABLE use_case_documents ADD COLUMN {col_name} {col_def}"))
                        conn.commit()
                        logger.info(f"Added {col_name} column to use_case_documents table")
                    except Exception as e:
                        error_msg = str(e)
                        if "duplicate column" in error_msg.lower() or "already exists" in error_msg.lower():
                            logger.debug(f"{col_name} already exists on use_case_documents")
                        else:
                            logger.warning(f"Could not add {col_name} to use_case_documents: {error_msg}")
                            conn.rollback()
        if "use_cases" in tables:
            use_case_columns = [col["name"] for col in inspector.get_columns("use_cases")]
            if "deployment_model" not in use_case_columns:
                with engine.connect() as conn:
                    try:
                        conn.execute(text("ALTER TABLE use_cases ADD COLUMN deployment_model VARCHAR(40)"))
                        conn.commit()
                        logger.info("Added deployment_model column to use_cases table")
                    except Exception as e:
                        error_msg = str(e)
                        if "duplicate column" in error_msg.lower() or "already exists" in error_msg.lower():
                            logger.debug("deployment_model already exists on use_cases")
                        else:
                            logger.warning(f"Could not add deployment_model to use_cases: {error_msg}")
                            conn.rollback()
    except Exception as e:
        logger.warning(f"Could not verify/create document type lookup: {str(e)}")

    try:
        from app.core.document_type_lookup import seed_default_document_types

        db = SessionLocal()
        try:
            seed_default_document_types(db)
        finally:
            db.close()
    except Exception as e:
        logger.warning(f"Could not seed default document types: {str(e)}")
