import { Inject, Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { filter } from 'rxjs/operators';
import { MsalService, MsalBroadcastService, MSAL_GUARD_CONFIG, MsalGuardConfiguration } from '@azure/msal-angular';
import { InteractionStatus } from '@azure/msal-browser';
import { agregarCuenta, cuentasDisponibles, iniciarSesion, rolesDe, usernameDe } from './roles';

export interface Sesion {
  loggedIn: boolean;
  username: string;
  roles: string[];
  accounts: ReturnType<typeof cuentasDisponibles>;
  activeAccountId: string;
  /** true mientras se pide el access token para leer roles (login, logout, cambio de cuenta). */
  cargando: boolean;
}

const SESION_INICIAL: Sesion = { loggedIn: false, username: '', roles: [], accounts: [], activeAccountId: '', cargando: true };

/**
 * Unica fuente de verdad de la sesion. Antes cada pantalla (topbar, home,
 * catalogo, tramites) leia el rol una sola vez en su propio ngOnInit -- si
 * cambiabas de cuenta desde la topbar sin recargar la pagina, esas pantallas
 * se quedaban con el usuario/rol viejo. Ahora todas escuchan este mismo
 * observable y se refrescan solas cuando cambia la cuenta activa.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly sesion$ = new BehaviorSubject<Sesion>(SESION_INICIAL);
  readonly estado$ = this.sesion$.asObservable();

  constructor(
    private msal: MsalService,
    private broadcast: MsalBroadcastService,
    @Inject(MSAL_GUARD_CONFIG) private guardConfig: MsalGuardConfiguration,
  ) {
    this.broadcast.inProgress$
      .pipe(filter((s) => s === InteractionStatus.None))
      .subscribe(() => this.refrescar());
  }

  async refrescar(): Promise<void> {
    this.sesion$.next({ ...this.sesion$.value, cargando: true });
    const account = this.msal.instance.getActiveAccount() ?? this.msal.instance.getAllAccounts()[0];
    if (account) this.msal.instance.setActiveAccount(account);
    this.sesion$.next({
      loggedIn: !!account,
      username: usernameDe(this.msal),
      roles: account ? await rolesDe(this.msal) : [],
      accounts: cuentasDisponibles(this.msal),
      activeAccountId: account?.homeAccountId ?? '',
      cargando: false,
    });
  }

  /** Cambia la cuenta activa sin volver a pasar por el popup de login. */
  cambiarCuenta(homeAccountId: string): void {
    const cuenta = this.sesion$.value.accounts.find((a) => a.homeAccountId === homeAccountId);
    if (cuenta) {
      this.msal.instance.setActiveAccount(cuenta);
      this.refrescar();
    }
  }

  iniciarSesion(): void {
    iniciarSesion(this.msal, this.guardConfig, () => this.refrescar());
  }

  agregarCuenta(): void {
    agregarCuenta(this.msal, this.guardConfig, () => this.refrescar());
  }

  cerrarSesion(): void {
    this.msal.logoutPopup({ mainWindowRedirectUri: '/' });
  }
}
