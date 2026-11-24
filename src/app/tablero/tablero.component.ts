import { Component, DestroyRef, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Observable, interval } from 'rxjs';
import { catchError, finalize, switchMap } from 'rxjs/operators';
import { SessionService } from '../auth/session.service';
import { CatalogService, TipoTramite } from '../catalog/catalog.service';
import { CupoInfo, EstadoTramite, EstadoVisita, Franja, HORARIO_FRANJA, Paso, RequestsService, Tramite, Visita, textoVisita } from '../requests/requests.service';
import { ETIQUETA, ETIQUETA_VECINO, FLUJO, SIGUIENTE } from '../requests/estados';
import { MapaDireccionComponent } from '../requests/mapa-direccion.component';

/** Texto del boton que mueve la tarjeta a la columna siguiente. */
const VERBO: Partial<Record<EstadoTramite, string>> = {
  INGRESADO: 'Admitir',
  ADMITIDO: 'Tomar y gestionar',
  EN_GESTION: 'Enviar a terreno',
  EN_TERRENO: 'Resolver',
};

/** Que le llega al vecino con cada paso, segun lo que publica hoy TramiteEventRelay. */
const AVISO_VECINO: Partial<Record<EstadoTramite, string>> = {
  ADMITIDO: 'El vecino recibe el correo «Su solicitud fue aprobada».',
  EN_GESTION: 'Sin correo: el vecino ve «En proceso» en su seguimiento.',
  EN_TERRENO: 'El vecino recibe «Su visita quedó agendada» y la cuadrilla su ticket.',
  RESUELTO: 'El vecino recibe el certificado por correo.',
  RECHAZADO: 'El vecino verá el motivo en su seguimiento.',
};

/** Los cerrados (resueltos o rechazados) se muestran solo si cerraron en estos dias. */
const DIAS_CERRADOS = 7;

/** Como lo lee el funcionario (el vecino ve sus propios textos en la conversacion). */
const ESTADO_VISITA: Record<EstadoVisita, string> = {
  PROPUESTA: 'Esperando al vecino',
  CONFIRMADA: 'Confirmada',
  CAMBIO_PEDIDO: 'Pidió otro horario',
  LLAMAR: 'Pidió que lo llamen',
};

/** Sugerencias del campo cuadrilla (el backend acepta cualquier nombre de hasta 100 caracteres). */
const CUADRILLAS = ['Cuadrilla Norte', 'Cuadrilla Sur', 'Cuadrilla Áreas Verdes'];

/** Estados en los que se puede proponer o reprogramar la visita. */
const AGENDABLE: EstadoTramite[] = ['ADMITIDO', 'EN_GESTION', 'EN_TERRENO'];

const CORREO = /^\S+@\S+\.\S+$/;

