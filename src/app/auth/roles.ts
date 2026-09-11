import { MsalService } from '@azure/msal-angular';
import { MsalGuardConfiguration } from '@azure/msal-angular';
import { AuthenticationResult } from '@azure/msal-browser';

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

/** Abre el popup de Microsoft con el scope de la API. Usado desde la topbar y desde Home. */
export function iniciarSesion(
  msal: MsalService,
  guardConfig: MsalGuardConfiguration,
  onSuccess: () => void,
): void {
  const scopes = (guardConfig.authRequest as { scopes?: string[] })?.scopes ?? [];
  msal.loginPopup({ scopes }).subscribe({
    next: (res: AuthenticationResult) => {
      msal.instance.setActiveAccount(res.account);
      onSuccess();
    },
    error: (e) => console.error(e),
  });
}
