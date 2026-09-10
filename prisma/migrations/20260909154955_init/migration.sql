-- CreateTable
CREATE TABLE "x_auth_token" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "auth_token" TEXT NOT NULL,
    "ct0" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "x_auth_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" BIGSERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "twitter_name" TEXT,
    "followers" INTEGER NOT NULL DEFAULT 0,
    "following" INTEGER NOT NULL DEFAULT 0,
    "tweets" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "website" TEXT,
    "github" TEXT,
    "chain" TEXT,
    "token_address" TEXT,
    "profile_image_url" TEXT,
    "last_tweet_id" TEXT,
    "last_fetched_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "feed_items" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "tweet_url" TEXT NOT NULL,
    "posted_at" TIMESTAMPTZ NOT NULL,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "reposts" INTEGER NOT NULL DEFAULT 0,
    "replies" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "detected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feed_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "x_auth_token_username_key" ON "x_auth_token"("username");

-- CreateIndex
CREATE UNIQUE INDEX "x_auth_token_auth_token_key" ON "x_auth_token"("auth_token");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "projects_username_key" ON "projects"("username");

-- CreateIndex
CREATE INDEX "projects_chain_idx" ON "projects"("chain");

-- CreateIndex
CREATE INDEX "feed_items_detected_at_idx" ON "feed_items"("detected_at" DESC);

-- CreateIndex
CREATE INDEX "feed_items_project_id_idx" ON "feed_items"("project_id");

-- AddForeignKey
ALTER TABLE "feed_items" ADD CONSTRAINT "feed_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
