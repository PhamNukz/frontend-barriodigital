import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';
import {
  MsalService,
  MsalBroadcastService,
  MSAL_GUARD_CONFIG,
  MsalGuardConfiguration,
} from '@azure/msal-angular';
import { AccountInfo, EventMessage, EventType, InteractionStatus } from '@azure/msal-browser';
import { agregarCuenta, cuentasDisponibles, iniciarSesion, rolesDe, usernameDe } from './auth/roles';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="topbar">
      <a routerLink="" class="brand"><span class="dot">◆</span>BarrioDigital</a>
      <nav *ngIf="loggedIn">
        <a routerLink="/requests" routerLinkActive="active">Trámites</a>
        <a routerLink="/catalog" routerLinkActive="active">Catálogo</a>
      </nav>
      <span style="flex: 1"></span>
      <div class="session" *ngIf="loggedIn">
        <select
          *ngIf="accounts.length > 1"
          class="account-switch"
          [ngModel]="activeAccountId"
          (ngModelChange)="cambiarCuenta($event)"
          name="cuenta"
          title="Cambiar de cuenta sin cerrar sesión"
        >
          <option *ngFor="let a of accounts" [value]="a.homeAccountId">{{ a.username }}</option>
        </select>
        <span class="who">
          <ng-container *ngIf="accounts.length <= 1">{{ username }}</ng-container>
          <ng-container *ngIf="roles.length"><br /><span class="role">{{ roles.join(', ') }}</span></ng-container>
        </span>
        <button class="btn btn-ghost btn-sm" (click)="onAgregarCuenta()">+ Cuenta</button>
        <button class="btn btn-ghost" (click)="logout()">Cerrar sesión</button>
      </div>
      <button class="btn btn-ghost" *ngIf="!loggedIn" (click)="login()">Iniciar sesión</button>
    </header>
    <main>
      <router-outlet></router-outlet>
    </main>
  `,
})
export class AppComponent implements OnInit {
  loggedIn = false;
  username = '';
  roles: string[] = [];
  accounts: AccountInfo[] = [];
  activeAccountId = '';

  private readonly destroying$ = new Subject<void>();

  constructor(
    @Inject(MSAL_GUARD_CONFIG) private guardConfig: MsalGuardConfiguration,
    private msal: MsalService,
    private broadcast: MsalBroadcastService,
  ) {}

  ngOnInit(): void {
    this.refresh();

    this.broadcast.msalSubject$
      .pipe(
        filter((m: EventMessage) => m.eventType === EventType.LOGIN_SUCCESS),
        takeUntil(this.destroying$),
      )
      .subscribe(() => this.refresh());

    this.broadcast.inProgress$
      .pipe(
        filter((s: InteractionStatus) => s === InteractionStatus.None),
        takeUntil(this.destroying$),
      )
      .subscribe(() => this.refresh());
  }

  private async refresh(): Promise<void> {
    const account =
      this.msal.instance.getActiveAccount() ?? this.msal.instance.getAllAccounts()[0];
    if (account) this.msal.instance.setActiveAccount(account);
    this.loggedIn = !!account;
    this.username = usernameDe(this.msal);
    this.accounts = cuentasDisponibles(this.msal);
    this.activeAccountId = account?.homeAccountId ?? '';
    this.roles = account ? await rolesDe(this.msal) : [];
  }

  /** Cambia la cuenta activa sin volver a pasar por el login popup. */
  cambiarCuenta(homeAccountId: string): void {
    const cuenta = this.accounts.find((a) => a.homeAccountId === homeAccountId);
    if (cuenta) {
      this.msal.instance.setActiveAccount(cuenta);
      this.refresh();
    }
  }

  onAgregarCuenta(): void {
    agregarCuenta(this.msal, this.guardConfig, () => this.refresh());
  }

  login(): void {
    iniciarSesion(this.msal, this.guardConfig, () => this.refresh());
  }

  logout(): void {
    this.msal.logoutPopup({ mainWindowRedirectUri: '/' });
  }
}