/** "2026-11-26" de hoy en la hora del navegador (el backend valida en hora de Chile). */
function hoyIso(): string {
  const d = new Date();
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

interface FormVisita {
  fecha: string;
  franja: Franja;
  cuadrilla: string;
  nota: string;
}

interface Columna {
  estado: EstadoTramite;
  titulo: string;
  vecinoVe: string;
  tarjetas: Tramite[];
  ocultos: number;
}

@Component({
  selector: 'app-tablero',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MapaDireccionComponent],
  template: `
    <header class="page-head">
      <div>
        <p class="eyebrow">Gestión municipal</p>
        <h1>Tablero de trámites</h1>
        <p class="lead-sm">Una columna por estado. Mueve cada trámite al paso siguiente o tócalo para ver su recorrido y rechazarlo con un motivo.</p>
      </div>
    </header>

    <div class="tb-barra">
      <div class="tb-seg" role="group" aria-label="Qué trámites ver">
        <button type="button" [class.on]="!soloMios" [attr.aria-pressed]="!soloMios" (click)="soloMios = false">Todo el equipo</button>
        <button type="button" [class.on]="soloMios" [attr.aria-pressed]="soloMios" (click)="soloMios = true">Míos y sin tomar</button>
      </div>
      <label class="tb-check">
        <input type="checkbox" [(ngModel)]="verRechazados" name="verRechazados" />
        Ver rechazados ({{ contarCerrados('RECHAZADO') }})
      </label>
      <p class="tb-carga" *ngIf="carga.length">
        <span class="tb-carga-l">Abiertos por funcionario:</span>
        <span class="tb-persona" *ngFor="let c of carga">{{ c.nombre }} · {{ c.n }}</span>
      </p>
    </div>

    <p class="tb-ok" *ngIf="aviso" role="status">{{ aviso }}</p>
    <p class="aviso-error" *ngIf="error" role="alert">{{ error }}</p>

    <div class="load-error" *ngIf="errorCarga && !cargando">
      <p>{{ errorCarga }}</p>
      <button class="btn btn-outline btn-sm" type="button" (click)="cargar(true)">Reintentar</button>
    </div>
    <p class="muted" *ngIf="cargando">Cargando el tablero…</p>

    <div class="tb-scroll" *ngIf="!cargando && !errorCarga">
      <div class="tb-cols">
        <section *ngFor="let col of columnas; trackBy: porEstado" class="tb-col" [ngClass]="col.estado" [attr.aria-label]="col.titulo">
          <div class="tb-col-h">
            <div>
              <h2 class="tb-col-t">{{ col.titulo }}</h2>
              <p class="tb-col-v">El vecino ve «{{ col.vecinoVe }}»</p>
            </div>
            <span class="tb-n">{{ col.tarjetas.length }}</span>
          </div>

          <article class="tb-card" *ngFor="let t of col.tarjetas; trackBy: porId" [class.tb-card-on]="abierto?.id === t.id">
            <button type="button" class="tb-card-open" (click)="abrir(t)" [attr.data-id]="t.id"
                    [attr.aria-label]="'Abrir trámite ' + t.id + ', ' + nombreTipo(t.tipoId)">
              <span class="tb-card-n">N° {{ t.id }}</span>
              <span class="tb-card-t">{{ nombreTipo(t.tipoId) }}</span>
              <span class="tb-card-s">{{ usuario(t.vecinoUsername) }}<ng-container *ngIf="t.direccion"> · {{ t.direccion }}</ng-container></span>
            </button>
            <div class="tb-card-meta">
              <span class="tb-edad" [ngClass]="'tb-' + antiguedad(t).nivel">{{ antiguedad(t).texto }}</span>
              <span class="tb-quien" *ngIf="quien(t) as q" [title]="q">{{ usuario(q) }}</span>
            </div>
            <p class="tb-visita" *ngIf="visitaVigente(t) && t.visita as v" [ngClass]="'tb-v-' + v.estado">
              Visita {{ textoVisita(v) }} · {{ ESTADO_VISITA[v.estado] }}
            </p>
            <p class="tb-visita tb-v-CONFIRMADA" *ngIf="t.estado === 'EN_TERRENO' && t.enCaminoDesde">
              En camino desde las {{ t.enCaminoDesde | date: 'HH:mm' }}
            </p>
            <p class="tb-meson" *ngIf="t.creadoPor">Ingresado en mesón por {{ usuario(t.creadoPor) }}</p>
            <p class="tb-bloqueo" *ngIf="sinCupo(t)">Sin cupo hoy · se reinicia {{ reinicio(t) }}</p>
            <p class="tb-bloqueo" *ngIf="bloqueadoPorVisita(t)">Falta que el vecino confirme la visita</p>
            <button
              *ngIf="verbo(t) as v"
              type="button"
              class="btn btn-primary btn-sm tb-mover"
              [disabled]="actualizando.has(t.id) || sinCupo(t) || bloqueadoPorVisita(t)"
              (click)="mover(t)"
            >{{ actualizando.has(t.id) ? 'Guardando…' : v + ' →' }}</button>
          </article>

          <p class="tb-vacia" *ngIf="!col.tarjetas.length">Sin trámites</p>
          <p class="tb-ocultos" *ngIf="col.ocultos">y {{ col.ocultos }} cerrados hace más de {{ DIAS_CERRADOS }} días (ver en Trámites)</p>
        </section>
      </div>
    </div>

    <!-- Panel lateral NO modal: el tablero sigue usable detras (otra tarjeta cambia el panel). -->
    <ng-container *ngIf="abierto as t">
      <aside class="tb-drawer" role="region" [attr.aria-label]="'Detalle del trámite ' + t.id" (keydown.escape)="cerrar()">
        <div class="tb-d-top">
          <div>
            <p class="eyebrow">N° {{ t.id }} · {{ etiqueta(t.estado) }}</p>
            <h2 class="tb-d-t">{{ nombreTipo(t.tipoId) }}</h2>
          </div>
          <button #cerrarBtn type="button" class="btn btn-outline btn-sm" (click)="cerrar()" aria-label="Cerrar panel">✕</button>
        </div>
        <p class="tb-d-desc">{{ t.descripcion }}</p>
        <dl class="ficha">
          <div><dt>Vecino</dt><dd>{{ t.vecinoUsername }}</dd></div>
          <div *ngIf="t.direccion"><dt>Dirección</dt><dd>{{ t.direccion }}</dd></div>
          <div *ngIf="t.referencia"><dt>Referencias</dt><dd>{{ t.referencia }}</dd></div>
          <div><dt>Ingresado</dt><dd>{{ t.fechaIngreso | date: 'd MMM y, HH:mm' }}</dd></div>
          <div *ngIf="t.responsable !== undefined"><dt>Responsable</dt><dd>{{ t.responsable || 'Sin asignar' }}</dd></div>
          <div *ngIf="t.funcionarioAsignado"><dt>Último funcionario</dt><dd>{{ t.funcionarioAsignado }}</dd></div>
          <div *ngIf="t.creadoPor"><dt>Ingresado por</dt><dd>{{ t.creadoPor }} (a nombre del vecino)</dd></div>
        </dl>

        <!-- Reasignar: solo si el backend trae "responsable" y el tramite sigue abierto -->
        <div class="tb-bloque" *ngIf="t.responsable !== undefined && abiertoParaCambios(t)">
          <h3 class="tb-d-h">Responsable</h3>
          <div class="row-actions">
            <button type="button" class="btn btn-outline btn-sm" *ngIf="username && t.responsable !== username"
                    [disabled]="actualizando.has(t.id)" (click)="asignar(t, username)">Asignármelo</button>
          </div>
          <label class="tb-lbl" for="tb-resp">Reasignar a (correo)</label>
          <div class="tb-fila">
            <input id="tb-resp" class="tb-inp" type="email" [(ngModel)]="responsableNuevo" name="responsableNuevo"
                   placeholder="funcionario@duocuc.cl" autocomplete="off" />
            <button type="button" class="btn btn-outline btn-sm" [disabled]="actualizando.has(t.id) || !correoValido(responsableNuevo)"
                    (click)="asignar(t, responsableNuevo)">Reasignar</button>
          </div>
        </div>

        <!-- Visita: proponer o reprogramar; el vecino responde desde su conversacion -->
        <div class="tb-bloque" *ngIf="puedeAgendar(t)">
          <h3 class="tb-d-h">Visita</h3>
          <ng-container *ngIf="t.visita as v">
            <p class="tb-visita" [ngClass]="'tb-v-' + v.estado">
              {{ textoVisita(v) }} · {{ v.cuadrilla }} · <b>{{ ESTADO_VISITA[v.estado] }}</b>
            </p>
            <p class="hint" *ngIf="v.estado === 'CAMBIO_PEDIDO'">El vecino pidió: «{{ v.horarioPedido }}». Reprograma con ese horario.</p>
            <p class="hint" *ngIf="v.estado === 'LLAMAR'">El vecino pidió que lo llamen para acordar el día. Después reprograma con lo acordado.</p>
          </ng-container>
          <div class="tb-form">
            <div>
              <label class="tb-lbl" for="tb-fecha">Día</label>
              <input id="tb-fecha" class="tb-inp" type="date" [min]="hoy" [(ngModel)]="formVisita.fecha" name="fecha" />
            </div>
            <div>
              <span class="tb-lbl" id="tb-franja-l">Franja</span>
              <div class="tb-seg" role="group" aria-labelledby="tb-franja-l">
                <button type="button" *ngFor="let f of FRANJAS" [class.on]="formVisita.franja === f"
                        [attr.aria-pressed]="formVisita.franja === f" (click)="formVisita.franja = f">{{ HORARIO_FRANJA[f] }}</button>
              </div>
            </div>
            <div>
              <label class="tb-lbl" for="tb-cuadrilla">Cuadrilla</label>
              <input id="tb-cuadrilla" class="tb-inp" list="tb-cuadrillas" maxlength="100" [(ngModel)]="formVisita.cuadrilla" name="cuadrilla" />
              <datalist id="tb-cuadrillas"><option *ngFor="let c of CUADRILLAS" [value]="c"></option></datalist>
            </div>
            <div>
              <label class="tb-lbl" for="tb-vnota">Indicación para el vecino <span class="opcional">(opcional)</span></label>
              <input id="tb-vnota" class="tb-inp" maxlength="500" [(ngModel)]="formVisita.nota" name="vnota"
                     placeholder="Ej.: deje las ramas juntas en la vereda" />
            </div>
          </div>
          <p class="tb-bloqueo" *ngIf="formVisita.fecha && formVisita.fecha < hoy">La fecha ya pasó.</p>
          <div class="row-actions">
            <button type="button" class="btn btn-primary btn-sm" [disabled]="actualizando.has(t.id) || !visitaValida()" (click)="proponerVisita(t)">
              {{ t.visita ? 'Reprogramar visita' : 'Proponer visita' }}
            </button>
          </div>
          <p class="hint">El vecino la recibe por correo y en su conversación, con botones para confirmar o pedir otro horario.</p>
          <p class="hint" *ngIf="t.visita && t.estado === 'EN_TERRENO'">Reprogramar vuelve la visita a «Esperando al vecino» y borra el aviso «en camino».</p>
        </div>

        <!-- En camino: solo en terreno -->
        <div class="tb-bloque" *ngIf="t.estado === 'EN_TERRENO' && t.enCaminoDesde !== undefined">
          <h3 class="tb-d-h">Cuadrilla</h3>
          <p class="tb-visita tb-v-CONFIRMADA" *ngIf="t.enCaminoDesde">Avisado: en camino desde las {{ t.enCaminoDesde | date: 'HH:mm' }}.</p>
          <button type="button" class="btn btn-outline btn-sm" *ngIf="!t.enCaminoDesde" [disabled]="actualizando.has(t.id)"
                  (click)="avisarEnCamino(t)">Avisar al vecino: la cuadrilla va en camino</button>
        </div>
        <!-- Punto que marco el vecino, con link a Google Maps para la cuadrilla. -->
        <app-mapa-direccion *ngIf="t.lat != null && t.lng != null"
          [lat]="t.lat" [lng]="t.lng" [soloLectura]="true"></app-mapa-direccion>

        <div>
          <h3 class="tb-d-h">Recorrido</h3>
          <p class="muted" *ngIf="cargandoPasos">Cargando…</p>
          <p class="aviso-error" *ngIf="errorPasos">{{ errorPasos }}</p>
          <ol class="tb-rec" *ngIf="pasos && !cargandoPasos">
            <li *ngFor="let p of pasosVisibles(t)" [class.tb-rec-ok]="p.fechaCumplido">
              <b>{{ etiqueta(p.estado) }}</b>
              <span *ngIf="p.fechaCumplido">{{ p.fechaCumplido | date: 'd MMM, HH:mm' }}</span>
              <span *ngIf="!p.fechaCumplido && p.fechaEstimada">estimado {{ p.fechaEstimada | date: 'd MMM, HH:mm' }}</span>
              <span *ngIf="!p.fechaCumplido && !p.fechaEstimada">pendiente</span>
              <em *ngIf="p.nota">{{ p.nota }}</em>
            </li>
          </ol>
        </div>

        <ng-container *ngIf="abiertoParaCambios(t)">
          <label class="tb-lbl" for="tb-nota">Nota para el vecino <span class="opcional">(obligatoria para rechazar)</span></label>
          <textarea id="tb-nota" class="tb-txt" [(ngModel)]="nota" name="nota" maxlength="500"
                    placeholder="La verá en su seguimiento"></textarea>
          <div class="row-actions">
            <button *ngIf="verbo(t) as v" type="button" class="btn btn-primary btn-sm"
                    [disabled]="actualizando.has(t.id) || sinCupo(t) || bloqueadoPorVisita(t)" (click)="mover(t, nota)">{{ v }} →</button>
            <button *ngIf="!confirmandoRechazo" type="button" class="btn btn-danger btn-sm"
                    [disabled]="actualizando.has(t.id) || nota.trim().length < 5" (click)="confirmandoRechazo = true">Rechazar…</button>
            <ng-container *ngIf="confirmandoRechazo">
              <button type="button" class="btn btn-danger btn-sm" [disabled]="actualizando.has(t.id)" (click)="rechazar(t)">Sí, rechazar</button>
              <button type="button" class="btn btn-ghost btn-sm btn-cancelar" (click)="confirmandoRechazo = false">Cancelar</button>
            </ng-container>
          </div>
          <p class="hint" *ngIf="verbo(t)">{{ avisoVecino(t) }}</p>
          <p class="tb-bloqueo" *ngIf="bloqueadoPorVisita(t)">No se puede enviar a terreno hasta que el vecino confirme la visita.</p>
          <p class="hint" *ngIf="nota.trim().length < 5">Para rechazar, escribe el motivo (lo verá el vecino).</p>
        </ng-container>
        <p class="hint" *ngIf="!abiertoParaCambios(t)">Trámite cerrado: ya no tiene acciones.</p>

        <a class="btn-link" [routerLink]="'/audit'" [queryParams]="{ persona: t.vecinoUsername }">Ver historial del vecino →</a>
      </aside>
    </ng-container>
  `,
  styles: [`
    .tb-barra { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; margin-bottom: 16px; }
    .tb-seg { display: flex; gap: 4px; padding: 3px; border-radius: 12px; background: var(--paper-sunk); }
    .tb-seg button { min-height: 40px; padding: 4px 14px; border-radius: 9px; border: 0; background: transparent; font: inherit; font-weight: 700; color: var(--ink); cursor: pointer; }
    .tb-seg button.on { background: var(--teal-deep); color: #fff; }
    .tb-check { display: flex; align-items: center; gap: 8px; font-weight: 700; cursor: pointer; min-height: 40px; }
    .tb-check input { width: 18px; height: 18px; accent-color: var(--teal); }
    .tb-carga { margin: 0 0 0 auto; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 0.85rem; }
    .tb-carga-l { font-weight: 800; color: var(--ink-soft); }
    .tb-persona { padding: 2px 10px; border-radius: 999px; background: var(--paper-raised); border: 1px solid var(--line); font-weight: 700; }
    .tb-ok { margin: 0 0 14px; padding: 12px 16px; border-radius: 12px; background: var(--teal-deep); color: #fff; font-weight: 600; }
    .tb-scroll { overflow-x: auto; padding-bottom: 8px; scroll-snap-type: x proximity; }
    .tb-cols { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(240px, 1fr); gap: 12px; }
    .tb-col { scroll-snap-align: start; display: flex; flex-direction: column; gap: 10px; padding: 10px; border-radius: var(--radius); background: var(--paper-sunk); min-height: 420px; }
    .tb-col-h { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 2px 4px 8px; border-bottom: 3px solid var(--c, var(--teal)); }
    .tb-col-t { margin: 0; font-family: "Public Sans", sans-serif; font-size: 1rem; font-weight: 800; color: var(--ink); }
    .tb-col-v { margin: 0; font-size: 0.78rem; color: var(--ink-soft); }
    .tb-n { min-width: 28px; height: 28px; padding: 0 8px; box-sizing: border-box; border-radius: 14px; display: grid; place-items: center; background: var(--paper-raised); font-weight: 800; }
    .tb-card { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border-radius: 12px; background: var(--paper-raised); border: 1px solid var(--line); box-shadow: var(--shadow); }
    .tb-card-on { border-color: var(--teal); box-shadow: 0 0 0 2px var(--teal); }
    .tb-card-open { display: flex; flex-direction: column; gap: 2px; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; }
    .tb-card-n { font-family: "Fraunces", Georgia, serif; font-weight: 700; color: var(--teal-deep); }
    .tb-card-t { font-weight: 800; }
    .tb-card-s { font-size: 0.85rem; color: var(--ink-soft); overflow-wrap: anywhere; }
    .tb-card-meta { display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap; }
    .tb-edad { padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; font-weight: 800; }
    .tb-bien { background: rgba(27, 100, 87, 0.15); color: #0f5a4c; }
    .tb-alerta { background: rgba(242, 177, 52, 0.3); color: #6d4b02; }
    .tb-atrasado { background: rgba(208, 87, 58, 0.18); color: var(--terracotta-deep); }
    .tb-cerrado { background: rgba(20, 36, 38, 0.08); color: var(--ink-soft); }
    .tb-quien { font-size: 0.75rem; font-weight: 700; color: var(--ink-soft); }
    .tb-meson, .tb-bloqueo { margin: 0; font-size: 0.78rem; font-weight: 600; }
    .tb-meson { color: var(--ink-soft); }
    .tb-bloqueo { color: var(--terracotta-deep); }
    .tb-mover { width: 100%; min-height: 40px; }
    .tb-vacia { margin: 0; padding: 18px 8px; text-align: center; color: var(--ink-soft); border: 2px dashed var(--line-strong); border-radius: 12px; }
    .tb-ocultos { margin: 0; font-size: 0.78rem; color: var(--ink-soft); text-align: center; }
    .tb-drawer {
      position: fixed; top: 0; right: 0; bottom: 0; z-index: 45; width: 460px; max-width: 100%; box-sizing: border-box;
      overflow-y: auto; padding: 22px; display: flex; flex-direction: column; gap: 14px;
      background: var(--paper-raised); box-shadow: -20px 0 40px -20px rgba(0, 0, 0, 0.45);
    }
    .tb-d-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .tb-d-top .eyebrow { margin: 0; }
    .tb-d-t { margin: 2px 0 0; font-size: 1.5rem; }
    .tb-d-desc { margin: 0; line-height: 1.5; }
    .tb-d-h { margin: 0 0 8px; font-family: "Public Sans", sans-serif; font-size: 0.8rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-soft); }
    .tb-rec { list-style: none; margin: 0; padding: 0 0 0 14px; border-left: 3px solid var(--paper-sunk); display: flex; flex-direction: column; gap: 8px; font-size: 0.88rem; }
    .tb-rec li { display: flex; flex-wrap: wrap; gap: 4px 8px; color: var(--ink-soft); }
    .tb-rec li.tb-rec-ok { color: var(--ink); }
    .tb-rec em { flex-basis: 100%; font-style: normal; padding: 6px 10px; border-radius: 8px; background: var(--paper-sunk); color: var(--ink); }
    .tb-lbl { display: block; font-size: 0.74rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-soft); }
    .tb-txt { width: 100%; box-sizing: border-box; min-height: 70px; padding: 10px 12px; border-radius: 10px; border: 1.5px solid var(--line-strong); font: inherit; background: var(--paper); resize: vertical; }
    .tb-visita { margin: 0; padding: 4px 8px; border-radius: 8px; font-size: 0.78rem; font-weight: 700; }
    .tb-visita::first-letter { text-transform: uppercase; }
    .tb-v-PROPUESTA { background: rgba(242, 177, 52, 0.28); color: #6d4b02; }
    .tb-v-CONFIRMADA { background: rgba(27, 100, 87, 0.15); color: #0f5a4c; }
    .tb-v-CAMBIO_PEDIDO, .tb-v-LLAMAR { background: rgba(38, 101, 168, 0.14); color: #1d5288; }
    .tb-bloque { display: flex; flex-direction: column; gap: 8px; padding-top: 12px; border-top: 1px solid var(--line); }
    .tb-bloque .tb-d-h { margin: 0; }
    .tb-bloque .tb-visita { font-size: 0.88rem; }
    .tb-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
    .tb-form .tb-seg button { flex: 1; font-size: 0.82rem; }
    .tb-fila { display: flex; gap: 8px; }
    .tb-inp { width: 100%; box-sizing: border-box; min-height: 40px; padding: 8px 10px; border-radius: 10px; border: 1.5px solid var(--line-strong); font: inherit; background: var(--paper); }
    .tb-fila .tb-inp { flex: 1; min-width: 0; }
    @media (max-width: 600px) {
      .tb-carga { margin-left: 0; }
      .tb-cols { grid-auto-columns: 82%; }
    }
  `],
})
export class TableroComponent implements OnInit {
  readonly DIAS_CERRADOS = DIAS_CERRADOS;
  readonly ESTADO_VISITA = ESTADO_VISITA;
  readonly CUADRILLAS = CUADRILLAS;
  readonly FRANJAS: Franja[] = ['MANANA', 'TARDE'];
  readonly HORARIO_FRANJA = HORARIO_FRANJA;
  readonly textoVisita = textoVisita;
  formVisita: FormVisita = this.formVacio(null);
  responsableNuevo = '';
  tramites: Tramite[] = [];
  tipos: TipoTramite[] = [];
  cupos = new Map<number, CupoInfo>();
  cargando = true;
  errorCarga = '';
  error = '';
  aviso = '';
  username = '';
  soloMios = false;
  verRechazados = false;
  /** ids con un cambio de estado en curso (deshabilita sus botones). */
  actualizando = new Set<number>();

