import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs/operators';
import { ETIQUETA } from '../requests/requests.component';
import { EstadoTramite } from '../requests/requests.service';
import { AuditService, EventoAuditoria, FILTRO_VACIO, FiltroAuditoria } from './audit.service';

/** Eventos de un mismo dia, para leer la linea de tiempo por jornadas. */
interface Dia {
  fecha: string;
  eventos: EventoAuditoria[];
}

@Component({
  selector: 'app-audit',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <header class="page-head">
      <div>
        <p class="eyebrow">Registro de auditoría · solo lectura</p>
        <h1>Historial</h1>
        <p class="lead-sm">
          Todo lo que pasó con cada trámite: quién lo ingresó, quién lo gestionó y cuándo.
          Busca por persona para ver lo que hizo un funcionario o lo que le pasó a un vecino.
        </p>
      </div>
    </header>

    <!-- El filtrado es del backend: se manda como query params, no se recorta en pantalla. -->
    <form class="panel-filtros" (ngSubmit)="buscar()">
      <div class="campo campo-ancho">
        <label for="f-persona">Persona</label>
        <input id="f-persona" class="filtro-input" type="search" [(ngModel)]="filtro.persona" name="persona"
               placeholder="correo@duocuc.cl" autocomplete="off" />
      </div>
      <div class="campo">
        <label for="f-tramite">Trámite</label>
        <input id="f-tramite" class="filtro-input" inputmode="numeric" [(ngModel)]="filtro.tramiteId" name="tramiteId" placeholder="#12" />
      </div>
      <div class="campo">
        <label for="f-tipo">Evento</label>
        <select id="f-tipo" class="filtro-select" [(ngModel)]="filtro.tipoEvento" name="tipoEvento">
          <option value="">Todos</option>
          <option *ngFor="let e of ESTADOS" [value]="e">{{ etiqueta(e) }}</option>
        </select>
      </div>
      <div class="campo">
        <label for="f-desde">Desde</label>
        <input id="f-desde" class="filtro-input" type="date" [(ngModel)]="filtro.desde" name="desde" [attr.max]="filtro.hasta || null" />
      </div>
      <div class="campo">
        <label for="f-hasta">Hasta</label>
        <input id="f-hasta" class="filtro-input" type="date" [(ngModel)]="filtro.hasta" name="hasta" [attr.min]="filtro.desde || null" />
      </div>
      <div class="campo campo-botones">
        <button type="submit" class="btn btn-primary btn-sm" [disabled]="cargando">{{ cargando ? 'Buscando…' : 'Buscar' }}</button>
        <button type="button" class="btn btn-ghost btn-sm btn-cancelar" *ngIf="hayFiltro" [disabled]="cargando" (click)="limpiar()">Limpiar</button>
      </div>
    </form>

    <!-- Resumen de la persona buscada: es la ficha que necesita el funcionario que la atiende. -->
    <section class="ficha-persona" *ngIf="!cargando && !errorCarga && conFiltroPersona && eventos.length">
      <p class="ficha-nombre">{{ conFiltroPersona }}</p>
      <div class="ficha-numeros">
        <span><b>{{ tramitesDistintos }}</b> {{ tramitesDistintos === 1 ? 'trámite' : 'trámites' }}</span>
        <span><b>{{ eventos.length }}</b> {{ eventos.length === 1 ? 'evento' : 'eventos' }}</span>
        <span>Último movimiento <b>{{ eventos[0].timestamp | date: 'd MMM y, HH:mm' }}</b></span>
      </div>
    </section>

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
      <p class="filtros-conteo">{{ eventos.length }} {{ eventos.length === 1 ? 'evento' : 'eventos' }}</p>

      <section class="dia" *ngFor="let d of dias">
        <h2 class="dia-titulo">{{ d.fecha | date: "EEEE d 'de' MMMM y" }}</h2>
        <ul class="timeline">
          <li *ngFor="let e of d.eventos" [ngClass]="'ev-' + e.estadoNuevo">
            <p class="cuando">{{ e.timestamp | date: 'HH:mm:ss' }}</p>
            <p class="que">
              <ng-container *ngIf="!e.estadoAnterior; else cambio">
                <ng-container *ngIf="aNombreDeOtro(e); else propio">
                  <button type="button" class="persona" (click)="verPersona(e.usuario)">{{ e.usuario }}</button>
                  ingresó el trámite <b>#{{ e.tramiteId }}</b> a nombre de
                  <button type="button" class="persona" (click)="verPersona(e.vecinoUsername!)">{{ e.vecinoUsername }}</button>
                </ng-container>
                <ng-template #propio>
                  <button type="button" class="persona" (click)="verPersona(e.usuario)">{{ e.usuario }}</button>
                  ingresó el trámite <b>#{{ e.tramiteId }}</b>
                </ng-template>
              </ng-container>
              <ng-template #cambio>
                <button type="button" class="persona" (click)="verPersona(e.usuario)">{{ e.usuario }}</button>
                movió el trámite <b>#{{ e.tramiteId }}</b>
                <span class="badge" [ngClass]="e.estadoAnterior">{{ etiqueta(e.estadoAnterior) }}</span>
                <span class="flecha">→</span>
                <span class="badge" [ngClass]="e.estadoNuevo">{{ etiqueta(e.estadoNuevo) }}</span>
              </ng-template>
            </p>
            <p class="quien" *ngIf="e.vecinoUsername && e.estadoAnterior">
              Vecino: <button type="button" class="persona" (click)="verPersona(e.vecinoUsername)">{{ e.vecinoUsername }}</button>
            </p>
            <blockquote class="ev-nota" *ngIf="e.nota && !aNombreDeOtro(e)">{{ e.nota }}</blockquote>
          </li>
        </ul>
      </section>

      <!-- "Sin resultados" no es lo mismo que "sin eventos": el mensaje dice cual de los dos es. -->
      <div class="vacio" *ngIf="!eventos.length">
        <p *ngIf="!conFiltro">Todavía no hay eventos de auditoría registrados.</p>
        <ng-container *ngIf="conFiltro">
          <p>Ningún evento calza con la búsqueda.</p>
          <button class="btn btn-ghost btn-sm btn-cancelar" (click)="limpiar()">Ver todos</button>
        </ng-container>
      </div>
    </ng-container>
  `,
})
export class AuditComponent implements OnInit {
  /** Los tipos de evento son los estados de trámite: el backend filtra por `estadoNuevo`. */
  readonly ESTADOS = Object.keys(ETIQUETA) as EstadoTramite[];
  readonly filasSkeleton = [1, 2, 3];

  eventos: EventoAuditoria[] = [];
  dias: Dia[] = [];
  cargando = true;
  errorCarga = '';
  /** Si la última carga llevaba filtros: un resultado vacío significa otra cosa. */
  conFiltro = false;
  /** Persona de la última búsqueda, para el resumen. */
  conFiltroPersona = '';
  tramitesDistintos = 0;
  filtro: FiltroAuditoria = { ...FILTRO_VACIO };

  private readonly destroyRef = inject(DestroyRef);

  constructor(private service: AuditService, private route: ActivatedRoute, private router: Router) {}

  ngOnInit(): void {
    // Los filtros viven en la URL: "Ver historial del vecino" en Tramites llega con
    // ?persona=, y una busqueda se puede compartir o volver a abrir con el boton atras.
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((q) => {
      this.filtro = {
        persona: q.get('persona') ?? '',
        tramiteId: q.get('tramite') ?? '',
        tipoEvento: q.get('evento') ?? '',
        desde: q.get('desde') ?? '',
        hasta: q.get('hasta') ?? '',
      };
      this.cargar();
    });
  }

  get hayFiltro(): boolean {
    const f = this.filtro;
    return !!(f.persona || f.tramiteId || f.tipoEvento || f.desde || f.hasta);
  }

  /** Lleva los filtros a la URL; si no cambiaron (mismo URL) se recarga igual. */
  buscar(): void {
    const f = this.filtro;
    const queryParams = {
      persona: f.persona.trim() || null,
      tramite: f.tramiteId.trim().replace(/^#/, '') || null,
      evento: f.tipoEvento || null,
      desde: f.desde || null,
      hasta: f.hasta || null,
    };
    this.irA(queryParams);
  }

  /** Navegar a la misma URL no dispara queryParamMap: en ese caso se recarga a mano. */
  private irA(queryParams: Record<string, string | null>): void {
    const destino = this.router.createUrlTree([], { relativeTo: this.route, queryParams });
    if (this.router.serializeUrl(destino) === this.router.url) this.cargar();
    else this.router.navigateByUrl(destino);
  }

  verPersona(correo: string): void {
    this.irA({ persona: correo });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  cargar(): void {
    this.cargando = true;
    this.errorCarga = '';
    this.conFiltro = this.hayFiltro;
    this.conFiltroPersona = this.filtro.persona.trim();
    this.service.timeline(this.filtro)
      .pipe(finalize(() => (this.cargando = false)))
      .subscribe({
        next: (data) => {
          this.eventos = [...data].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
          this.tramitesDistintos = new Set(this.eventos.map((e) => e.tramiteId)).size;
          this.dias = agruparPorDia(this.eventos);
        },
        error: (e) => {
          this.eventos = [];
          this.dias = [];
          this.errorCarga = e.error?.detail ?? `No se pudo cargar la auditoría (${e.status}).`;
        },
      });
  }

  limpiar(): void {
    this.irA({});
  }

  /** Lo ingreso un funcionario a nombre de un vecino (el actor no es el dueno del tramite). */
  aNombreDeOtro(e: EventoAuditoria): boolean {
    return !e.estadoAnterior && !!e.vecinoUsername && e.vecinoUsername.toLowerCase() !== e.usuario.toLowerCase();
  }

  /** Un estado desconocido se muestra tal cual en vez de quedar en blanco. */
  etiqueta(estado: string | null): string {
    return ETIQUETA[estado as EstadoTramite] ?? estado ?? '';
  }
}

/** Agrupa por dia local; los eventos ya vienen del mas reciente al mas antiguo. */
function agruparPorDia(eventos: EventoAuditoria[]): Dia[] {
  const dias: Dia[] = [];
  for (const e of eventos) {
    const d = new Date(e.timestamp);
    const clave = new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
    const ultimo = dias[dias.length - 1];
    if (ultimo?.fecha === clave) ultimo.eventos.push(e);
    else dias.push({ fecha: clave, eventos: [e] });
  }
  return dias;
}
