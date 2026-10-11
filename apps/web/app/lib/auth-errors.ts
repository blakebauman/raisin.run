type AuthError = { code?: string; message?: string; status?: number };

/**
 * Plain-language messages for sign-in and sign-up failures. The auth library's own messages are
 * written for developers ("Invalid origin"), so the common cases are rewritten and anything
 * unrecognised keeps its detail after a sentence that says what failed.
 */
export function authErrorMessage(error: AuthError, action: 'sign-in' | 'sign-up'): string {
  const code = (error.code ?? '').toUpperCase();
  const message = error.message ?? '';
  if (code.startsWith('USER_ALREADY_EXISTS'))
    return 'An account with this email already exists. Sign in instead, or use a different email.';
  if (code === 'INVALID_EMAIL_OR_PASSWORD')
    return "That email and password don't match an account. Check both and try again.";
  if (code === 'EMAIL_NOT_VERIFIED')
    return 'Confirm your email first. We sent a link to your inbox. It may take a minute to arrive.';
  if (code === 'PASSWORD_TOO_SHORT') return 'Use a password of at least 10 characters.';
  if (code === 'INVALID_EMAIL') return 'Enter a valid email address, like you@agency.com.';
  if (code === 'INVALID_ORIGIN' || /invalid origin/i.test(message))
    return `This page's address isn't one Raisin accepts ${action === 'sign-up' ? 'sign-ups' : 'sign-ins'} from. Open Raisin at its usual address and try again.`;
  if (error.status === 429) return 'Too many attempts. Wait a minute, then try again.';
  const what = action === 'sign-up' ? "Couldn't create your account." : "Couldn't sign you in.";
  return message ? `${what} ${message}` : `${what} Try again in a moment.`;
}
