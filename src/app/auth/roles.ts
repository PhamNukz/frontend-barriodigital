import { MsalService } from '@azure/msal-angular';
import { MsalGuardConfiguration } from '@azure/msal-angular';
import { AuthenticationResult } from '@azure/msal-browser';
import { environment } from '../../environments/environment';

export function usernameDe(msal: MsalService): string {
  return msal.instance.getActiveAccount()?.username ?? '';
}

/**
 * Los App Roles se asignan sobre el service principal de la API
 * (barriodigital-api), no sobre el de la SPA. Por eso NO estan en el
 * id_token (emitido para la SPA) sino en el access_token (emitido para la
 * API, scope apiScope) -- hay que decodificar ese token, no idTokenClaims.
 * Se detecto porque `curl` con el access_token si mostraba "roles", pero la
 * topbar (que leia idTokenClaims) siempre los veia vacios.
 */
export async function rolesDe(msal: MsalService): Promise<string[]> {
  const account = msal.instance.getActiveAccount();
  if (!account) return [];
  try {
    const result = await msal.instance.acquireTokenSilent({ scopes: [environment.apiScope], account });
    return rolesDelAccessToken(result.accessToken);
  } catch (e) {
    console.error('No se pudo leer el access token para roles', e);
    return [];
  }
}

function rolesDelAccessToken(accessToken: string): string[] {
  const payload = accessToken.split('.')[1];
  if (!payload) return [];
  const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
  const claims = JSON.parse(json) as Record<string, unknown>;
  return Array.isArray(claims['roles']) ? (claims['roles'] as string[]) : [];
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

/** Todas las cuentas que MSAL tiene cacheadas en este navegador (no solo la activa). */
export function cuentasDisponibles(msal: MsalService) {
  return msal.instance.getAllAccounts();
}

/**
 * Suma una cuenta nueva sin cerrar la sesion actual: prompt "select_account"
 * fuerza el selector de Microsoft en vez de reusar la sesion SSO de la cuenta
 * activa. La cuenta queda cacheada junto a las demas; cambiar entre ellas
 * despues es solo setActiveAccount (sin volver a pasar por el popup).
 */
export function agregarCuenta(
  msal: MsalService,
  guardConfig: MsalGuardConfiguration,
  onSuccess: () => void,
): void {
  const scopes = (guardConfig.authRequest as { scopes?: string[] })?.scopes ?? [];
  msal.loginPopup({ scopes, prompt: 'select_account' }).subscribe({
    next: (res: AuthenticationResult) => {
      msal.instance.setActiveAccount(res.account);
      onSuccess();
    },
    error: (e) => console.error(e),
  });
}
