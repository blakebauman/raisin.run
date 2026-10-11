import { data, redirect } from 'react-router';
import { createCheckout, createPortal } from '~/lib/billing.server';
import { canManage, requireMember } from '~/lib/session.server';
import type { Route } from './+types/billing';

/** Send an owner or admin to Stripe Checkout (upgrade) or the Customer Portal (manage). */
export async function action({ request }: Route.ActionArgs) {
  const m = await requireMember(request);
  if (!canManage(m))
    return data({ error: 'Only owners and admins can manage billing.' }, { status: 403 });
  const form = await request.formData();
  try {
    if (form.get('intent') === 'portal') throw redirect(await createPortal(m.orgId));
    const plan = form.get('plan');
    if (plan !== 'pro' && plan !== 'agency')
      return data({ error: 'Pick a plan.' }, { status: 400 });
    throw redirect(
      await createCheckout({ org: { id: m.orgId, name: m.orgName }, email: m.user.email, plan }),
    );
  } catch (e) {
    if (e instanceof Response) throw e;
    console.error('billing redirect failed', e);
    return data({ error: 'Could not reach Stripe. Try again in a moment.' }, { status: 502 });
  }
}

export async function loader() {
  throw redirect('/app/settings');
}
