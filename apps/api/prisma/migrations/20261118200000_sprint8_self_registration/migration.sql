-- Support email-only authentication and business-code checks without scanning all accounts.
CREATE INDEX "tenants_slug_idx" ON "tenants"("slug");
CREATE INDEX "users_email_idx" ON "users"("email");
