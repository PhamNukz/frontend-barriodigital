import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Subject, merge, timer } from 'rxjs';
import { catchError, exhaustMap, filter } from 'rxjs/operators';
import { InfoCola, QueuesService } from './queues.service';

/** Que hace cada cola, para leer el panel sin conocer la topologia de memoria. */
const PROPOSITO: Record<string, string> = {
  'q.cmd.email': 'Avisos por correo y push al vecino',
  'q.cmd.crew': 'Tickets de visita para la cuadrilla',
  'q.cmd.certificate': 'Comprobantes y certificados en PDF',
};

const CADA_MS = 5_000;

interface Fila extends InfoCola {
  dlq: boolean;
  proposito: string;
  /** Mensajes que tiene ahora menos los de la lectura anterior. */
  delta: number;
}

/**
 * Panel en vivo de las colas de RabbitMQ (rol Admin). Lee el plano de control
 * (ms-barriodigital-rabbitadmin, via BFF) cada 5 s: si una cola de trabajo
 * acumula mensajes o se queda sin consumidores, se ve aqui antes que en los logs.
 */
@Component({
  selector: 'app-queues',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header class="page-head">
      <div>
        <p class="eyebrow">RabbitMQ · plano de control</p>
        <h1>Colas en vivo</h1>
        <p class="lead-sm">
          Mensajes en espera y consumidores conectados de cada cola de comandos y su DLQ.
          Se actualiza cada {{ cadaSeg }} segundos.
        </p>
      </div>
      <div class="live-ctrl">
        <span class="live-dot" [class.pausado]="pausado" aria-hidden="true"></span>
        <span class="live-txt">{{ pausado ? 'En pausa' : 'En vivo' }}<ng-container *ngIf="actualizado"> · {{ actualizado | date: 'HH:mm:ss' }}</ng-container></span>
        <button class="btn btn-outline btn-sm" (click)="pausado = !pausado">{{ pausado ? 'Reanudar' : 'Pausar' }}</button>
        <button class="btn btn-ghost btn-sm btn-cancelar" (click)="refrescar$.next()">↻ Ahora</button>
      </div>
    </header>

    <div class="load-error" *ngIf="error">
      <p>{{ error }}</p>
      <button class="btn btn-outline btn-sm" (click)="refrescar$.next()">Reintentar</button>
    </div>

    <section class="resumen-colas" *ngIf="filas.length">
      <div class="q-kpi"><span class="q-kpi-num">{{ totalTrabajo }}</span><span class="q-kpi-txt">mensajes por procesar</span></div>
      <div class="q-kpi" [class.alerta]="totalDlq > 0"><span class="q-kpi-num">{{ totalDlq }}</span><span class="q-kpi-txt">en DLQ (fallidos)</span></div>
      <div class="q-kpi" [class.alerta]="sinConsumidor > 0"><span class="q-kpi-num">{{ sinConsumidor }}</span><span class="q-kpi-txt">colas de trabajo sin consumidor</span></div>
    </section>

    <div class="grid-colas" *ngIf="filas.length; else vacio">
      <article class="cola" *ngFor="let c of filas; trackBy: porNombre" [class.es-dlq]="c.dlq"
               [class.alerta]="(!c.dlq && c.consumidores === 0) || (c.dlq && c.mensajes > 0)">
        <header>
          <p class="cola-nombre">{{ c.nombre }}</p>
          <span class="cola-tipo">{{ c.dlq ? 'DLQ' : 'Trabajo' }}</span>
        </header>
        <p class="cola-proposito">{{ c.proposito }}</p>
        <p class="cola-num">
          {{ c.mensajes }}
          <span class="cola-delta" *ngIf="c.delta !== 0" [class.sube]="c.delta > 0">{{ c.delta > 0 ? '+' : '' }}{{ c.delta }}</span>
        </p>
        <p class="cola-sub">{{ c.mensajes === 1 ? 'mensaje' : 'mensajes' }} en espera</p>
        <div class="q-barra" aria-hidden="true"><span [style.width.%]="porcentaje(c)"></span></div>
        <p class="cola-consumidores">
          <span class="dot" [class.on]="c.consumidores > 0"></span>
          {{ c.consumidores }} {{ c.consumidores === 1 ? 'consumidor' : 'consumidores' }}
          <ng-container *ngIf="!c.dlq && c.consumidores === 0"> · nadie la está atendiendo</ng-container>
          <ng-container *ngIf="c.dlq && c.mensajes > 0"> · hay mensajes que revisar</ng-container>
        </p>
      </article>
    </div>
    <ng-template #vacio>
      <div class="vacio" *ngIf="!error"><p>{{ cargado ? 'rabbitadmin no reportó colas.' : 'Consultando las colas…' }}</p></div>
    </ng-template>
  `,
})
export class QueuesComponent implements OnInit {
  readonly cadaSeg = CADA_MS / 1000;
  filas: Fila[] = [];
  error = '';
  cargado = false;
  pausado = false;
  actualizado: Date | null = null;
  readonly refrescar$ = new Subject<void>();

  private readonly destroyRef = inject(DestroyRef);

  constructor(private service: QueuesService) {}

  ngOnInit(): void {
    // exhaustMap: si una lectura tarda mas de 5 s no se apilan pedidos encima.
    merge(timer(0, CADA_MS).pipe(filter(() => !this.pausado)), this.refrescar$)
      .pipe(
        exhaustMap(() =>
          this.service.listar().pipe(
            catchError((e) => {
              this.error = e.error?.detail ?? `No se pudo leer el estado de las colas (${e.status}).`;
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((colas) => {
        this.error = '';
        this.cargado = true;
        this.actualizado = new Date();
        const previas = new Map(this.filas.map((f) => [f.nombre, f.mensajes]));
        this.filas = colas
          .map((c) => ({
            ...c,
            dlq: c.nombre.endsWith('.dlq'),
            proposito: PROPOSITO[c.nombre.replace(/\.dlq$/, '')] ?? 'Cola creada desde la administración',
            delta: previas.has(c.nombre) ? c.mensajes - previas.get(c.nombre)! : 0,
          }))
          // Cada cola de trabajo seguida de su DLQ.
          .sort((a, b) => a.nombre.localeCompare(b.nombre));
      });
  }

  get totalTrabajo(): number {
    return this.filas.filter((f) => !f.dlq).reduce((n, f) => n + f.mensajes, 0);
  }

  get totalDlq(): number {
    return this.filas.filter((f) => f.dlq).reduce((n, f) => n + f.mensajes, 0);
  }

  get sinConsumidor(): number {
    return this.filas.filter((f) => !f.dlq && f.consumidores === 0).length;
  }

  /** Ancho de la barra relativo a la cola mas cargada (minimo visible si tiene algo). */
  porcentaje(c: Fila): number {
    const max = Math.max(1, ...this.filas.map((f) => f.mensajes));
    return c.mensajes === 0 ? 0 : Math.max(4, (c.mensajes / max) * 100);
  }

  porNombre(_i: number, c: Fila): string {
    return c.nombre;
  }
}
