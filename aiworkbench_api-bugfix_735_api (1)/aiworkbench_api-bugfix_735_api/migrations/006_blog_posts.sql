-- Blog/article posts: metadata in blog_posts; files under file_storage/blog_content/{blog_post_id}/
-- Permissions view_blog and manage_blog are created by application init_service (or Settings).

CREATE TABLE IF NOT EXISTS blog_posts (
    blog_post_id VARCHAR(36) NOT NULL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    kind VARCHAR(20) NOT NULL,
    content_format VARCHAR(10) NOT NULL,
    stored_path VARCHAR(500) NOT NULL,
    published BOOLEAN NOT NULL DEFAULT 0,
    published_at DATETIME NULL,
    summary TEXT NULL,
    created_by VARCHAR(36) NULL,
    modified_by VARCHAR(36) NULL,
    created_dt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modified_dt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(user_id),
    FOREIGN KEY (modified_by) REFERENCES users(user_id)
);
