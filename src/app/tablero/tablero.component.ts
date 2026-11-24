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

/** Que le llega al vecino con cada paso, segun lo que publica TramiteEventRelay. */
const AVISO_VECINO: Partial<Record<EstadoTramite, string>> = {
  ADMITIDO: 'El vecino recibe el correo «Su solicitud fue aprobada».',
  EN_GESTION: 'Sin correo: el vecino ve «En proceso» en su seguimiento.',
  EN_TERRENO: 'El vecino recibe «Su visita quedó agendada» y la cuadrilla su ticket.',
  RESUELTO: 'El vecino recibe el certificado por correo.',
  RECHAZADO: 'El vecino recibe el motivo por correo.',
};

/** Los cerrados (resueltos o rechazados) se muestran solo si cerraron en estos dias. */
const DIAS_CERRADOS = 7;

/** Como lo lee el funcionario (el vecino ve sus propios textos). */
const ESTADO_VISITA: Record<EstadoVisita, string> = {
  PROPUESTA: 'Esperando al vecino',
  CONFIRMADA: 'Confirmada',
  CAMBIO_PEDIDO: 'Pidió otro horario',
  LLAMAR: 'Pidió que lo llamen',
};

/** Filas fijas del calendario; una cuadrilla con otro nombre aparece igual, en su propia fila. */
const CUADRILLAS = ['Cuadrilla Norte', 'Cuadrilla Sur', 'Cuadrilla Áreas Verdes'];

/** Hora en que termina cada franja: despues de eso, el bloque de hoy ya no se puede proponer. */
const FIN_FRANJA: Record<Franja, number> = { MANANA: 12, TARDE: 17 };
const FRANJAS: Franja[] = ['MANANA', 'TARDE'];

/** Estados en los que se puede proponer o reprogramar la visita. */
const AGENDABLE: EstadoTramite[] = ['ADMITIDO', 'EN_GESTION', 'EN_TERRENO'];

const CORREO = /^\S+@\S+\.\S+$/;

const dos = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;

/** "2026-11-26" de hoy en la hora del navegador (el backend valida en hora de Chile). */
function hoyIso(): string {
  return iso(new Date());
}

