import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, takeUntil } from 'rxjs/operators';
import { Subject } from 'rxjs';
import {
  MsalService,
  MsalBroadcastService,
  MSAL_GUARD_CONFIG,
  MsalGuardConfiguration,
} from '@azure/msal-angular';
import { EventMessage, EventType, InteractionStatus } from '@azure/msal-browser';
import { iniciarSesion, rolesDe, usernameDe } from './auth/roles';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="topbar">
      <a routerLink="" class="brand"><span class="dot">◆</span>BarrioDigital</a>
      <nav *ngIf="loggedIn">
        <a routerLink="/requests" routerLinkActive="active">Trámites</a>
        <a routerLink="/catalog" routerLinkActive="active">Catálogo</a>
      </nav>
      <span style="flex: 1"></span>
      <div class="session">
        <span class="who" *ngIf="username">
          {{ username }}
          <ng-container *ngIf="roles.length"><br /><span class="role">{{ roles.join(', ') }}</span></ng-container>
        </span>
        <button class="btn btn-ghost" *ngIf="!loggedIn" (click)="login()">Iniciar sesión</button>
        <button class="btn btn-ghost" *ngIf="loggedIn" (click)="logout()">Cerrar sesión</button>
      </div>
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

  private refresh(): void {
    const account =
      this.msal.instance.getActiveAccount() ?? this.msal.instance.getAllAccounts()[0];
    if (account) this.msal.instance.setActiveAccount(account);
    this.loggedIn = !!account;
    this.username = usernameDe(this.msal);
    this.roles = rolesDe(this.msal);
  }

  login(): void {
    iniciarSesion(this.msal, this.guardConfig, () => this.refresh());
  }

  logout(): void {
    this.msal.logoutPopup({ mainWindowRedirectUri: '/' });
  }
}
