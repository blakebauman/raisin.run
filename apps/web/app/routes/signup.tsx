import { Alert, AlertDescription } from '@raisin/ui/alert';
import { Button } from '@raisin/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@raisin/ui/card';
import { Input } from '@raisin/ui/input';
import { useEffect, useRef, useState } from 'react';
import { Link, redirect, useSearchParams } from 'react-router';
import { AuthShell, safeNext } from '~/components/auth-shell';
import { Field } from '~/components/common';
import { authClient } from '~/lib/auth-client';
import { authErrorMessage } from '~/lib/auth-errors';
import { getSession } from '~/lib/session.server';
import type { Route } from './+types/signup';

export function meta(): Route.MetaDescriptors {
  return [{ title: 'Create an account — Raisin' }];
}

export async function loader({ request }: Route.LoaderArgs) {
  if (await getSession(request)) throw redirect('/app');
  const { env } = await import('cloudflare:workers');
  return {
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
    google: Boolean(env.GOOGLE_CLIENT_ID),
  };
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: { sitekey: string; callback: (token: string) => void },
      ) => void;
    };
  }
}

export default function Signup({ loaderData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const widget = useRef<HTMLDivElement>(null);
  const next = safeNext(params.get('next'));
  const siteKey = loaderData.turnstileSiteKey;

  useEffect(() => {
    if (!siteKey || !widget.current) return;
    const el = widget.current;
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.onload = () => window.turnstile?.render(el, { sitekey: siteKey, callback: setToken });
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, [siteKey]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const email = String(form.get('email'));
    const { error } = await authClient.signUp.email(
      {
        name: String(form.get('name')),
        email,
        password: String(form.get('password')),
        // The verification link signs the user in and lands here.
        callbackURL: next === '/app' ? '/app/projects/new' : next,
      },
      { headers: token ? { 'x-turnstile-token': token } : {} },
    );
    setPending(false);
    if (error) setError(authErrorMessage(error, 'sign-up'));
    else setSentTo(email);
  }

  return (
    <AuthShell>
      <Card>
        {sentTo ? (
          <CheckEmail email={sentTo} callbackURL={next === '/app' ? '/app/projects/new' : next} />
        ) : (
          <>
            <CardHeader>
              <CardTitle>Create your account</CardTitle>
              <CardDescription>
                Free plan: crawl up to 500 URLs per site. Already have an account?{' '}
                <Link to="/login" className="text-primary hover:underline">
                  Sign in
                </Link>
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <form onSubmit={onSubmit} className="grid gap-4">
                <Field id="name" label="Name">
                  <Input id="name" name="name" autoComplete="name" required />
                </Field>
                <Field id="email" label="Work email">
                  <Input id="email" name="email" type="email" autoComplete="email" required />
                </Field>
                <Field id="password" label="Password" hint="At least 10 characters.">
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={10}
                    required
                  />
                </Field>
                {siteKey && <div ref={widget} />}
                {error && (
                  <Alert variant="destructive" role="alert">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Button type="submit" disabled={pending || Boolean(siteKey && !token)}>
                  {pending ? 'Creating account…' : 'Create account'}
                </Button>
              </form>
              {loaderData.google && (
                <Button
                  variant="outline"
                  onClick={() =>
                    authClient.signIn.social({ provider: 'google', callbackURL: '/app' })
                  }
                >
                  Continue with Google
                </Button>
              )}
            </CardContent>
          </>
        )}
      </Card>
    </AuthShell>
  );
}

/** Replaces the form once the account exists: verification is required before signing in. */
function CheckEmail({ email, callbackURL }: { email: string; callbackURL: string }) {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  return (
    <>
      <CardHeader>
        <CardTitle>Check your email</CardTitle>
        <CardDescription>
          We sent a link to <span className="font-medium text-foreground">{email}</span>. Open it to
          confirm your address and sign in. The link expires in an hour.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <Button
          variant="outline"
          size="sm"
          disabled={state !== 'idle'}
          onClick={async () => {
            setState('sending');
            await authClient.sendVerificationEmail({ email, callbackURL });
            setState('sent');
          }}
        >
          {state === 'sent' ? 'Sent again' : state === 'sending' ? 'Sending…' : 'Resend the link'}
        </Button>
        <Link to="/login" className="text-primary hover:underline">
          Back to sign in
        </Link>
      </CardContent>
    </>
  );
}
