import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Sesion, SessionService } from '../auth/session.service';

interface Acceso {
  ruta: string;
  titulo: string;
  detalle: string;
  ico: string;
  roles: string[];
}

/**
 * Accesos de la app con el rol que los habilita. Es la misma matriz que ya
 * aplican los roleGuard de app.routes.ts; aqui decide que se MUESTRA, no que
 * se puede entrar (la ruta sigue siendo la que manda).
 */
const ACCESOS: Acceso[] = [
  { ruta: '/requests', titulo: 'Trámites', detalle: 'Ingresar y seguir solicitudes', ico: '📋', roles: ['Admin', 'Funcionario', 'Vecino'] },
  { ruta: '/catalog', titulo: 'Catálogo', detalle: 'Tipos de trámite y cupos', ico: '🗂️', roles: ['Admin', 'Funcionario'] },
  { ruta: '/reports', titulo: 'Reportes', detalle: 'KPIs de atención', ico: '📊', roles: ['Admin'] },
  { ruta: '/audit', titulo: 'Historial', detalle: 'Auditoría por persona y trámite', ico: '🔎', roles: ['Admin', 'Auditor', 'Funcionario'] },
  { ruta: '/queues', titulo: 'Colas', detalle: 'RabbitMQ en vivo', ico: '📨', roles: ['Admin'] },
];

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  styles: ['.accesos { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 8px; }',
           '.accesos .service-pill { align-items: flex-start; }',
           '.accesos .detalle { font-weight: 400; font-size: 0.82rem; }'],
  template: `
    <div class="welcome-card">
      <ng-container *ngIf="s.cargando; else listo">
        <h2>Cargando…</h2>
        <p class="muted">Actualizando tu sesión.</p>
      </ng-container>
      <ng-template #listo>
        <h2>Hola, {{ s.username }}</h2>
        <!-- Los roles vienen del access token: mostrarlos es la evidencia en vivo
             de que el JWT llego con sus claims. -->
        <p *ngIf="s.roles.length; else sinRoles">
          Entraste como <b>{{ s.roles.join(', ') }}</b>.
        </p>
        <ng-template #sinRoles>
          <p class="muted">Tu token no trae ningún rol asignado.</p>
        </ng-template>
      </ng-template>
    </div>

    <ng-container *ngIf="!s.cargando">
      <h2>Qué puedes hacer</h2>
      <div class="accesos" *ngIf="accesos.length; else sinAccesos">
        <a *ngFor="let a of accesos" [routerLink]="a.ruta" class="service-pill">
          <span class="ico">{{ a.ico }}</span>
          <span>{{ a.titulo }}<br /><span class="detalle muted">{{ a.detalle }}</span></span>
        </a>
      </div>
      <ng-template #sinAccesos>
        <p class="muted">
          Tu cuenta no tiene ningún módulo habilitado. Pide a un administrador que te
          asigne un rol (Vecino, Funcionario, Auditor o Admin) sobre la API.
        </p>
      </ng-template>
    </ng-container>
  `,
})
export class DashboardComponent implements OnInit {
  s: Sesion = { loggedIn: false, username: '', roles: [], scopes: [], accounts: [], activeAccountId: '', exp: null, cargando: true };
  accesos: Acceso[] = [];

  private readonly destroyRef = inject(DestroyRef);

  constructor(private session: SessionService) {}

  ngOnInit(): void {
    // Se refresca con cada cambio de cuenta desde la topbar (mismo patron que catalog).
    this.session.estado$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((s) => {
      this.s = s;
      this.accesos = ACCESOS.filter((a) => a.roles.some((r) => s.roles.includes(r)));
    });
  }
}
