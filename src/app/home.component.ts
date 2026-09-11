import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  template: `
    <h1>BarrioDigital</h1>
    <p class="muted">
      Plataforma de trámites comunales. Inicia sesión con tu cuenta institucional
      (Azure AD) y entra a <a routerLink="/requests">Trámites</a> o
      <a routerLink="/catalog">Catálogo</a>. Si no has iniciado sesión, el guard
      abrirá el popup de Microsoft automáticamente.
    </p>
  `,
})
export class HomeComponent {}
