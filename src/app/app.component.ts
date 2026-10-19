import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs/operators';
import { Sesion, SessionService } from './auth/session.service';

interface Enlace {
  ruta: string;
  texto: string;
  roles: string[] | null;
}

/** Misma matriz que los roleGuard de app.routes.ts: aqui decide que se muestra, alla quien entra. */
const ENLACES: Enlace[] = [
  { ruta: '/dashboard', texto: 'Inicio', roles: null },
  { ruta: '/requests', texto: 'Trámites', roles: null },
  { ruta: '/catalog', texto: 'Catálogo', roles: ['Admin', 'Funcionario'] },
  { ruta: '/audit', texto: 'Auditoría', roles: ['Admin', 'Auditor', 'Funcionario'] },
  { ruta: '/reports', texto: 'Reportes', roles: ['Admin'] },
  { ruta: '/queues', texto: 'Colas', roles: ['Admin'] },
];

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="topbar" [class.menu-abierto]="menuAbierto">
      <a routerLink="" class="brand" (click)="menuAbierto = false">
        <span class="brand-mark" aria-hidden="true">B</span>
        <span>Barrio<em>Digital</em></span>
      </a>

      <button
        *ngIf="s.loggedIn"
        class="menu-toggle"
        type="button"
        [attr.aria-expanded]="menuAbierto"
        aria-controls="menu-principal"
        (click)="menuAbierto = !menuAbierto"
      >
        <span class="sr-only">Menú</span>
        <span class="hamburguesa" aria-hidden="true"></span>
      </button>

      <div class="topbar-cuerpo" id="menu-principal" *ngIf="s.loggedIn">
        <nav aria-label="Principal">
          <a
            *ngFor="let e of enlaces"
            [routerLink]="e.ruta"
            routerLinkActive="active"
            (click)="menuAbierto = false"
          >{{ e.texto }}</a>
        </nav>

        <div class="session">
          <div class="who">
            <ng-container *ngIf="s.cargando">Cargando…</ng-container>
            <ng-container *ngIf="!s.cargando">
              <span class="who-user" [title]="s.username">{{ s.username }}</span>
              <span class="role-chip" *ngFor="let r of s.roles">{{ r }}</span>
              <span *ngIf="s.exp as exp" class="token-exp" [class.token-exp-vencido]="expiraEn(exp) <= 0">
                Token {{ expiraEn(exp) > 0 ? 'expira en ' + expiraEn(exp) + ' min' : 'expirado' }}
              </span>
            </ng-container>
          </div>

          <label class="sr-only" for="cuenta">Cuenta activa</label>
          <select
            id="cuenta"
            *ngIf="s.accounts.length > 1"
            class="account-switch"
            [ngModel]="s.activeAccountId"
            (ngModelChange)="cambiarCuenta($event)"
            name="cuenta"
            title="Cambiar de cuenta sin cerrar sesión"
          >
            <option *ngFor="let a of s.accounts" [value]="a.homeAccountId">{{ a.username }}</option>
          </select>

          <div class="session-actions">
            <button class="btn btn-ghost btn-sm" (click)="session.renovarToken()" title="Pedir un access token nuevo">↻ Renovar</button>
            <button class="btn btn-ghost btn-sm" (click)="session.agregarCuenta()">+ Cuenta</button>
            <button class="btn btn-ghost btn-sm" (click)="session.cerrarSesion()">Cerrar sesión</button>
          </div>
        </div>
      </div>

      <button class="btn btn-ghost" *ngIf="!s.loggedIn" (click)="session.iniciarSesion()">Iniciar sesión</button>
    </header>

    <main>
      <router-outlet></router-outlet>
    </main>
    <!-- Mientras se lee el token de la cuenta, un velo tapa la vista: si no, se alcanzaba
         a ver (y a usar) la pantalla con los datos de la cuenta anterior. Es un velo y no
         un *ngIf para no destruir la pantalla en cada "Renovar". -->
    <div class="cambiando" *ngIf="s.loggedIn && s.cargando" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <p>Cargando la sesión de la cuenta…</p>
    </div>
  `,
})
export class AppComponent implements OnInit {
  s: Sesion = { loggedIn: false, username: '', roles: [], scopes: [], accounts: [], activeAccountId: '', exp: null, cargando: true };
  enlaces: Enlace[] = [];
  menuAbierto = false;

  /** Cuenta con la que se armo la vista actual; null antes de la primera carga. */
  private cuentaDeLaVista: string | null = null;

  constructor(public session: SessionService, private router: Router) {}

  ngOnInit(): void {
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => (this.menuAbierto = false));
    this.session.estado$.subscribe((s) => {
      this.s = s;
      this.enlaces = ENLACES.filter((e) => !e.roles || e.roles.some((r) => s.roles.includes(r)));
      if (s.cargando) return;

      const cuenta = s.loggedIn ? s.activeAccountId : '';
      if (this.cuentaDeLaVista !== null && cuenta !== this.cuentaDeLaVista) this.reconstruirVista(s.loggedIn);
      this.cuentaDeLaVista = cuenta;
    });
    this.session.refrescar();
  }

  cambiarCuenta(homeAccountId: string): void {
    this.menuAbierto = false;
    this.session.cambiarCuenta(homeAccountId);
  }

  /**
   * Cambio de cuenta: la pantalla actual se destruye y se vuelve a crear. Asi no queda
   * nada de la cuenta anterior (tramites, filtros, polling con el token viejo) y los
   * guards de rol se vuelven a evaluar: si la cuenta nueva no puede entrar a esta ruta,
   * el guard la manda a la portada.
   */
  private reconstruirVista(loggedIn: boolean): void {
    if (!loggedIn) {
      this.router.navigateByUrl('/');
      return;
    }
    const url = this.router.url;
    this.router.navigateByUrl('/login', { skipLocationChange: true }).then(() => this.router.navigateByUrl(url));
  }

  /** Minutos que faltan para que expire el access token (exp es epoch en segundos). */
  expiraEn(exp: number): number {
    return Math.round((exp * 1000 - Date.now()) / 60000);
  }
}
