// Secrets set with `wrangler secret put` (or .dev.vars locally); `wrangler types` can't see them.
declare namespace Cloudflare {
  interface Env {
    BETTER_AUTH_SECRET: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    TURNSTILE_SECRET_KEY?: string;
    /** Stripe restricted key (rk_…) with Customers, Checkout Sessions, Customer Portal and Subscriptions access. */
    STRIPE_API_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    /** Monthly Price ids for the Pro and Agency Products. */
    STRIPE_PRICE_PRO?: string;
    STRIPE_PRICE_AGENCY?: string;
  }
}
