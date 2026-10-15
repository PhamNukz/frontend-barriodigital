import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import { ETIQUETA } from '../requests/requests.component';
import { EstadoTramite } from '../requests/requests.service';
import { AuditService, EventoAuditoria, FILTRO_VACIO, FiltroAuditoria } from './audit.service';

@Component({
  selector: 'app-audit',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h2>Auditoría</h2>
    <p class="muted">Cada cambio de estado de un trámite, del más reciente al más antiguo. Solo lectura · Admin y Auditor.</p>

    <!-- El filtrado es del backend: se manda como query params, no se recorta en pantalla. -->
    <form class="filtros" (ngSubmit)="cargar()">
      <label for="f-usuario">Usuario</label>
      <input id="f-usuario" class="filtro-input" [(ngModel)]="filtro.usuario" name="usuario" placeholder="correo@duocuc.cl" />

      <label for="f-tipo">Tipo de evento</label>
      <select id="f-tipo" class="filtro-select" [(ngModel)]="filtro.tipoEvento" name="tipoEvento">
        <option value="">Todos</option>
        <option *ngFor="let e of ESTADOS" [value]="e">{{ etiqueta(e) }}</option>
      </select>

      <label for="f-desde">Desde</label>
      <input id="f-desde" class="filtro-input" type="date" [(ngModel)]="filtro.desde" name="desde" [attr.max]="filtro.hasta || null" />

      <label for="f-hasta">Hasta</label>
      <input id="f-hasta" class="filtro-input" type="date" [(ngModel)]="filtro.hasta" name="hasta" [attr.min]="filtro.desde || null" />

      <button type="submit" class="btn btn-primary btn-sm" [disabled]="cargando">{{ cargando ? 'Buscando…' : 'Filtrar' }}</button>
      <button type="button" class="btn btn-ghost btn-sm btn-cancelar" *ngIf="hayFiltro" [disabled]="cargando" (click)="limpiar()">Limpiar</button>

      <span class="filtros-conteo" *ngIf="!cargando && !errorCarga">
        {{ eventos.length }} {{ eventos.length === 1 ? 'evento' : 'eventos' }}
      </span>
    </form>

    <!-- Fallo de carga: NO se muestra el estado vacio, que haria creer que no hay eventos -->
    <div class="load-error" *ngIf="errorCarga && !cargando">
      <p>{{ errorCarga }}</p>
      <button class="btn btn-outline btn-sm" (click)="cargar()">Reintentar</button>
    </div>

    <ul class="timeline" *ngIf="cargando" aria-hidden="true">
      <li *ngFor="let fila of filasSkeleton">
        <span class="skeleton skeleton-sm"></span>
        <span class="skeleton skeleton-lg"></span>
      </li>
    </ul>

    <ng-container *ngIf="!cargando && !errorCarga">
      <ul class="timeline" *ngIf="eventos.length; else vacio">
        <li *ngFor="let e of eventos">
          <p class="cuando">{{ e.timestamp | date: 'dd-MM-yyyy HH:mm:ss' }}</p>
          <p class="que">
            Trámite <b>#{{ e.tramiteId }}</b>
            <ng-container *ngIf="e.estadoAnterior">
              <span class="badge" [ngClass]="e.estadoAnterior">{{ etiqueta(e.estadoAnterior) }}</span>
              <span class="flecha">→</span>
            </ng-container>
            <span class="badge" [ngClass]="e.estadoNuevo">{{ etiqueta(e.estadoNuevo) }}</span>
          </p>
          <p class="quien">por <b>{{ e.usuario }}</b></p>
        </li>
      </ul>

      <!-- "Sin resultados" no es lo mismo que "sin eventos": el mensaje dice cual de los dos es. -->
      <ng-template #vacio>
        <p class="muted" *ngIf="!conFiltro">Todavía no hay eventos de auditoría registrados.</p>
        <p class="muted" *ngIf="conFiltro">
          Ningún evento calza con el filtro.
          <button class="btn btn-ghost btn-sm btn-cancelar" (click)="limpiar()">Ver todos</button>
        </p>
      </ng-template>
    </ng-container>
  `,
})
export class AuditComponent implements OnInit {
  /** Los tipos de evento son los estados de trámite: el backend filtra por `estadoNuevo`. */
  readonly ESTADOS = Object.keys(ETIQUETA) as EstadoTramite[];
  readonly filasSkeleton = [1, 2, 3];

  eventos: EventoAuditoria[] = [];
  cargando = true;
  errorCarga = '';
  /** Si la última carga llevaba filtros: un resultado vacío significa otra cosa. */
  conFiltro = false;
  filtro: FiltroAuditoria = { ...FILTRO_VACIO };

  constructor(private service: AuditService) {}

  ngOnInit(): void {
    this.cargar();
  }

  get hayFiltro(): boolean {
    return !!(this.filtro.usuario || this.filtro.tipoEvento || this.filtro.desde || this.filtro.hasta);
  }

  cargar(): void {
    this.cargando = true;
    this.errorCarga = '';
    this.conFiltro = this.hayFiltro;
    this.service.timeline(this.filtro)
      .pipe(finalize(() => (this.cargando = false)))
      .subscribe({
        next: (data) => {
          // El microservicio devuelve en orden de insercion; una linea de tiempo se lee al reves.
          this.eventos = [...data].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        },
        error: (e) => {
          this.eventos = [];
          this.errorCarga = e.error?.detail ?? `No se pudo cargar la auditoría (${e.status}).`;
        },
      });
  }

  limpiar(): void {
    this.filtro = { ...FILTRO_VACIO };
    this.cargar();
  }

  /** Un estado desconocido se muestra tal cual en vez de quedar en blanco. */
  etiqueta(estado: string | null): string {
    return ETIQUETA[estado as EstadoTramite] ?? estado ?? '';
  }
}
