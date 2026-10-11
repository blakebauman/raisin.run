-- Stripe subscription state per organization. The Stripe Customer is the ownership boundary:
-- webhooks resolve customer → organization through billing_customer_id.
ALTER TABLE org_plans ADD COLUMN billing_subscription_id TEXT;
ALTER TABLE org_plans ADD COLUMN billing_status TEXT;
ALTER TABLE org_plans ADD COLUMN billing_period_end INTEGER;
ALTER TABLE org_plans ADD COLUMN billing_cancel_at_period_end INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX org_plans_customer_idx ON org_plans (billing_customer_id) WHERE billing_customer_id IS NOT NULL;