/** Lunes de la semana de `d` (a mediodia, para no correrse de dia con el horario de verano). */
function lunesDe(d: Date): Date {
  const l = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  l.setDate(l.getDate() - ((l.getDay() + 6) % 7));
  return l;
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

interface Dia {
  fecha: string;
  label: string;
  hoy: boolean;
}

interface Celda {
  fecha: string;
  franja: Franja;
  cuadrilla: string;
  visitas: Tramite[];
  /** Se puede proponer aqui ahora (modo "elegir"). */
  elegible: boolean;
  pasada: boolean;
}

interface Fila {
  cuadrilla: string;
  franja: Franja;
  celdas: Celda[];
}

@Component({
  selector: 'app-tablero',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MapaDireccionComponent],
  template: `
    <header class="page-head">
      <div>
        <p class="eyebrow">Gestión municipal</p>
        <h1>Tablero y agenda</h1>
        <p class="lead-sm">Arriba, cada trámite en su estado; abajo, las visitas de la semana por cuadrilla. Toca una tarjeta o una visita para abrir su ficha.</p>
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

    <div class="tb-layout" *ngIf="!cargando && !errorCarga">
      <div class="tb-main">
        <!-- KANBAN (B) -->
        <div class="tb-scroll">
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
                        [attr.aria-label]="'Abrir ficha del trámite ' + t.id + ', ' + nombreTipo(t.tipoId)">
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

        <!-- CALENDARIO (C) -->
        <section class="tb-cal" aria-label="Visitas de la semana por cuadrilla" *ngIf="hayVisitas">
          <div class="tb-cal-h">
            <h2 class="tb-cal-t">{{ tituloSemana }}</h2>
            <div class="row-actions">
              <button type="button" class="btn btn-outline btn-sm" (click)="moverSemana(-1)" aria-label="Semana anterior">←</button>
              <button type="button" class="btn btn-outline btn-sm" [disabled]="esEstaSemana" (click)="irAHoy()">Esta semana</button>
              <button type="button" class="btn btn-outline btn-sm" (click)="moverSemana(1)" aria-label="Semana siguiente">→</button>
            </div>
          </div>
          <p class="tb-banner" *ngIf="eligiendo as e" role="status">
            <span>Elige un bloque libre para N° {{ e.id }} · {{ usuario(e.vecinoUsername) }}.
              <ng-container *ngIf="e.visita?.horarioPedido"> El vecino pidió: «{{ e.visita?.horarioPedido }}».</ng-container>
            </span>
            <button type="button" class="btn btn-outline btn-sm" (click)="eligiendo = null">Cancelar</button>
          </p>
          <div class="tb-scroll">
            <div class="tb-grilla" role="table" [attr.aria-label]="tituloSemana">
              <div class="tb-g-row" role="row">
                <span class="tb-g-h" role="columnheader">Cuadrilla</span>
                <span *ngFor="let d of dias; trackBy: porFecha" class="tb-g-h" [class.tb-hoy]="d.hoy" role="columnheader">{{ d.label }}</span>
              </div>
              <!-- trackBy en todo: filas y celdas salen de getters y, sin el, cada ciclo rehace el DOM y se pierde el foco -->
              <div class="tb-g-row" role="row" *ngFor="let f of filas; trackBy: porFila">
                <span class="tb-g-l" role="rowheader">{{ f.cuadrilla }}<small>{{ HORARIO_FRANJA[f.franja] }}</small></span>
                <div class="tb-celda" role="cell" *ngFor="let c of f.celdas; trackBy: porFecha" [class.tb-pasada]="c.pasada" [class.tb-doble]="c.visitas.length > 1">
                  <button type="button" *ngFor="let v of c.visitas; trackBy: porId" class="tb-ev" [ngClass]="'tb-ev-' + claseVisita(v)"
                          [class.tb-ev-sel]="abierto?.id === v.id" (click)="abrir(v)"
                          [attr.aria-label]="'Abrir ficha del trámite ' + v.id">
                    <b>N° {{ v.id }}</b> {{ usuario(v.vecinoUsername) }}
                  </button>
                  <button type="button" *ngIf="c.elegible" class="tb-ev tb-ev-libre" (click)="proponerEn(c)"
                          [attr.aria-label]="'Proponer la visita aquí: ' + c.cuadrilla + ', ' + c.fecha + ', ' + HORARIO_FRANJA[c.franja]">
                    Proponer aquí
                  </button>
                  <span class="tb-doble-t" *ngIf="c.visitas.length > 1">{{ c.visitas.length }} visitas en el mismo bloque</span>
                </div>
              </div>
            </div>
          </div>
          <p class="hint" *ngIf="fueraDeGrilla">{{ fueraDeGrilla }} visita(s) de esta semana caen en domingo y no se muestran en la grilla.</p>
        </section>
      </div>

      <!-- FICHA (A): acoplada a la derecha; en pantallas angostas, panel superpuesto -->
      <aside class="tb-ficha" *ngIf="abierto as t" role="region" [class.tb-ficha-eligiendo]="!!eligiendo"
             [attr.aria-label]="'Ficha del trámite ' + t.id" (keydown.escape)="cerrar()">
        <div class="tb-d-top">
          <div>
            <p class="eyebrow">N° {{ t.id }} · ingresado {{ t.fechaIngreso | date: 'd MMM, HH:mm' }}</p>
            <h2 class="tb-d-t">{{ nombreTipo(t.tipoId) }}</h2>
          </div>
          <button #cerrarBtn type="button" class="btn btn-outline btn-sm" (click)="cerrar()" aria-label="Cerrar ficha">✕</button>
        </div>
        <div class="row-actions">
          <span class="badge" [ngClass]="t.estado">{{ etiqueta(t.estado) }}</span>
          <span class="tb-ve">El vecino ve: «{{ etiquetaVecino(t.estado) }}»</span>
        </div>
        <ol class="tb-steps" aria-label="Recorrido">
          <li *ngFor="let s of steps(t)" [ngClass]="s.cls"><span class="tb-stp-bar"></span><span class="tb-stp-l">{{ s.label }}</span></li>
        </ol>
        <p class="tb-d-desc">{{ t.descripcion }}</p>
        <dl class="ficha">
          <div><dt>Vecino</dt><dd>{{ t.vecinoUsername }}</dd></div>
          <div *ngIf="t.direccion"><dt>Dirección</dt><dd>{{ t.direccion }}</dd></div>
          <div *ngIf="t.referencia"><dt>Referencias</dt><dd>{{ t.referencia }}</dd></div>
          <div *ngIf="t.responsable !== undefined"><dt>Responsable</dt><dd>{{ t.responsable || 'Sin asignar' }}</dd></div>
          <div *ngIf="t.funcionarioAsignado"><dt>Último funcionario</dt><dd>{{ t.funcionarioAsignado }}</dd></div>
          <div *ngIf="t.creadoPor"><dt>Ingresado por</dt><dd>{{ t.creadoPor }} (a nombre del vecino)</dd></div>
          <div *ngIf="t.contactos?.length"><dt>Copia a</dt><dd>{{ nombresContactos(t) }}</dd></div>
        </dl>

        <!-- PROXIMA ACCION segun el estado -->
        <div class="tb-accion" *ngIf="abiertoParaCambios(t); else cerrado">
          <h3 class="tb-acc-t">{{ tituloAccion(t) }}</h3>

          <ng-container *ngIf="t.estado === 'INGRESADO'">
            <p class="tb-req" *ngIf="requisitos(t) as r"><b>Requisitos del catálogo:</b> {{ r }}</p>
            <p class="tb-cupo" [class.tb-cupo-no]="sinCupo(t)" *ngIf="cupoTexto(t) as c">{{ c }}</p>
          </ng-container>

          <!-- Visita: el estado y lo que se puede hacer con ella -->
          <ng-container *ngIf="puedeAgendar(t)">
            <ng-container *ngIf="t.visita as v; else sinVisita">
              <p class="tb-visita tb-visita-g" [ngClass]="'tb-v-' + v.estado">
                {{ textoVisita(v) }} · {{ v.cuadrilla }} · <b>{{ ESTADO_VISITA[v.estado] }}</b>
              </p>
              <p class="hint" *ngIf="v.codigo">Código de seguridad: <b>{{ v.codigo }}</b> (va en el correo del vecino y en el ticket de la cuadrilla).</p>
              <p class="hint" *ngIf="v.estado === 'CAMBIO_PEDIDO'">El vecino pidió: «{{ v.horarioPedido }}». Elige ese horario en el calendario.</p>
              <p class="hint" *ngIf="v.estado === 'LLAMAR'">El vecino pidió que lo llamen. Acuerda el día por teléfono y confírmalo aquí.</p>
              <p class="tb-bloqueo" *ngIf="vencida(t)">La fecha propuesta ya pasó y el vecino no confirmó: reprograma.</p>
              <div class="row-actions">
                <button type="button" class="btn btn-primary btn-sm" *ngIf="puedeConfirmarTelefono(t)" [disabled]="actualizando.has(t.id)"
                        (click)="confirmarTelefono(t)">Confirmé por teléfono</button>
                <button type="button" class="btn btn-outline btn-sm" [disabled]="actualizando.has(t.id)" (click)="elegir(t)">
                  {{ eligiendo?.id === t.id ? 'Elige abajo en el calendario…' : 'Reprogramar en el calendario' }}
                </button>
              </div>
              <p class="hint" *ngIf="t.estado === 'EN_TERRENO'">Reprogramar vuelve la visita a «Esperando al vecino» y borra el aviso «en camino».</p>
            </ng-container>
            <ng-template #sinVisita>
              <p class="hint">Todavía no tiene visita. Elige un bloque libre en el calendario: el vecino la recibe por correo y en su seguimiento.</p>
              <div class="row-actions">
                <button type="button" class="btn btn-primary btn-sm" [disabled]="actualizando.has(t.id)" (click)="elegir(t)">
                  {{ eligiendo?.id === t.id ? 'Elige abajo en el calendario…' : 'Elegir en el calendario' }}
                </button>
              </div>
            </ng-template>
            <details class="tb-manual">
              <summary>Escribir la fecha a mano</summary>
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
              </div>
              <p class="tb-bloqueo" *ngIf="problemaForm() as p">{{ p }}</p>
              <button type="button" class="btn btn-primary btn-sm" [disabled]="actualizando.has(t.id) || !!problemaForm() || !formVisita.fecha"
                      (click)="proponerVisita(t)">{{ t.visita ? 'Reprogramar visita' : 'Proponer visita' }}</button>
            </details>
            <label class="tb-lbl" for="tb-vnota">Indicación para el vecino en la visita <span class="opcional">(opcional)</span></label>
            <input id="tb-vnota" class="tb-inp" maxlength="500" [(ngModel)]="formVisita.nota" name="vnota" placeholder="Ej.: deje las ramas juntas en la vereda" />
          </ng-container>

          <ng-container *ngIf="t.estado === 'EN_TERRENO' && t.enCaminoDesde !== undefined">
            <p class="tb-visita tb-v-CONFIRMADA tb-visita-g" *ngIf="t.enCaminoDesde">Avisado: en camino desde las {{ t.enCaminoDesde | date: 'HH:mm' }}.</p>
            <button type="button" class="btn btn-outline btn-sm" *ngIf="!t.enCaminoDesde" [disabled]="actualizando.has(t.id)"
                    (click)="avisarEnCamino(t)">Avisar al vecino: la cuadrilla va en camino</button>
          </ng-container>

          <label class="tb-lbl" for="tb-nota">Nota para el vecino <span class="opcional">(obligatoria para rechazar)</span></label>
          <textarea id="tb-nota" class="tb-txt" [(ngModel)]="nota" name="nota" maxlength="500" placeholder="La verá en su seguimiento"></textarea>
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
        </div>
        <ng-template #cerrado><p class="tb-accion tb-cerrado-msg">Trámite {{ t.estado === 'RESUELTO' ? 'resuelto' : 'rechazado' }}: ya no tiene acciones.</p></ng-template>

        <!-- ADMIN B: borrado logico desde la ficha (solo Admin, solo con el backend que trae visibleVecino) -->
        <div class="tb-bloque" *ngIf="esAdmin && t.visibleVecino !== undefined">
          <h3 class="tb-d-h">Administración</h3>
          <p class="tb-visita tb-visita-g" [ngClass]="t.visibleVecino ? 'tb-v-CONFIRMADA' : 'tb-v-PROPUESTA'">
            {{ t.visibleVecino ? 'El vecino lo ve' : 'Oculto al vecino' }}<ng-container *ngIf="!t.visibleVecino && t.motivoVisibilidad">: {{ t.motivoVisibilidad }}</ng-container>
          </p>
          <label class="tb-lbl" for="tb-motivo-adm">Motivo (obligatorio, queda en la auditoría)</label>
          <input id="tb-motivo-adm" class="tb-inp" maxlength="200" [(ngModel)]="motivoAdmin" name="motivoAdmin" placeholder="Ej.: duplicado del N° 1050" />
          <div class="row-actions">
            <button type="button" class="btn btn-outline btn-sm" [disabled]="actualizando.has(t.id) || motivoAdmin.trim().length < 3"
                    (click)="cambiarVisibilidad(t)">{{ t.visibleVecino ? 'Ocultar al vecino' : 'Mostrar al vecino' }}</button>
            <button type="button" *ngIf="!confirmandoPapelera" class="btn btn-danger btn-sm" [disabled]="actualizando.has(t.id) || motivoAdmin.trim().length < 3"
                    (click)="confirmandoPapelera = true">Enviar a la papelera…</button>
            <ng-container *ngIf="confirmandoPapelera">
              <button type="button" class="btn btn-danger btn-sm" [disabled]="actualizando.has(t.id)" (click)="enviarAPapelera(t)">Sí, a la papelera</button>
              <button type="button" class="btn btn-ghost btn-sm btn-cancelar" (click)="confirmandoPapelera = false">Cancelar</button>
            </ng-container>
          </div>
          <p class="hint">
            {{ t.visibleVecino ? 'Ocultar: el vecino deja de verlo y de recibir sus correos; el equipo lo sigue gestionando.' : 'Mostrar: el vecino lo vuelve a ver con todo su recorrido.' }}
            La papelera lo saca de todas las listas (no devuelve el cupo); se restaura en «Reglas y papelera».
          </p>
        </div>

        <!-- Responsable -->
        <div class="tb-bloque" *ngIf="t.responsable !== undefined && abiertoParaCambios(t)">
          <h3 class="tb-d-h">Responsable</h3>
          <button type="button" class="btn btn-outline btn-sm" *ngIf="username && t.responsable !== username"
                  [disabled]="actualizando.has(t.id)" (click)="asignar(t, username)">Asignármelo</button>
          <label class="tb-lbl" for="tb-resp">Reasignar a (correo)</label>
          <div class="tb-fila">
            <input id="tb-resp" class="tb-inp" type="email" [(ngModel)]="responsableNuevo" name="responsableNuevo"
                   placeholder="funcionario@duocuc.cl" autocomplete="off" />
            <button type="button" class="btn btn-outline btn-sm"
                    [disabled]="actualizando.has(t.id) || !correoValido(responsableNuevo) || responsableNuevo.trim() === t.responsable"
                    (click)="asignar(t, responsableNuevo)">Reasignar</button>
          </div>
        </div>

        <!-- Punto que marco el vecino, con link a Google Maps para la cuadrilla. -->
        <app-mapa-direccion *ngIf="t.lat != null && t.lng != null" [lat]="t.lat" [lng]="t.lng" [soloLectura]="true"></app-mapa-direccion>

        <div class="tb-bloque">
          <h3 class="tb-d-h">Historial</h3>
          <p class="muted" *ngIf="cargandoPasos">Cargando…</p>
          <div class="load-error" *ngIf="errorPasos && !cargandoPasos">
            <p>{{ errorPasos }}</p>
            <button class="btn btn-outline btn-sm" type="button" (click)="cargarPasos(t)">Reintentar</button>
          </div>
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
        <a class="btn-link" [routerLink]="'/audit'" [queryParams]="{ persona: t.vecinoUsername }">Ver historial del vecino →</a>
      </aside>
    </div>
  `,
  styles: [`
    /* Kanban + calendario + ficha no caben en los 1080 px de <main>: el tablero se abre hasta 1400 px,
       centrado (margen negativo y no transform, que romperia el position: fixed de la ficha). */
    :host { display: block; width: min(1400px, calc(100vw - 60px)); margin-left: calc((100% - min(1400px, calc(100vw - 60px))) / 2); }
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
    .tb-layout { display: flex; gap: 16px; align-items: flex-start; }
    .tb-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 16px; }
    .tb-scroll { overflow-x: auto; padding-bottom: 8px; }
    .tb-cols { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(220px, 1fr); gap: 12px; }
    .tb-col { display: flex; flex-direction: column; gap: 10px; padding: 10px; border-radius: var(--radius); background: var(--paper-sunk); min-height: 260px; }
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
    .tb-visita { margin: 0; padding: 4px 8px; border-radius: 8px; font-size: 0.78rem; font-weight: 700; }
    .tb-visita::first-letter { text-transform: uppercase; }
    .tb-visita-g { font-size: 0.88rem; }
    .tb-v-PROPUESTA { background: rgba(242, 177, 52, 0.28); color: #6d4b02; }
    .tb-v-CONFIRMADA { background: rgba(27, 100, 87, 0.15); color: #0f5a4c; }
    .tb-v-CAMBIO_PEDIDO, .tb-v-LLAMAR { background: rgba(38, 101, 168, 0.14); color: #1d5288; }
    .tb-cal { background: var(--paper-raised); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px; box-shadow: var(--shadow); }
    .tb-cal-h { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    .tb-cal-t { margin: 0; font-size: 1.1rem; }
    .tb-banner { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin: 0 0 8px; padding: 9px 12px; border-radius: 10px; background: rgba(242, 177, 52, 0.28); color: #6d4b02; font-weight: 700; }
    .tb-grilla { min-width: 820px; display: flex; flex-direction: column; gap: 5px; }
    .tb-g-row { display: grid; grid-template-columns: 140px repeat(6, minmax(100px, 1fr)); gap: 5px; }
    .tb-g-h { font-size: 0.72rem; font-weight: 800; color: var(--ink-soft); padding: 2px 4px; text-transform: uppercase; letter-spacing: 0.05em; }
    .tb-hoy { color: var(--terracotta-deep); }
    .tb-g-l { display: flex; flex-direction: column; justify-content: center; padding: 2px 4px; font-weight: 800; font-size: 0.8rem; }
    .tb-g-l small { font-weight: 600; color: var(--ink-soft); font-size: 0.72rem; }
    .tb-celda { min-height: 44px; border-radius: 9px; padding: 4px; display: flex; flex-direction: column; gap: 3px; border: 1.5px dashed var(--line); background: #fff; }
    .tb-pasada { background: var(--paper-sunk); }
    .tb-doble { border: 2px solid var(--terracotta); }
    .tb-doble-t { font-size: 0.68rem; font-weight: 800; color: var(--terracotta-deep); }
    .tb-ev { min-height: 32px; padding: 3px 6px; border-radius: 7px; border: 1.5px solid transparent; font: inherit; font-size: 0.75rem; text-align: left; cursor: pointer; overflow-wrap: anywhere; }
    .tb-ev-PROPUESTA { background: rgba(242, 177, 52, 0.3); color: #6d4b02; }
    .tb-ev-CONFIRMADA { background: rgba(27, 100, 87, 0.17); color: #0f5a4c; }
    .tb-ev-CAMBIO_PEDIDO, .tb-ev-LLAMAR { background: rgba(38, 101, 168, 0.15); color: #1d5288; }
    .tb-ev-TERRENO { background: rgba(106, 73, 158, 0.16); color: #543a80; }
    .tb-ev-HECHO { background: rgba(20, 36, 38, 0.08); color: var(--ink-soft); }
    .tb-ev-sel { border-color: var(--teal-deep); box-shadow: 0 0 0 2px var(--teal-deep); }
    .tb-ev-libre { background: #fff; border: 2px solid var(--teal); color: var(--teal-deep); font-weight: 800; text-align: center; }
    .tb-ficha {
      flex: 0 0 420px; max-width: 420px; box-sizing: border-box; position: sticky; top: 84px; max-height: calc(100vh - 100px); overflow-y: auto;
      padding: 18px; display: flex; flex-direction: column; gap: 12px; border-radius: var(--radius);
      background: var(--paper-raised); border: 1px solid var(--line); box-shadow: var(--shadow-lift);
    }
    @media (max-width: 1100px) {
      .tb-ficha { position: fixed; top: 0; right: 0; bottom: 0; z-index: 45; width: min(460px, 100%); max-width: 100%; max-height: none; border-radius: 0; }
      /* Superpuesta taparia el calendario mientras se elige un bloque: se esconde hasta elegir o cancelar. */
      .tb-ficha-eligiendo { display: none; }
    }
    .tb-d-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .tb-d-top .eyebrow { margin: 0; }
    .tb-d-t { margin: 2px 0 0; font-size: 1.45rem; }
    .tb-ve { display: inline-flex; padding: 3px 9px; border-radius: 999px; background: var(--paper); border: 1px dashed var(--line-strong); font-size: 0.75rem; font-weight: 700; color: var(--ink-soft); }
    .tb-steps { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 5px; list-style: none; margin: 0; padding: 0; }
    .tb-steps li { display: flex; flex-direction: column; gap: 4px; }
    .tb-stp-bar { height: 7px; border-radius: 4px; background: var(--paper-sunk); }
    .tb-steps .hecho .tb-stp-bar { background: var(--teal); }
    .tb-steps .actual .tb-stp-bar { background: var(--signal); box-shadow: inset 0 0 0 2px var(--teal-deep); }
    .tb-steps .rechazado .tb-stp-bar { background: var(--terracotta); }
    .tb-stp-l { font-size: 0.7rem; font-weight: 800; color: var(--ink-soft); overflow-wrap: anywhere; }
    .tb-d-desc { margin: 0; line-height: 1.5; }
    .tb-accion { margin: 0; border: 2px solid var(--teal); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 9px; background: rgba(27, 100, 87, 0.04); }
    .tb-cerrado-msg { border-color: var(--line-strong); background: var(--paper); font-weight: 700; }
    .tb-acc-t { margin: 0; font-size: 1.1rem; }
    .tb-req { margin: 0; font-size: 0.85rem; }
    .tb-cupo { margin: 0; padding: 7px 10px; border-radius: 9px; background: rgba(27, 100, 87, 0.12); color: #0f5a4c; font-weight: 700; font-size: 0.85rem; }
    .tb-cupo-no { background: rgba(208, 87, 58, 0.15); color: var(--terracotta-deep); }
    .tb-manual summary { cursor: pointer; font-weight: 700; font-size: 0.85rem; color: var(--teal-deep); min-height: 32px; display: flex; align-items: center; }
    .tb-manual[open] { display: flex; flex-direction: column; gap: 8px; }
    .tb-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
    .tb-form .tb-seg button { flex: 1; font-size: 0.8rem; }
    .tb-bloque { display: flex; flex-direction: column; gap: 8px; padding-top: 12px; border-top: 1px solid var(--line); }
    .tb-d-h { margin: 0; font-family: "Public Sans", sans-serif; font-size: 0.8rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-soft); }
    .tb-rec { list-style: none; margin: 0; padding: 0 0 0 14px; border-left: 3px solid var(--paper-sunk); display: flex; flex-direction: column; gap: 8px; font-size: 0.88rem; }
    .tb-rec li { display: flex; flex-wrap: wrap; gap: 4px 8px; color: var(--ink-soft); }
    .tb-rec li.tb-rec-ok { color: var(--ink); }
    .tb-rec em { flex-basis: 100%; font-style: normal; padding: 6px 10px; border-radius: 8px; background: var(--paper-sunk); color: var(--ink); }
    .tb-lbl { display: block; font-size: 0.74rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-soft); }
    .tb-txt { width: 100%; box-sizing: border-box; min-height: 64px; padding: 10px 12px; border-radius: 10px; border: 1.5px solid var(--line-strong); font: inherit; background: var(--paper); resize: vertical; }
    .tb-inp { width: 100%; box-sizing: border-box; min-height: 40px; padding: 8px 10px; border-radius: 10px; border: 1.5px solid var(--line-strong); font: inherit; background: var(--paper); }
    .tb-fila { display: flex; gap: 8px; }
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
  readonly FRANJAS = FRANJAS;
  readonly HORARIO_FRANJA = HORARIO_FRANJA;
  readonly textoVisita = textoVisita;

  tramites: Tramite[] = [];
  tipos: TipoTramite[] = [];
  cupos = new Map<number, CupoInfo>();
  cargando = true;
  errorCarga = '';
  error = '';
  aviso = '';
  username = '';
  esAdmin = false;
  motivoAdmin = '';
  confirmandoPapelera = false;
  soloMios = false;
  verRechazados = false;
  /** ids con una accion en curso (deshabilita sus botones). */
  actualizando = new Set<number>();

  abierto: Tramite | null = null;
  pasos: Paso[] | null = null;
  cargandoPasos = false;
  errorPasos = '';
  nota = '';
  confirmandoRechazo = false;
  formVisita: FormVisita = this.formVacio(null);
  responsableNuevo = '';

  /** Lunes de la semana que muestra el calendario. */
  semana = lunesDe(new Date());
  /** Tramite para el que se esta eligiendo un bloque en el calendario. */
  eligiendo: Tramite | null = null;

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
      if (s.cargando) return;
      this.username = s.username;
      this.esAdmin = s.roles.includes('Admin');
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

  /** Lista nueva del backend: la ficha abierta se actualiza, o se cierra si el tramite ya no esta. */
  private recibir(data: Tramite[]): void {
    this.tramites = data;
    if (this.eligiendo) {
      const e = data.find((t) => t.id === this.eligiendo!.id);
      // Si lo cerraron o lo sacaron de un estado agendable, ya no se elige bloque para el.
      this.eligiendo = e && AGENDABLE.includes(e.estado) ? e : null;
    }
    if (!this.abierto) return;
    const actual = data.find((t) => t.id === this.abierto!.id);
    if (!actual) {
      this.cerrar();
      return;
    }
    const cambio = actual.estado !== this.abierto.estado || actual.visita?.actualizadoEn !== this.abierto.visita?.actualizadoEn;
    this.abierto = actual;
    if (cambio) {
      // Otro funcionario lo movio (o el vecino respondio) mientras estaba abierto.
      this.confirmandoRechazo = false;
      this.confirmandoPapelera = false;
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

  // ---------- kanban ----------

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

  porFecha(_i: number, x: { fecha: string }): string {
    return x.fecha;
  }

  porFila(_i: number, f: Fila): string {
    return f.cuadrilla + f.franja;
  }

  etiqueta(e: EstadoTramite): string {
    return ETIQUETA[e];
  }

  etiquetaVecino(e: EstadoTramite): string {
    return ETIQUETA_VECINO[e];
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

  requisitos(t: Tramite): string | null {
    const r = this.tipos.find((x) => x.id === t.tipoId)?.requisitos;
    return r?.trim() ? r : null;
  }

  usuario(email: string | null | undefined): string {
    return email ? email.split('@')[0] : '';
  }

  nombresContactos(t: Tramite): string {
    return (t.contactos ?? []).map((c) => c.nombre).join(', ');
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

  cupoTexto(t: Tramite): string | null {
    const c = this.cupos.get(t.tipoId);
    if (!c) return null;
    return c.disponible > 0 ? `Quedan ${c.disponible} de ${c.cupoDiario} cupos hoy para este tipo.` : `Sin cupo hoy (${c.cupoDiario}/día). Se reinicia ${this.reinicio(t)}.`;
  }

  reinicio(t: Tramite): string {
    const c = this.cupos.get(t.tipoId);
    if (!c) return '';
    return 'a las ' + new Date(c.reinicia).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  // ---------- visita ----------

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

  /** Propuesta cuya fecha ya paso sin respuesta: hay que reprogramar. */
  vencida(t: Tramite): boolean {
    return !!t.visita && t.visita.estado !== 'CONFIRMADA' && t.visita.fecha < hoyIso();
  }

  /** Llega con el backend que trae `codigo` (5.1 y 5.2 del contrato van juntos). */
  puedeConfirmarTelefono(t: Tramite): boolean {
    return !!t.visita && t.visita.codigo !== undefined && t.visita.estado !== 'CONFIRMADA' && !this.vencida(t) && this.abiertoParaCambios(t);
  }

  tituloAccion(t: Tramite): string {
    switch (t.estado) {
      case 'INGRESADO': return 'Revisar requisitos y admitir';
      case 'ADMITIDO': return 'Tomar el trámite y coordinar la visita';
      case 'EN_GESTION': return t.visita?.estado === 'CONFIRMADA' ? 'Visita confirmada: enviar a terreno' : 'Coordinar la visita con el vecino';
      case 'EN_TERRENO': return 'En terreno';
      default: return '';
    }
  }

  /** Bloque del calendario o fecha a mano: lo que impide proponer, o null. */
  problemaForm(): string | null {
    const f = this.formVisita;
    if (f.fecha && f.fecha < this.hoy) return 'La fecha ya pasó.';
    if (f.fecha && this.franjaTerminada(f.fecha, f.franja)) return 'Esa franja de hoy ya terminó.';
    if (f.fecha && !f.cuadrilla.trim()) return 'Falta la cuadrilla.';
    return null;
  }

  private franjaTerminada(fecha: string, franja: Franja): boolean {
    return fecha === hoyIso() && new Date().getHours() >= FIN_FRANJA[franja];
  }

  /** Parte de la visita actual (si sigue vigente) para reprogramar cambiando solo lo necesario. */
  private formVacio(v: Visita | null | undefined): FormVisita {
    const vigente = v && v.fecha >= hoyIso();
    return { fecha: vigente ? v!.fecha : '', franja: v?.franja ?? 'MANANA', cuadrilla: v?.cuadrilla ?? '', nota: '' };
  }

  elegir(t: Tramite): void {
    this.eligiendo = t;
    const v = t.visita;
    // Si la visita esta en otra semana, el calendario salta a ella para que se vea lo que se reprograma.
    if (v && v.fecha >= hoyIso()) this.semana = lunesDe(new Date(v.fecha + 'T12:00:00'));
    setTimeout(() => this.host.nativeElement.querySelector('.tb-cal')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  proponerEn(c: Celda): void {
    const t = this.eligiendo;
    if (!t) return;
    this.formVisita = { ...this.formVisita, fecha: c.fecha, franja: c.franja, cuadrilla: c.cuadrilla };
    this.proponerVisita(t);
  }

  proponerVisita(t: Tramite): void {
    if (this.problemaForm() || !this.formVisita.fecha || this.actualizando.has(t.id)) return;
    const f = this.formVisita;
    this.accion(t, this.service.proponerVisita(t.id, f.fecha, f.franja, f.cuadrilla, f.nota), (real) => {
      this.eligiendo = null;
      this.formVisita = this.formVacio(real.visita);
      this.cargarPasos(real); // el backend replanifica el paso EN_TERRENO con la fecha de la visita
      return `Visita propuesta a ${this.usuario(real.vecinoUsername)}: ${real.visita ? textoVisita(real.visita) : ''}. La recibe por correo y en su seguimiento.`;
    });
  }

  confirmarTelefono(t: Tramite): void {
    if (!this.puedeConfirmarTelefono(t) || this.actualizando.has(t.id)) return;
    this.accion(t, this.service.confirmarVisita(t.id, this.formVisita.nota), (real) =>
      `Visita de N° ${real.id} confirmada por teléfono. Queda en la auditoría y ${this.usuario(real.vecinoUsername)} recibe un correo con el resumen.`);
  }

  asignar(t: Tramite, correo: string): void {
    if (!this.correoValido(correo) || this.actualizando.has(t.id)) return;
    this.accion(t, this.service.asignarResponsable(t.id, correo), (real) => {
      this.responsableNuevo = '';
      return `N° ${real.id} quedó a cargo de ${this.usuario(real.responsable)}.`;
    });
  }

  /** Admin B: ocultar o volver a mostrar al vecino. */
  cambiarVisibilidad(t: Tramite): void {
    const motivo = this.motivoAdmin.trim();
    if (motivo.length < 3 || this.actualizando.has(t.id)) return;
    const visible = !t.visibleVecino;
    this.accion(t, this.service.cambiarVisibilidad(t.id, visible, motivo), (real) => {
      this.motivoAdmin = '';
      return `N° ${real.id} ${visible ? 'vuelve a ser visible para' : 'quedó oculto al'} vecino. Quedó en la auditoría con el motivo.`;
    });
  }

  /** Admin B: a la papelera. Sale de la lista al instante (el listado ya no lo trae). */
  enviarAPapelera(t: Tramite): void {
    const motivo = this.motivoAdmin.trim();
    if (motivo.length < 3 || this.actualizando.has(t.id)) return;
    this.actualizando.add(t.id);
    this.error = '';
    this.aviso = '';
    this.service.enviarAPapelera(t.id, motivo)
      .pipe(finalize(() => this.actualizando.delete(t.id)))
      .subscribe({
        next: () => {
          this.tramites = this.tramites.filter((x) => x.id !== t.id);
          if (this.abierto?.id === t.id) this.cerrar();
          this.aviso = `N° ${t.id} está en la papelera. Se puede restaurar en «Reglas y papelera».`;
        },
        error: (e) => {
          this.error = e.error?.detail ?? `No se pudo enviar a la papelera (${e.status}).`;
          this.cargar(false);
        },
      });
  }

  avisarEnCamino(t: Tramite): void {
    if (this.actualizando.has(t.id)) return;
    this.accion(t, this.service.avisarEnCamino(t.id), (real) => `Aviso enviado a ${this.usuario(real.vecinoUsername)}: la cuadrilla va en camino.`);
  }

  /** Visita, responsable, telefono y en camino devuelven el tramite completo: se reemplaza tal cual. */
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

  // ---------- calendario ----------

  /** El calendario aparece si el backend trae visitas (aunque esta semana este vacia). */
  get hayVisitas(): boolean {
    return this.tramites.some((t) => t.visita !== undefined);
  }

  get dias(): Dia[] {
    const hoy = hoyIso();
    return [0, 1, 2, 3, 4, 5].map((i) => {
      const d = new Date(this.semana);
      d.setDate(d.getDate() + i);
      const fecha = iso(d);
      return { fecha, hoy: fecha === hoy, label: d.toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric' }) + (fecha === hoy ? ' · hoy' : '') };
    });
  }

  get tituloSemana(): string {
    const fin = new Date(this.semana);
    fin.setDate(fin.getDate() + 5);
    const f = (d: Date) => d.toLocaleDateString('es-CL', { day: 'numeric', month: 'long' });
    return `Visitas · semana del ${f(this.semana)} al ${f(fin)}`;
  }

  get esEstaSemana(): boolean {
    return iso(this.semana) === iso(lunesDe(new Date()));
  }

  moverSemana(n: number): void {
    const d = new Date(this.semana);
    d.setDate(d.getDate() + 7 * n);
    this.semana = d;
  }

  irAHoy(): void {
    this.semana = lunesDe(new Date());
  }

  /** Visitas a mostrar: las de tramites no rechazados (un resuelto queda como historia de la semana). */
  private get visitasSemana(): Tramite[] {
    const desde = iso(this.semana);
    const hasta = this.dias[this.dias.length - 1].fecha;
    return this.tramites.filter((t) => t.visita && t.estado !== 'RECHAZADO' && t.visita.fecha >= desde && t.visita.fecha <= hasta);
  }

  /** Visitas de la semana que caen en domingo (la grilla va de lunes a sabado). */
  get fueraDeGrilla(): number {
    const domingo = new Date(this.semana);
    domingo.setDate(domingo.getDate() + 6);
    const d = iso(domingo);
    return this.tramites.filter((t) => t.visita?.fecha === d && t.estado !== 'RECHAZADO').length;
  }

  get filas(): Fila[] {
    const visitas = this.visitasSemana;
    // Cuadrillas fijas primero; cualquier otro nombre que venga del backend suma su fila.
    const extra = [...new Set(visitas.map((t) => t.visita!.cuadrilla))].filter((c) => !CUADRILLAS.includes(c)).sort();
    const cuadrillas = [...CUADRILLAS, ...extra];
    const hoy = hoyIso();
    const filas: Fila[] = [];
    for (const cuadrilla of cuadrillas) {
      for (const franja of FRANJAS) {
        const celdas = this.dias.map((d) => {
          const aqui = visitas.filter((t) => t.visita!.fecha === d.fecha && t.visita!.franja === franja && t.visita!.cuadrilla === cuadrilla);
          const pasada = d.fecha < hoy || this.franjaTerminada(d.fecha, franja);
          const yaEsLaSuya = !!this.eligiendo && aqui.some((t) => t.id === this.eligiendo!.id);
          return { fecha: d.fecha, franja, cuadrilla, visitas: aqui, pasada, elegible: !!this.eligiendo && !pasada && !aqui.length && !yaEsLaSuya };
        });
        filas.push({ cuadrilla, franja, celdas });
      }
    }
    return filas;
  }

  claseVisita(t: Tramite): string {
    if (t.estado === 'RESUELTO') return 'HECHO';
    if (t.estado === 'EN_TERRENO') return 'TERRENO';
    return t.visita!.estado;
  }

  // ---------- ficha ----------

  steps(t: Tramite): { label: string; cls: string }[] {
    if (t.estado === 'RESUELTO') return FLUJO.map((e) => ({ label: ETIQUETA[e], cls: 'hecho' }));
    if (t.estado === 'RECHAZADO') {
      const alcanzados = (this.pasos ?? []).filter((p) => p.fechaCumplido).map((p) => FLUJO.indexOf(p.estado)).filter((i) => i >= 0);
      const hasta = alcanzados.length ? Math.max(...alcanzados) : 0;
      return FLUJO.map((e, i) => ({ label: i === hasta + 1 ? 'Rechazado' : ETIQUETA[e], cls: i <= hasta ? 'hecho' : i === hasta + 1 ? 'rechazado' : '' }));
    }
    const idx = FLUJO.indexOf(t.estado);
    return FLUJO.map((e, i) => ({ label: ETIQUETA[e], cls: i < idx ? 'hecho' : i === idx ? 'actual' : '' }));
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
          if (this.eligiendo?.id === real.id && !AGENDABLE.includes(real.estado)) this.eligiendo = null;
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
    if (this.abierto?.id !== t.id) {
      this.nota = '';
      this.confirmandoRechazo = false;
      this.formVisita = this.formVacio(t.visita);
      this.responsableNuevo = '';
      this.motivoAdmin = '';
      this.confirmandoPapelera = false;
      // Elegir bloque es para un tramite a la vez: abrir otro cancela la eleccion.
      if (this.eligiendo && this.eligiendo.id !== t.id) this.eligiendo = null;
    }
    this.abierto = t;
    this.cargarPasos(t);
    setTimeout(() => this.cerrarBtn?.nativeElement.focus());
  }

  cerrar(): void {
    const id = this.abierto?.id;
    this.abierto = null;
    this.pasos = null;
    this.confirmandoRechazo = false;
    this.eligiendo = null;
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus());
  }

  cargarPasos(t: Tramite): void {
    this.cargandoPasos = true;
    this.errorPasos = '';
    this.service.seguimiento(t.id)
      .pipe(finalize(() => (this.cargandoPasos = false)))
      .subscribe({
        next: (p) => {
          if (this.abierto?.id === t.id) this.pasos = p;
        },
        error: (e) => (this.errorPasos = e.error?.detail ?? `No se pudo cargar el historial (${e.status}).`),
      });
  }

  /** En un rechazo no se listan los pasos que nunca alcanzo (igual que en /requests). */
  pasosVisibles(t: Tramite): Paso[] {
    const lista = this.pasos ?? [];
    return t.estado === 'RECHAZADO' ? lista.filter((p) => p.fechaCumplido || p.estado === 'RECHAZADO') : lista;
  }
}
