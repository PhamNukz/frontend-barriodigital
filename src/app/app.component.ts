import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { Sesion, SessionService } from './auth/session.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="topbar">
      <a routerLink="" class="brand"><span class="dot">◆</span>BarrioDigital</a>
      <nav *ngIf="s.loggedIn">
        <a routerLink="/requests" routerLinkActive="active">Trámites</a>
        <a routerLink="/catalog" routerLinkActive="active">Catálogo</a>
      </nav>
      <span style="flex: 1"></span>
      <div class="session" *ngIf="s.loggedIn">
        <select
          *ngIf="s.accounts.length > 1"
          class="account-switch"
          [ngModel]="s.activeAccountId"
          (ngModelChange)="session.cambiarCuenta($event)"
          name="cuenta"
          title="Cambiar de cuenta sin cerrar sesión"
        >
          <option *ngFor="let a of s.accounts" [value]="a.homeAccountId">{{ a.username }}</option>
        </select>
        <span class="who">
          <ng-container *ngIf="s.cargando">Cargando…</ng-container>
          <ng-container *ngIf="!s.cargando">
            <ng-container *ngIf="s.accounts.length <= 1">{{ s.username }}</ng-container>
            <ng-container *ngIf="s.roles.length"><br /><span class="role">{{ s.roles.join(', ') }}</span></ng-container>
          </ng-container>
        </span>
        <button class="btn btn-ghost btn-sm" (click)="session.agregarCuenta()">+ Cuenta</button>
        <button class="btn btn-ghost" (click)="session.cerrarSesion()">Cerrar sesión</button>
      </div>
      <button class="btn btn-ghost" *ngIf="!s.loggedIn" (click)="session.iniciarSesion()">Iniciar sesión</button>
    </header>
    <main>
      <router-outlet></router-outlet>
    </main>
  `,
})
export class AppComponent implements OnInit {
  s: Sesion = { loggedIn: false, username: '', roles: [], accounts: [], activeAccountId: '', cargando: true };

  constructor(public session: SessionService) {}

  ngOnInit(): void {
    this.session.estado$.subscribe((s) => (this.s = s));
    this.session.refrescar();
  }
}
