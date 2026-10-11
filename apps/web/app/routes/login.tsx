import { Alert, AlertDescription } from '@raisin/ui/alert';
import { Button } from '@raisin/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@raisin/ui/card';
import { Input } from '@raisin/ui/input';
import { useState } from 'react';
import { Link, redirect, useNavigate, useSearchParams } from 'react-router';
import { AuthShell, safeNext } from '~/components/auth-shell';
import { Field } from '~/components/common';
import { authClient } from '~/lib/auth-client';
import { authErrorMessage } from '~/lib/auth-errors';
import { getSession } from '~/lib/session.server';
import type { Route } from './+types/login';

export function meta(): Route.MetaDescriptors {
  return [{ title: 'Sign in — Raisin' }];
}

export async function loader({ request }: Route.LoaderArgs) {
  if (await getSession(request)) throw redirect('/app');
  const { env } = await import('cloudflare:workers');
  return { google: Boolean(env.GOOGLE_CLIENT_ID) };
}

export default function Login({ loaderData }: Route.ComponentProps) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [unverified, setUnverified] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const next = safeNext(params.get('next'));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const email = String(form.get('email'));
    const { error } = await authClient.signIn.email({
      email,
      password: String(form.get('password')),
      callbackURL: next,
    });
    setPending(false);
    setResent(false);
    const unverifiedEmail = error?.code === 'EMAIL_NOT_VERIFIED' ? email : null;
    setUnverified(unverifiedEmail);
    // Sign-in attempts by unverified users send a fresh link (sendOnSignIn), so say where it went.
    if (unverifiedEmail)
      setError(`Confirm your email first. We sent a link to ${unverifiedEmail}.`);
    else if (error) setError(authErrorMessage(error, 'sign-in'));
    else navigate(next);
  }

  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            New to Raisin?{' '}
            <Link
              to={`/signup?next=${encodeURIComponent(next)}`}
              className="text-primary hover:underline"
            >
              Create an account
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form onSubmit={onSubmit} className="grid gap-4">
            <Field id="email" label="Email">
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </Field>
            <Field id="password" label="Password">
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </Field>
            {error && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {unverified && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="justify-self-start"
                disabled={resent}
                onClick={async () => {
                  await authClient.sendVerificationEmail({ email: unverified, callbackURL: next });
                  setResent(true);
                }}
              >
                {resent ? `Sent to ${unverified}` : 'Resend the confirmation link'}
              </Button>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
          {loaderData.google && (
            <Button
              variant="outline"
              onClick={() => authClient.signIn.social({ provider: 'google', callbackURL: next })}
            >
              Continue with Google
            </Button>
          )}
        </CardContent>
      </Card>
    </AuthShell>
  );
}
