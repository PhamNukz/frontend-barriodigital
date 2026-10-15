import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { CatalogService } from '../catalog/catalog.service';
import { Kpis, RangoReporte, ReportsService, TopProcedure } from './reports.service';

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h2>Reportes comunales</h2>

    <div class="filtros">
      <label for="f-rango">Rango</label>
      <!-- Solo last24h y last7d: son los dos unicos que acepta el backend. -->
      <select id="f-rango" class="filtro-select" [(ngModel)]="rango" name="rango" (ngModelChange)="cargar()">
        <option value="last24h">Últimas 24 horas</option>
        <option value="last7d">Últimos 7 días</option>
      </select>
      <span class="filtros-conteo">
        <button class="btn btn-ghost btn-sm" [disabled]="cargando" (click)="cargar()">↻ Actualizar</button>
      </span>
    </div>

    <!-- Fallo de carga: NO se muestran KPIs en cero, que se leerian como "no hubo actividad" -->
    <div class="load-error" *ngIf="errorCarga && !cargando">
      <p>{{ errorCarga }}</p>
      <button class="btn btn-outline btn-sm" (click)="cargar()">Reintentar</button>
    </div>

    <div class="kpi-row" *ngIf="cargando">
      <div class="kpi" *ngFor="let k of [1, 2, 3]" aria-hidden="true">
        <span class="skeleton skeleton-sm"></span>
        <span class="skeleton"></span>
      </div>
    </div>

    <ng-container *ngIf="!cargando && !errorCarga && kpis as k">
      <div class="kpi-row">
        <div class="kpi">
          <p class="kpi-label">Trámites ingresados</p>
          <p class="kpi-value">{{ ingresados }}</p>
          <p class="kpi-hint">{{ etiquetaRango }}</p>
        </div>
        <div class="kpi">
          <p class="kpi-label">Trámites activos</p>
          <p class="kpi-value">{{ k.tramitesActivos }}</p>
          <p class="kpi-hint">sin resolver ni rechazar, en todo el histórico</p>
        </div>
        <div class="kpi">
          <p class="kpi-label">Resolución promedio</p>
          <p class="kpi-value">{{ k.tiempoResolucionPromedioMin | number: '1.0-1' }} <small>min</small></p>
          <p class="kpi-hint">desde el ingreso hasta RESUELTO</p>
        </div>
      </div>

      <h3 class="bloque-titulo">Ingresos por hora</h3>
      <div class="tabla-scroll" *ngIf="k.tramitesPorHora.length; else sinHoras">
        <table>
          <thead>
            <tr><th>Hora</th><th>Trámites</th><th class="col-barra"></th></tr>
          </thead>
          <tbody>
            <tr *ngFor="let h of k.tramitesPorHora">
              <td>{{ h.hora | date: 'dd/MM HH:mm' }}</td>
              <td>{{ h.cantidad }}</td>
              <td class="col-barra">
                <span class="barra" [style.width.%]="porcentaje(h.cantidad, maxPorHora)"></span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <ng-template #sinHoras><p class="muted">Sin ingresos en {{ etiquetaRango }}.</p></ng-template>

      <h3 class="bloque-titulo">Trámites más solicitados</h3>
      <div class="tabla-scroll" *ngIf="top.length; else sinTop">
        <table>
          <thead>
            <tr><th>#</th><th>Tipo de trámite</th><th>Solicitudes</th><th class="col-barra"></th></tr>
          </thead>
          <tbody>
            <tr *ngFor="let t of top; let i = index">
              <td>{{ i + 1 }}</td>
              <td>{{ nombreTipo(t.tipoId) }}</td>
              <td>{{ t.cantidad }}</td>
              <td class="col-barra">
                <span class="barra" [style.width.%]="porcentaje(t.cantidad, maxTop)"></span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <ng-template #sinTop><p class="muted">Sin solicitudes en {{ etiquetaRango }}.</p></ng-template>
    </ng-container>
  `,
  styles: [`
    .kpi-row { display: flex; flex-wrap: wrap; gap: 16px; margin-bottom: 28px; }
    .kpi {
      flex: 1 1 200px; background: var(--paper-raised); border: 1px solid var(--line);
      border-left: 4px solid var(--teal); border-radius: 14px; padding: 18px 20px;
      box-shadow: var(--shadow);
    }
    .kpi-label {
      margin: 0 0 8px; font-size: 0.75rem; font-weight: 700; letter-spacing: 0.05em;
      text-transform: uppercase; color: var(--ink-soft);
    }
    .kpi-value {
      margin: 0; font-family: "Fraunces", Georgia, serif; font-size: 2rem;
      line-height: 1.1; color: var(--teal-deep);
    }
    .kpi-value small { font-size: 0.9rem; font-weight: 400; color: var(--ink-soft); }
    .kpi-hint { margin: 6px 0 0; font-size: 0.75rem; color: var(--ink-soft); }
    .bloque-titulo {
      font-family: "Fraunces", Georgia, serif; font-size: 1.05rem;
      color: var(--teal-deep); margin: 28px 0 12px;
    }
    /* La barra es la columna: se estira sola y no necesita libreria de graficos. */
    .col-barra { width: 40%; }
    .barra {
      display: block; height: 10px; min-width: 2px; border-radius: 999px;
      background: var(--teal); opacity: 0.75;
    }
  `],
})
export class ReportsComponent implements OnInit {
  rango: RangoReporte = 'last24h';
  kpis: Kpis | null = null;
  top: TopProcedure[] = [];
  cargando = true;
  errorCarga = '';
  /** tipoId -> nombre, traido del catalogo para no mostrar ids pelados. */
  private nombres = new Map<number, string>();

  constructor(private service: ReportsService, private catalog: CatalogService) {}

  ngOnInit(): void {
    this.cargar();
  }

  cargar(): void {
    this.cargando = true;
    this.errorCarga = '';
    forkJoin({
      kpis: this.service.kpis(this.rango),
      top: this.service.topProcedures(this.rango),
      // El nombre del tipo es decoracion: si el catalogo falla, la tabla cae a
      // "Tipo #id" (visible, no silencioso) en vez de tumbar todo el reporte.
      tipos: this.catalog.listar().pipe(catchError(() => of([]))),
    })
      .pipe(finalize(() => (this.cargando = false)))
      .subscribe({
        next: ({ kpis, top, tipos }) => {
          this.kpis = kpis;
          this.top = top;
          this.nombres = new Map(tipos.map((t) => [t.id, t.nombre]));
        },
        error: (e) => {
          this.kpis = null;
          this.top = [];
          this.errorCarga = e.error?.detail ?? `No se pudieron cargar los reportes (${e.status}).`;
        },
      });
  }

  get etiquetaRango(): string {
    return this.rango === 'last24h' ? 'las últimas 24 horas' : 'los últimos 7 días';
  }

  /** El backend no manda el total: es la suma de la serie por hora del rango. */
  get ingresados(): number {
    return (this.kpis?.tramitesPorHora ?? []).reduce((a, h) => a + h.cantidad, 0);
  }

  get maxPorHora(): number {
    return Math.max(...(this.kpis?.tramitesPorHora ?? []).map((h) => h.cantidad), 1);
  }

  get maxTop(): number {
    return Math.max(...this.top.map((t) => t.cantidad), 1);
  }

  porcentaje(cantidad: number, max: number): number {
    return (cantidad / max) * 100;
  }

  nombreTipo(tipoId: number): string {
    return this.nombres.get(tipoId) ?? `Tipo #${tipoId}`;
  }
}
