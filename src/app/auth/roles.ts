import { MsalService } from '@azure/msal-angular';

/** Lee los App Roles de Azure AD (claim "roles") de la cuenta activa. */
export function rolesDe(msal: MsalService): string[] {
  const claims = msal.instance.getActiveAccount()?.idTokenClaims as
    | Record<string, unknown>
    | undefined;
  return Array.isArray(claims?.['roles']) ? (claims!['roles'] as string[]) : [];
}

export function usernameDe(msal: MsalService): string {
  return msal.instance.getActiveAccount()?.username ?? '';
}
