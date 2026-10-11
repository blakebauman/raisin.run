import { redirect } from 'react-router';
import { getAuth } from '~/lib/auth.server';
import type { Route } from './+types/logout';

export async function action({ request }: Route.ActionArgs) {
  const res = await getAuth().api.signOut({ headers: request.headers, asResponse: true });
  const headers = new Headers({ location: '/' });
  for (const cookie of res.headers.getSetCookie()) headers.append('set-cookie', cookie);
  return new Response(null, { status: 303, headers });
}

export async function loader() {
  throw redirect('/');
}