  abierto: Tramite | null = null;
  pasos: Paso[] | null = null;
  cargandoPasos = false;
  errorPasos = '';
  nota = '';
  confirmandoRechazo = false;

  @ViewChild('cerrarBtn') cerrarBtn?: ElementRef<HTMLButtonElement>;

  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor(
    private service: RequestsService,
    private catalog: CatalogService,
    private session: SessionService,
  ) {}

  ngOnInit(): void {
    this.session.estado$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((s) => {
      if (!s.cargando) this.username = s.username;
    });
    this.catalog.listar().subscribe({ next: (t) => (this.tipos = t) });
    this.cargarCupos();
    this.cargar(true);
    // ponytail: el mismo polling de 10 s de /requests (HTTP API Gateway no soporta WebSocket).
    interval(10_000)
      .pipe(
        switchMap(() => this.service.listar().pipe(catchError(() => EMPTY))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((data) => this.recibir(data));
  }

  cargar(conSpinner: boolean): void {
    if (conSpinner) this.cargando = true;
    this.errorCarga = '';
    this.service.listar()
      .pipe(finalize(() => (this.cargando = false)))
      .subscribe({
        next: (data) => this.recibir(data),
        error: (e) => (this.errorCarga = e.error?.detail ?? `No se pudieron cargar los trámites (${e.status}).`),
      });
  }

  /** Lista nueva del backend: el panel abierto se actualiza, o se cierra si el tramite ya no esta. */
  private recibir(data: Tramite[]): void {
    this.tramites = data;
    if (!this.abierto) return;
    const actual = data.find((t) => t.id === this.abierto!.id);
    if (!actual) {
      this.cerrar();
      return;
    }
    const cambio = actual.estado !== this.abierto.estado;
    this.abierto = actual;
    if (cambio) {
      // Otro funcionario lo movio mientras estaba abierto: se recarga y se descarta la confirmacion a medias.
      this.confirmandoRechazo = false;
      this.cargarPasos(actual);
    }
  }

  cargarCupos(): void {
    this.service.cupos().subscribe({
      next: (lista) => (this.cupos = new Map(lista.map((c) => [c.tipoId, c]))),
      // El cupo es informativo: si falla, el backend igual valida al admitir.
      error: () => this.cupos.clear(),
    });
  }

  get columnas(): Columna[] {
    const base = this.soloMios
      ? this.tramites.filter((t) => this.quien(t) === this.username || (t.estado === 'INGRESADO' && !this.quien(t)))
      : this.tramites;
    const estados: EstadoTramite[] = this.verRechazados ? [...FLUJO, 'RECHAZADO'] : FLUJO;
    const limite = Date.now() - DIAS_CERRADOS * 864e5;
    return estados.map((estado) => {
      const todas = base.filter((t) => t.estado === estado);
      const cerrada = estado === 'RESUELTO' || estado === 'RECHAZADO';
      const tarjetas = cerrada
        ? todas.filter((t) => Date.parse(t.fechaResolucion ?? t.fechaIngreso) >= limite)
            .sort((a, b) => (b.fechaResolucion ?? '').localeCompare(a.fechaResolucion ?? ''))
        : [...todas].sort((a, b) => a.fechaIngreso.localeCompare(b.fechaIngreso)); // el mas antiguo primero
      return { estado, titulo: ETIQUETA[estado], vecinoVe: ETIQUETA_VECINO[estado], tarjetas, ocultos: todas.length - tarjetas.length };
    });
  }

  /** Funcionarios con tramites abiertos: el responsable, o el ultimo que lo movio si no hay. */
  get carga(): { nombre: string; n: number }[] {
    const conteo = new Map<string, number>();
    for (const t of this.tramites) {
      const q = this.quien(t);
      if (!q || !SIGUIENTE[t.estado]) continue;
      const k = this.usuario(q);
      conteo.set(k, (conteo.get(k) ?? 0) + 1);
    }
    return [...conteo].map(([nombre, n]) => ({ nombre, n })).sort((a, b) => b.n - a.n).slice(0, 5);
  }

  contarCerrados(estado: EstadoTramite): number {
    return this.tramites.filter((t) => t.estado === estado).length;
  }

  porEstado(_i: number, c: Columna): string {
    return c.estado;
  }

  porId(_i: number, t: Tramite): number {
    return t.id;
  }

  etiqueta(e: EstadoTramite): string {
    return ETIQUETA[e];
  }

  verbo(t: Tramite): string | undefined {
    return VERBO[t.estado];
  }

  avisoVecino(t: Tramite): string {
    const sig = SIGUIENTE[t.estado];
    return sig ? AVISO_VECINO[sig] ?? '' : '';
  }

  abiertoParaCambios(t: Tramite): boolean {
    return !!SIGUIENTE[t.estado];
  }

  nombreTipo(tipoId: number): string {
    return this.cupos.get(tipoId)?.nombre ?? this.tipos.find((t) => t.id === tipoId)?.nombre ?? `Tipo #${tipoId}`;
  }

  usuario(email: string | null | undefined): string {
    return email ? email.split('@')[0] : '';
  }

  /** A cargo: el responsable explicito; si el backend no lo trae o esta vacio, el ultimo que lo movio. */
  quien(t: Tramite): string | null {
    return t.responsable || t.funcionarioAsignado;
  }

  get hoy(): string {
    return hoyIso();
  }

  correoValido(c: string): boolean {
    return CORREO.test(c.trim());
  }

  visitaVigente(t: Tramite): boolean {
    return !!t.visita && !!SIGUIENTE[t.estado];
  }

  /** undefined = backend sin visitas: el bloque no se muestra. */
  puedeAgendar(t: Tramite): boolean {
    return t.visita !== undefined && AGENDABLE.includes(t.estado);
  }

  /** La misma regla del backend: con visita, no se va a terreno sin confirmacion (sin visita se permite). */
  bloqueadoPorVisita(t: Tramite): boolean {
    return t.estado === 'EN_GESTION' && !!t.visita && t.visita.estado !== 'CONFIRMADA';
  }

  visitaValida(): boolean {
    const f = this.formVisita;
    return !!f.fecha && f.fecha >= this.hoy && !!f.cuadrilla.trim();
  }

  /** Parte de la visita actual (si sigue vigente) para reprogramar cambiando solo lo necesario. */
  private formVacio(v: Visita | null | undefined): FormVisita {
    const vigente = v && v.fecha >= hoyIso();
    return { fecha: vigente ? v!.fecha : '', franja: v?.franja ?? 'MANANA', cuadrilla: v?.cuadrilla ?? '', nota: '' };
  }

  proponerVisita(t: Tramite): void {
    if (!this.visitaValida() || this.actualizando.has(t.id)) return;
    const f = this.formVisita;
    this.accion(t, this.service.proponerVisita(t.id, f.fecha, f.franja, f.cuadrilla, f.nota), (real) => {
      this.formVisita = this.formVacio(real.visita);
      this.cargarPasos(real); // el backend replanifica el paso EN_TERRENO con la fecha de la visita
      return `Visita propuesta a ${this.usuario(real.vecinoUsername)}: ${real.visita ? textoVisita(real.visita) : ''}. La recibe por correo y en su conversación.`;
    });
  }

  asignar(t: Tramite, correo: string): void {
    if (!this.correoValido(correo) || this.actualizando.has(t.id)) return;
    this.accion(t, this.service.asignarResponsable(t.id, correo), (real) => {
      this.responsableNuevo = '';
      return `N° ${real.id} quedó a cargo de ${this.usuario(real.responsable)}.`;
    });
  }

  avisarEnCamino(t: Tramite): void {
    if (this.actualizando.has(t.id)) return;
    this.accion(t, this.service.avisarEnCamino(t.id), (real) => `Aviso enviado a ${this.usuario(real.vecinoUsername)}: la cuadrilla va en camino.`);
  }

  /** Visita, responsable y en camino devuelven el tramite completo: se reemplaza tal cual. */
  private accion(t: Tramite, peticion: Observable<Tramite>, exito: (real: Tramite) => string): void {
    this.actualizando.add(t.id);
    this.error = '';
    this.aviso = '';
    peticion.pipe(finalize(() => this.actualizando.delete(t.id))).subscribe({
      next: (real) => {
        this.tramites = this.tramites.map((x) => (x.id === real.id ? real : x));
        if (this.abierto?.id === real.id) this.abierto = real;
        this.aviso = exito(real);
      },
      // 409 (estado cambio o cerrado) / 400 (fecha pasada, correo invalido): el detalle del backend lo explica.
      error: (e) => {
        this.error = e.error?.detail ?? `No se pudo guardar (${e.status}).`;
        this.cargar(false);
      },
    });
  }

  /**
   * Cuanto lleva abierto. ponytail: umbrales fijos (admitir en 24 h, cerrar en 7 dias);
   * pasan a plazos por tipo en el catalogo cuando existan (caso de uso 4.10).
   */
  antiguedad(t: Tramite): { texto: string; nivel: string } {
    if (!SIGUIENTE[t.estado]) return { texto: 'Cerrado', nivel: 'cerrado' };
    const horas = Math.max(0, (Date.now() - Date.parse(t.fechaIngreso)) / 36e5);
    const texto = horas < 1 ? 'Hace menos de 1 h' : horas < 48 ? `Hace ${Math.floor(horas)} h` : `Hace ${Math.floor(horas / 24)} días`;
    const [alerta, atrasado] = t.estado === 'INGRESADO' ? [8, 24] : [72, 168];
    return { texto, nivel: horas >= atrasado ? 'atrasado' : horas >= alerta ? 'alerta' : 'bien' };
  }

  /** Solo admitir consume cupo. */
  sinCupo(t: Tramite): boolean {
    if (t.estado !== 'INGRESADO') return false;
    const c = this.cupos.get(t.tipoId);
    return !!c && c.disponible <= 0;
  }

  reinicio(t: Tramite): string {
    const c = this.cupos.get(t.tipoId);
    if (!c) return '';
    return 'a las ' + new Date(c.reinicia).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  mover(t: Tramite, nota?: string): void {
    const sig = SIGUIENTE[t.estado];
    if (!sig || this.actualizando.has(t.id) || this.sinCupo(t) || this.bloqueadoPorVisita(t)) return;
    this.cambiar(t, sig, nota);
  }

  rechazar(t: Tramite): void {
    if (this.nota.trim().length < 5) return;
    this.cambiar(t, 'RECHAZADO', this.nota);
  }

  private cambiar(t: Tramite, nuevo: EstadoTramite, nota?: string): void {
    this.actualizando.add(t.id);
    this.error = '';
    this.aviso = '';
    this.service.cambiarEstado(t.id, nuevo, nota)
      .pipe(finalize(() => this.actualizando.delete(t.id)))
      .subscribe({
        next: (real) => {
          this.tramites = this.tramites.map((x) => (x.id === real.id ? real : x));
          this.aviso = `N° ${t.id} pasó a ${ETIQUETA[nuevo]}. ${AVISO_VECINO[nuevo] ?? ''}`;
          if (nuevo === 'ADMITIDO') this.cargarCupos();
          if (this.abierto?.id === real.id) {
            this.abierto = real;
            this.nota = '';
            this.confirmandoRechazo = false;
            this.cargarPasos(real);
          }
        },
        error: (e) => {
          // Lo pudo mover otro funcionario (409) o el cupo se acabo entre medio: la verdad la trae el servidor.
          this.error = e.error?.detail ?? `No se pudo cambiar el estado (${e.status}).`;
          this.cargar(false);
          this.cargarCupos();
        },
      });
  }

  abrir(t: Tramite): void {
    this.abierto = t;
    this.nota = '';
    this.confirmandoRechazo = false;
    this.formVisita = this.formVacio(t.visita);
    this.responsableNuevo = '';
    this.cargarPasos(t);
    setTimeout(() => this.cerrarBtn?.nativeElement.focus());
  }

  cerrar(): void {
    const id = this.abierto?.id;
    this.abierto = null;
    this.pasos = null;
    this.confirmandoRechazo = false;
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus());
  }

  private cargarPasos(t: Tramite): void {
    this.cargandoPasos = true;
    this.errorPasos = '';
    this.service.seguimiento(t.id)
      .pipe(finalize(() => (this.cargandoPasos = false)))
      .subscribe({
        next: (p) => {
          if (this.abierto?.id === t.id) this.pasos = p;
        },
        error: (e) => (this.errorPasos = e.error?.detail ?? `No se pudo cargar el recorrido (${e.status}).`),
      });
  }

  /** En un rechazo no se listan los pasos que nunca alcanzo (igual que en /requests). */
  pasosVisibles(t: Tramite): Paso[] {
    const lista = this.pasos ?? [];
    return t.estado === 'RECHAZADO' ? lista.filter((p) => p.fechaCumplido || p.estado === 'RECHAZADO') : lista;
  }
}
