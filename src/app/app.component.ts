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
import {
  AuthenticationResult,
  EventMessage,
  EventType,
  InteractionStatus,
} from '@azure/msal-browser';
import { rolesDe, usernameDe } from './auth/roles';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="topbar">
      <nav>
        <a routerLink="" routerLinkActive="active" [routerLinkActiveOptions]="{exact: true}"><strong>BarrioDigital</strong></a>
        <a *ngIf="loggedIn" routerLink="/requests" routerLinkActive="active">Trámites</a>
        <a *ngIf="loggedIn" routerLink="/catalog" routerLinkActive="active">Catálogo</a>
      </nav>
      <span>
        <span class="muted" style="color:#cfe0f2; margin-right:12px" *ngIf="username">
          {{ username }}<span *ngIf="roles.length"> · {{ roles.join(', ') }}</span>
        </span>
        <button *ngIf="!loggedIn" (click)="login()">Iniciar sesión</button>
        <button *ngIf="loggedIn" (click)="logout()">Cerrar sesión</button>
      </span>
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
    this.broadcast.msalSubject$
      .pipe(
        filter((m: EventMessage) => m.eventType === EventType.LOGIN_SUCCESS),
        takeUntil(this.destroying$),
      )
      .subscribe((m: EventMessage) => {
        const payload = m.payload as AuthenticationResult;
        this.msal.instance.setActiveAccount(payload.account);
        this.refresh();
      });

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
    if (account) {
      this.msal.instance.setActiveAccount(account);
      this.loggedIn = true;
      this.username = usernameDe(this.msal);
      this.roles = rolesDe(this.msal);
    } else {
      this.loggedIn = false;
      this.username = '';
      this.roles = [];
    }
  }

  login(): void {
    const scopes = (this.guardConfig.authRequest as { scopes?: string[] })?.scopes ?? [];
    this.msal.loginPopup({ scopes }).subscribe({
      next: (res: AuthenticationResult) => {
        this.msal.instance.setActiveAccount(res.account);
        this.refresh();
      },
      error: (e) => console.error(e),
    });
  }

  logout(): void {
    this.msal.logoutPopup({ mainWindowRedirectUri: '/' });
  }
}
