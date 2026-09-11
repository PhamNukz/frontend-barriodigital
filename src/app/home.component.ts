import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  MsalService,
  MSAL_GUARD_CONFIG,
  MsalGuardConfiguration,
} from '@azure/msal-angular';
import { iniciarSesion, rolesDe, usernameDe } from './auth/roles';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="hero">
      <div>
        <p class="eyebrow">Municipalidad · Atención vecinal digital</p>
        <h1>Tus trámites,<br /><em>sin hacer fila</em>.</h1>
        <p class="lead">
          Ingresa solicitudes, sigue su estado en tiempo real y coordina con la
          municipalidad todo desde un mismo lugar — con la identidad de tu cuenta
          institucional, sin usuarios ni contraseñas nuevas.
        </p>

        <div class="services" *ngIf="loggedIn">
          <a routerLink="/requests" class="service-pill"><span class="ico">📋</span> Trámites</a>
          <a routerLink="/catalog" class="service-pill"><span class="ico">🗂️</span> Catálogo</a>
        </div>
      </div>

      <div class="welcome-card" *ngIf="loggedIn">
        <h2>Hola de nuevo</h2>
        <p class="muted">{{ username }}</p>
        <p *ngIf="roles.length">
          Accediste como <b>{{ roles.join(', ') }}</b>. Usa el menú de arriba para
          entrar a Trámites o Catálogo.
        </p>
      </div>

      <div class="login-card" *ngIf="!loggedIn">
        <h2>Iniciar sesión</h2>
        <p>Usa tu cuenta institucional de Azure AD. No necesitas crear una cuenta nueva.</p>

        <button class="btn btn-microsoft" (click)="login()">
          <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
            <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
            <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
            <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
          </svg>
          Iniciar sesión con Microsoft
        </button>

        <div class="roles-hint">
          Según tu rol verás cosas distintas: <b>Vecino</b> ingresa y sigue sus trámites,
          <b>Funcionario</b> los gestiona, <b>Admin</b> administra el catálogo y KPIs,
          <b>Auditor</b> consulta el historial.
        </div>
      </div>
    </section>
  `,
})
export class HomeComponent implements OnInit {
  loggedIn = false;
  username = '';
  roles: string[] = [];

  constructor(
    @Inject(MSAL_GUARD_CONFIG) private guardConfig: MsalGuardConfiguration,
    private msal: MsalService,
  ) {}

  ngOnInit(): void {
    this.refresh();
  }

  private refresh(): void {
    const account = this.msal.instance.getActiveAccount();
    this.loggedIn = !!account;
    this.username = usernameDe(this.msal);
    this.roles = rolesDe(this.msal);
  }

  login(): void {
    iniciarSesion(this.msal, this.guardConfig, () => this.refresh());
  }
}
