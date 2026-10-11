import { redirect } from 'react-router';
import { requireMember, switchOrganization } from '~/lib/session.server';
import type { Route } from './+types/switch-org';

export async function action({ request }: Route.ActionArgs) {
  await requireMember(request);
  const orgId = String((await request.formData()).get('orgId') ?? '');
  const headers = await switchOrganization(request, orgId);
  throw redirect('/app', { headers: headers ?? undefined });
}

export async function loader() {
  throw redirect('/app');
}
