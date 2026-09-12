import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SessionService } from '../auth/session.service';
import { CatalogService, TipoTramite } from '../catalog/catalog.service';
import { CupoInfo, EstadoTramite, RequestsService, Tramite } from './requests.service';

/** Siguiente estado sugerido en la UI; el backend vuelve a validar la transicion. */
const SIGUIENTE: Partial<Record<EstadoTramite, EstadoTramite>> = {
  INGRESADO: 'ADMITIDO',
  ADMITIDO: 'EN_GESTION',
  EN_GESTION: 'EN_TERRENO',
  EN_TERRENO: 'RESUELTO',
};

@Component({
  selector: 'app-requests',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h2>Trámites</h2>

    <form class="card" *ngIf="esVecinoOFuncionario" (ngSubmit)="crear()">
      <p class="card-title">Nuevo trámite</p>

      <label for="tipo">Tipo de trámite</label>
      <select id="tipo" [(ngModel)]="nuevo.tipoId" name="tipoId" (ngModelChange)="onTipoChange($event)" required>
        <option [ngValue]="null" disabled>Selecciona un tipo</option>
        <option *ngFor="let t of tipos" [ngValue]="t.id">{{ t.nombre }}</option>
      </select>
      <p class="muted cupo-hint" *ngIf="cupoInfo">
        <ng-container *ngIf="cupoInfo.disponible > 0; else agotado">
          Quedan <b>{{ cupoInfo.disponible }}</b> de {{ cupoInfo.cupoDiario }} cupos hoy para este trámite.
        </ng-container>
        <ng-template #agotado>Cupo diario agotado ({{ cupoInfo.cupoDiario }}/día) — igual puedes ingresarlo, quedará en espera.</ng-template>
      </p>

      <label for="descripcion">Descripción</label>
      <textarea id="descripcion" [(ngModel)]="nuevo.descripcion" name="descripcion" placeholder="Cuéntanos qué necesitas" required></textarea>

      <label for="direccion">Dirección</label>
      <input id="direccion" [(ngModel)]="nuevo.direccion" name="direccion" placeholder="Calle y número" />

      <button type="submit" class="btn btn-primary" [disabled]="enviando">
        {{ enviando ? 'Ingresando…' : 'Ingresar trámite' }}
      </button>
    </form>

    <p class="muted" *ngIf="error">{{ error }}</p>

    <table *ngIf="tramites.length; else vacio">
      <thead>
        <tr><th>ID</th><th>Vecino</th><th>Descripción</th><th>Estado</th><th>Funcionario</th><th *ngIf="esFuncionarioOAdmin"></th></tr>
      </thead>
      <tbody>
        <tr *ngFor="let t of tramites" [class.optimista]="esOptimista(t)">
          <td>{{ esOptimista(t) ? '…' : t.id }}</td><td>{{ t.vecinoUsername }}</td><td>{{ t.descripcion }}</td>
          <td><span class="badge" [ngClass]="t.estado">{{ t.estado }}</span></td>
          <td>{{ t.funcionarioAsignado }}</td>
          <td *ngIf="esFuncionarioOAdmin">
            <div class="row-actions" *ngIf="!esOptimista(t)">
              <button class="btn btn-outline btn-sm" *ngIf="siguienteEstado(t.estado) as sig" [disabled]="actualizando.has(t.id)" (click)="avanzar(t, sig)">→ {{ sig }}</button>
              <button class="btn btn-danger btn-sm" *ngIf="puedeRechazar(t.estado)" [disabled]="actualizando.has(t.id)" (click)="avanzar(t, 'RECHAZADO')">Rechazar</button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <ng-template #vacio><p class="muted">Sin trámites.</p></ng-template>
  `,
})
export class RequestsComponent implements OnInit {
  tramites: Tramite[] = [];
  tipos: TipoTramite[] = [];
  cupoInfo: CupoInfo | null = null;
  error = '';
  esVecinoOFuncionario = false;
  esFuncionarioOAdmin = false;
  enviando = false;
  username = '';
  /** ids de tramites con un cambio de estado optimista en curso (deshabilita sus botones). */
  actualizando = new Set<number>();
  nuevo: { tipoId: number | null; descripcion: string; direccion: string } = {
    tipoId: null,
    descripcion: '',
    direccion: '',
  };

  constructor(
    private service: RequestsService,
    private catalogService: CatalogService,
    private session: SessionService,
  ) {}

  ngOnInit(): void {
    // Se resuscribe con cada cambio de cuenta desde la topbar, no solo al entrar a la pantalla.
    this.session.estado$.subscribe((s) => {
      this.username = s.username;
      this.esVecinoOFuncionario = s.roles.includes('Vecino') || s.roles.includes('Funcionario');
      this.esFuncionarioOAdmin = s.roles.includes('Funcionario') || s.roles.includes('Admin');
      if (this.esVecinoOFuncionario) {
        this.catalogService.listar().subscribe({ next: (data) => (this.tipos = data) });
      }
    });
    this.cargar();
  }

  cargar(): void {
    this.service.listar().subscribe({
      next: (data) => (this.tramites = data),
      error: (e) => (this.error = `No se pudieron cargar los trámites (${e.status})`),
    });
  }

  onTipoChange(tipoId: number | null): void {
    this.cupoInfo = null;
    if (tipoId == null) return;
    this.service.cupoDe(tipoId).subscribe({ next: (c) => (this.cupoInfo = c) });
  }

  /** Un tramite optimista es el placeholder local que se muestra antes de que el backend confirme la creacion. */
  esOptimista(t: Tramite): boolean {
    return t.id < 0;
  }

  crear(): void {
    // Guarda contra doble envio: Enter dispara ngSubmit, y si despues tambien
    // se hace clic en el boton (o se aprieta Enter dos veces) se duplicaba el tramite.
    if (this.enviando || this.nuevo.tipoId == null) return;
    this.enviando = true;
    this.error = '';

    const cuerpo = { tipoId: this.nuevo.tipoId, descripcion: this.nuevo.descripcion, direccion: this.nuevo.direccion };
    this.nuevo = { tipoId: null, descripcion: '', direccion: '' };
    this.cupoInfo = null;

    // Optimistic update: se muestra de inmediato, sin esperar la respuesta del backend.
    const tempId = -Date.now();
    const optimista: Tramite = {
      id: tempId,
      tipoId: cuerpo.tipoId,
      vecinoUsername: this.username,
      descripcion: cuerpo.descripcion,
      direccion: cuerpo.direccion || null,
      estado: 'INGRESADO',
      funcionarioAsignado: null,
      fechaIngreso: new Date().toISOString(),
      fechaAdmision: null,
      fechaResolucion: null,
    };
    this.tramites = [optimista, ...this.tramites];

    this.service.crear(cuerpo).subscribe({
      next: (real) => {
        this.enviando = false;
        this.tramites = this.tramites.map((t) => (t.id === tempId ? real : t));
      },
      error: (e) => {
        this.enviando = false;
        this.tramites = this.tramites.filter((t) => t.id !== tempId);
        this.error = e.error?.detail ?? `No se pudo crear (${e.status})`;
      },
    });
  }

  siguienteEstado(estado: EstadoTramite): EstadoTramite | null {
    return SIGUIENTE[estado] ?? null;
  }

  puedeRechazar(estado: EstadoTramite): boolean {
    return estado !== 'RESUELTO' && estado !== 'RECHAZADO';
  }

  avanzar(t: Tramite, nuevo: EstadoTramite): void {
    if (this.actualizando.has(t.id)) return;
    this.actualizando.add(t.id);
    const anterior = t.estado;
    t.estado = nuevo; // optimistic: el boton "siguiente estado" cambia de inmediato, sin esperar al backend

    this.service.cambiarEstado(t.id, nuevo).subscribe({
      next: (real) => {
        this.actualizando.delete(t.id);
        Object.assign(t, real);
      },
      error: (e) => {
        this.actualizando.delete(t.id);
        t.estado = anterior; // revierte el optimistic update si el backend lo rechaza (ej. cupo agotado)
        this.error = e.error?.detail ?? `No se pudo cambiar el estado (${e.status})`;
      },
    });
  }
}
