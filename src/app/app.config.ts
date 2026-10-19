import { ApplicationConfig, APP_INITIALIZER, LOCALE_ID } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeEsCl from '@angular/common/locales/es-CL';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptorsFromDi, HTTP_INTERCEPTORS } from '@angular/common/http';
import {
  IPublicClientApplication,
  PublicClientApplication,
  InteractionType,
  BrowserCacheLocation,
  LogLevel,
} from '@azure/msal-browser';
import {
  MSAL_INSTANCE,
  MSAL_GUARD_CONFIG,
  MSAL_INTERCEPTOR_CONFIG,
  MsalService,
  MsalGuard,
  MsalBroadcastService,
  MsalInterceptor,
  MsalGuardConfiguration,
  MsalInterceptorConfiguration,
} from '@azure/msal-angular';

import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { HttpResilienceInterceptor } from './http-resilience.interceptor';

// Fechas en espanol de Chile ("15 oct 2026"), no en el ingles por defecto de Angular.
registerLocaleData(localeEsCl);

export function MSALInstanceFactory(): IPublicClientApplication {
  return new PublicClientApplication({
    auth: {
      clientId: environment.msalClientId,
      authority: `https://login.microsoftonline.com/${environment.msalTenantId}`,
      redirectUri: environment.redirectUri,
      postLogoutRedirectUri: environment.postLogoutRedirectUri,
    },
    cache: {
      // sessionStorage y no localStorage: cada pestana tiene su propia sesion y sus propios
      // tokens. Con localStorage la cuenta activa se compartia entre pestanas, asi que entrar
      // como Vecino en una y como Funcionario en otra mezclaba los tokens de ambos.
      cacheLocation: BrowserCacheLocation.SessionStorage,
    },
    system: {
      loggerOptions: {
        loggerCallback: (_l: LogLevel, m: string) => console.debug(m),
        logLevel: LogLevel.Warning,
      },
    },
  });
}

export function MSALGuardConfigFactory(): MsalGuardConfiguration {
  return {
    interactionType: InteractionType.Popup,
    authRequest: { scopes: [environment.apiScope] },
  };
}

export function MSALInterceptorConfigFactory(): MsalInterceptorConfiguration {
  const protectedResourceMap = new Map<string, Array<string>>();
  protectedResourceMap.set(`${environment.apiBaseUrl}/api`, [environment.apiScope]);
  return {
    interactionType: InteractionType.Popup,
    protectedResourceMap,
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    { provide: LOCALE_ID, useValue: 'es-CL' },
    provideHttpClient(withInterceptorsFromDi()),

    { provide: HTTP_INTERCEPTORS, useClass: MsalInterceptor, multi: true },
    { provide: HTTP_INTERCEPTORS, useClass: HttpResilienceInterceptor, multi: true },
    { provide: MSAL_INSTANCE, useFactory: MSALInstanceFactory },
    { provide: MSAL_GUARD_CONFIG, useFactory: MSALGuardConfigFactory },
    { provide: MSAL_INTERCEPTOR_CONFIG, useFactory: MSALInterceptorConfigFactory },
    MsalService,
    MsalGuard,
    MsalBroadcastService,

    // MSAL v3 exige initialize() antes de usar la instancia
    {
      provide: APP_INITIALIZER,
      useFactory: (msal: MsalService) => () => msal.instance.initialize(),
      deps: [MsalService],
      multi: true,
    },
  ],
};
