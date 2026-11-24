import { Component, ElementRef, EventEmitter, Input, OnChanges, Output, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import { EstadoTramite, MAX_CONTACTOS, Paso, RequestsService, RespuestaVisita, Tramite, textoVisita } from '../requests/requests.service';
import { ETIQUETA_VECINO, FLUJO } from '../requests/estados';

/** Que significa cada paso para el vecino. */
const DETALLE_PASO: Record<EstadoTramite, string> = {
  INGRESADO: 'Recibimos su solicitud.',
  ADMITIDO: 'Revisamos los datos: está todo en orden.',
  EN_GESTION: 'Coordinamos la visita con la cuadrilla.',
  EN_TERRENO: 'La cuadrilla va a su dirección.',
  RESUELTO: 'Trabajo terminado. Le enviamos el certificado por correo.',
  RECHAZADO: 'No pudimos seguir con su solicitud.',
};

/** "Que sigue" cuando no hay visita de por medio. */
const SIGUE: Partial<Record<EstadoTramite, string>> = {
  INGRESADO: 'revisaremos su solicitud.',
  ADMITIDO: 'le propondremos una fecha de visita.',
  EN_GESTION: 'le propondremos una fecha de visita.',
  EN_TERRENO: 'la cuadrilla irá a su dirección.',
};

const ICONO: Record<EstadoTramite, string> = {
  INGRESADO: 'doc', ADMITIDO: 'ok', EN_GESTION: 'tool', EN_TERRENO: 'truck', RESUELTO: 'home', RECHAZADO: 'x',
};

/** Atajos para pedir otro horario: el adulto mayor toca uno en vez de escribir. */
const SUGERENCIAS = ['Otro día en la mañana', 'Otro día en la tarde', 'La próxima semana'];

type Tam = 't1' | 't2' | 't3';
const CLAVE_LETRA = 'bd-letra-vecino';
const CORREO = /^\S+@\S+\.\S+$/;

interface PasoVista {
  n: number;
  titulo: string;
  detalle: string;
  fecha: string | null;
  nota: string | null;
  cls: 'hecho' | 'actual' | 'pendiente' | 'rechazado';
}

/**
 * Vecino A+C: el estado grande con la barra de iconos (C) arriba, la visita con respuestas
 * fijas (A), "quien llega" con codigo de seguridad y "que hacer" (C), el recorrido paso a paso (A),
 * comprobante imprimible, familiares que reciben copia y letra A / A+ / A++ (C).
 * Cada pieza que depende del backend nuevo (visita, codigo, contactos) se esconde si no viene.
 */
@Component({
  selector: 'app-seguimiento-vecino',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="sv" [ngClass]="tam">
      <div class="sv-letra sv-no-print" role="group" aria-label="Tamaño de la letra">
        <span>Letra</span>
        <button type="button" *ngFor="let z of TAMANOS" [class.on]="tam === z.id" [attr.aria-pressed]="tam === z.id"
                [attr.aria-label]="z.aria" [ngClass]="z.id" (click)="cambiarLetra(z.id)">{{ z.txt }}</button>
      </div>

      <!-- LISTA (A): una tarjeta por tramite -->
      <ul class="sv-lista" *ngIf="!abierto" aria-label="Sus trámites">
        <li *ngFor="let t of tramites; trackBy: porId">
          <article class="sv-card">
            <p class="sv-num">Trámite N° {{ t.id < 0 ? '…' : t.id }}</p>
            <p class="sv-tipo">{{ nombreTipo(t.tipoId) }}</p>
            <span class="sv-pill" [ngClass]="t.estado">{{ t.id < 0 ? 'Enviando…' : paso(t) }}</span>
            <p class="sv-sigue"><b>Qué sigue:</b> {{ queSigue(t) }}</p>
            <button type="button" class="btn btn-primary sv-btn" [disabled]="t.id < 0" (click)="abrir(t)" [attr.data-id]="t.id">
              {{ puedeResponder(t) ? 'Responder la visita' : 'Ver mi trámite' }}
            </button>
          </article>
        </li>
      </ul>

      <section class="sv-det" *ngIf="abierto as t" [attr.aria-label]="'Trámite ' + t.id">
        <button type="button" class="btn btn-outline sv-volver sv-no-print" (click)="vista === 'detalle' ? cerrar() : (vista = 'detalle')">
          ← {{ vista === 'detalle' ? 'Mis trámites' : 'Volver a mi trámite' }}
        </button>

        <ng-container *ngIf="vista === 'detalle'">
          <!-- HERO (C) -->
          <div class="sv-hero">
            <p class="sv-hero-n">Trámite N° {{ t.id }} · {{ nombreTipo(t.tipoId) }}</p>
            <h2 class="sv-hero-e" tabindex="-1" #titulo>
              <svg viewBox="0 0 24 24" aria-hidden="true" [ngSwitch]="icono(t)">
                <ng-container *ngSwitchCase="'doc'"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><path d="M14 3v6h6"></path></ng-container>
                <ng-container *ngSwitchCase="'ok'"><path d="M5 12l5 5L20 7"></path></ng-container>
                <ng-container *ngSwitchCase="'tool'"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"></path></ng-container>
                <ng-container *ngSwitchCase="'truck'"><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"></path><circle cx="7" cy="17.5" r="1.8"></circle><circle cx="17" cy="17.5" r="1.8"></circle></ng-container>
                <ng-container *ngSwitchCase="'home'"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"></path><path d="M9 15l2 2 4-4"></path></ng-container>
                <ng-container *ngSwitchDefault><path d="M6 6l12 12M18 6L6 18"></path></ng-container>
              </svg>
              {{ estadoGrande(t) }}
            </h2>
            <p class="sv-hero-t">{{ heroTexto(t) }}</p>
            <ol class="sv-trk" [attr.aria-label]="paso(t)">
              <li *ngFor="let s of tracker(t)" [ngClass]="s.cls"><span class="sv-trk-c" aria-hidden="true"></span><span class="sv-trk-l">{{ s.label }}</span></li>
            </ol>
          </div>

          <!-- VISITA (A) -->
          <div class="sv-box" *ngIf="visitaVigente(t) && t.visita as v">
            <h3 class="sv-h">Su visita</h3>
            <dl class="sv-datos">
              <div><dt>Día y hora</dt><dd class="sv-cap">{{ textoVisita(v) }}</dd></div>
              <div *ngIf="t.direccion"><dt>Dirección</dt><dd>{{ t.direccion }}</dd></div>
            </dl>
            <blockquote class="sv-nota" *ngIf="v.nota">{{ v.nota }}</blockquote>
            <p class="sv-ev" [ngClass]="'sv-ev-' + (vencida(t) ? 'VENCIDA' : v.estado)">{{ estadoVisita(t) }}</p>
            <ng-container *ngIf="puedeResponder(t)">
              <ng-container *ngIf="!pidiendoCambio">
                <button type="button" class="btn btn-primary sv-btn" [disabled]="enviando" (click)="responder(t, 'CONFIRMAR')">
                  {{ enviando ? 'Enviando…' : 'Sí, estaré en casa' }}
                </button>
                <button type="button" class="btn btn-outline sv-btn" [disabled]="enviando" (click)="pidiendoCambio = true">Necesito otro día u hora</button>
                <button type="button" class="btn btn-outline sv-btn" [disabled]="enviando" (click)="responder(t, 'LLAMAR')">Prefiero que me llamen</button>
              </ng-container>
              <ng-container *ngIf="pidiendoCambio">
                <p class="sv-h4">¿Qué día y hora le acomoda?</p>
                <div class="sv-sug" role="group" aria-label="Sugerencias">
                  <button type="button" class="chip" *ngFor="let s of SUGERENCIAS" [class.on]="horarioPedido === s" (click)="horarioPedido = s">{{ s }}</button>
                </div>
                <label class="sv-lbl" for="sv-horario">O escríbalo con sus palabras</label>
                <input id="sv-horario" class="sv-inp" [(ngModel)]="horarioPedido" name="horarioPedido" maxlength="100" placeholder="Ej.: viernes en la tarde" autocomplete="off" />
                <button type="button" class="btn btn-primary sv-btn" [disabled]="enviando || !horarioPedido.trim()" (click)="responder(t, 'CAMBIAR')">
                  {{ enviando ? 'Enviando…' : 'Pedir este horario' }}
                </button>
                <button type="button" class="btn btn-outline sv-btn" [disabled]="enviando" (click)="pidiendoCambio = false">Volver</button>
              </ng-container>
            </ng-container>
          </div>
          <p class="aviso-error" *ngIf="errorResp" role="alert">{{ errorResp }}</p>
          <p class="sv-ok" *ngIf="okResp" role="status">{{ okResp }}</p>

          <!-- QUIEN LLEGA + QUE HACER (C): con la visita confirmada o en terreno -->
          <div class="sv-box" *ngIf="visitaConfirmada(t) && t.visita as v">
            <h3 class="sv-h">Quién llega</h3>
            <p class="sv-val">{{ v.cuadrilla }}<ng-container *ngIf="t.estado === 'EN_TERRENO' && t.enCaminoDesde">, que salió a las {{ t.enCaminoDesde | date: 'HH:mm' }}</ng-container>.</p>
            <div class="sv-codigo" *ngIf="v.codigo">
              <p>Para su seguridad, pídales este código antes de abrir:</p>
              <b>{{ v.codigo }}</b>
            </div>
            <h3 class="sv-h">Qué tiene que hacer usted</h3>
            <ol class="sv-tareas">
              <li>Esté en casa o deje a alguien que abra.</li>
              <li *ngIf="v.codigo">Pídale el código a la cuadrilla y no abra si no coincide.</li>
              <li>Si tiene mascotas, déjelas amarradas.</li>
            </ol>
          </div>

          <!-- RECORRIDO (A) -->
          <div class="sv-box">
            <h3 class="sv-h">Todo el recorrido</h3>
            <p class="muted" *ngIf="cargando">Cargando…</p>
            <div class="load-error" *ngIf="error && !cargando">
              <p>{{ error }}</p>
              <button class="btn btn-outline btn-sm" type="button" (click)="cargar(t)">Reintentar</button>
            </div>
            <ol class="sv-steps" *ngIf="!cargando && !error">
              <li *ngFor="let p of recorrido" [ngClass]="p.cls">
                <span class="sv-dot" aria-hidden="true">{{ p.cls === 'hecho' ? '✓' : p.cls === 'rechazado' ? '✕' : p.n }}</span>
                <div>
                  <p class="sv-st-t">{{ p.titulo }} <span class="sv-aqui" *ngIf="p.cls === 'actual'">Aquí va</span></p>
                  <p class="sv-st-d">{{ p.detalle }}</p>
                  <p class="sv-st-f" *ngIf="p.fecha">{{ p.fecha }}</p>
                  <blockquote class="sv-nota" *ngIf="p.nota">{{ p.nota }}</blockquote>
                </div>
              </li>
            </ol>
          </div>

          <!-- ACCIONES (C) -->
          <div class="sv-grid2 sv-no-print">
            <button type="button" class="btn btn-outline sv-btn" (click)="vista = 'comprobante'">Comprobante</button>
            <button type="button" class="btn btn-outline sv-btn" *ngIf="t.contactos !== undefined && abiertoTramite(t)"
                    (click)="abrirFamiliar()">Avisar a un familiar</button>
          </div>
          <div class="sv-box" *ngIf="t.contactos?.length">
            <h3 class="sv-h">También reciben los avisos</h3>
            <ul class="sv-contactos">
              <li *ngFor="let c of t.contactos">
                <span>{{ c.nombre }} · {{ c.correo }}</span>
                <button type="button" class="btn btn-outline btn-sm" *ngIf="abiertoTramite(t)" [disabled]="guardandoFam"
                        (click)="quitarContacto(t, c.id)" [attr.aria-label]="'Quitar a ' + c.nombre">Quitar</button>
              </li>
            </ul>
          </div>
          <p class="sv-pie">Le avisamos cada paso por correo a {{ t.vecinoUsername }}.</p>
        </ng-container>

        <!-- COMPROBANTE (C) -->
        <ng-container *ngIf="vista === 'comprobante'">
          <div class="sv-recibo">
            <p class="sv-lbl-up">Comprobante de solicitud · BarrioDigital</p>
            <p class="sv-recibo-n">N° {{ t.id }}</p>
            <dl class="sv-datos">
              <div><dt>Trámite</dt><dd>{{ nombreTipo(t.tipoId) }}</dd></div>
              <div><dt>Vecino</dt><dd>{{ t.vecinoUsername }}</dd></div>
              <div *ngIf="t.direccion"><dt>Dirección</dt><dd>{{ t.direccion }}</dd></div>
              <div><dt>Ingresado</dt><dd>{{ t.fechaIngreso | date: "d 'de' MMMM y, HH:mm" }}</dd></div>
              <div><dt>Estado</dt><dd>{{ paso(t) }}</dd></div>
            </dl>
          </div>
          <button type="button" class="btn btn-primary sv-btn sv-no-print" (click)="imprimir()">Imprimir</button>
        </ng-container>

        <!-- FAMILIAR (C) -->
        <ng-container *ngIf="vista === 'familiar'">
          <h2 class="sv-h2">Avisar a un familiar</h2>
          <p class="sv-txt">Recibirá los mismos correos que usted sobre este trámite. Podrá ver en qué va, pero no cambiar nada.</p>
          <ng-container *ngIf="(t.contactos?.length ?? 0) < MAX_CONTACTOS; else lleno">
            <label class="sv-lbl" for="sv-fnombre">Nombre</label>
            <input id="sv-fnombre" class="sv-inp" [(ngModel)]="famNombre" name="famNombre" maxlength="100" autocomplete="off" placeholder="Ej.: Pedro" />
            <label class="sv-lbl" for="sv-fcorreo">Correo</label>
            <input id="sv-fcorreo" class="sv-inp" type="email" [(ngModel)]="famCorreo" name="famCorreo" maxlength="150" autocomplete="off" placeholder="nombre@correo.cl" />
            <p class="sv-txt sv-aviso" *ngIf="problemaFamiliar(t) as p">{{ p }}</p>
            <button type="button" class="btn btn-primary sv-btn" [disabled]="guardandoFam || !!problemaFamiliar(t)" (click)="agregarContacto(t)">
              {{ guardandoFam ? 'Guardando…' : 'Avisarle también' }}
            </button>
          </ng-container>
          <ng-template #lleno><p class="sv-txt sv-aviso">Ya tiene {{ MAX_CONTACTOS }} familiares avisados, el máximo. Quite uno para agregar otro.</p></ng-template>
          <p class="aviso-error" *ngIf="errorFam" role="alert">{{ errorFam }}</p>
        </ng-container>
      </section>
    </div>
  `,
  styles: [`
    :host { display: block; max-width: 720px; }
    .sv { display: flex; flex-direction: column; gap: 0.9em; line-height: 1.45; }
    .t1 { font-size: 16px; } .t2 { font-size: 18px; } .t3 { font-size: 21px; }
    .sv .btn { font-size: 1em; }
    .sv-letra { align-self: flex-end; display: flex; align-items: center; gap: 4px; padding: 3px; border-radius: 12px; background: var(--paper-sunk); font-size: 14px; }
    .sv-letra span { padding: 0 6px; font-weight: 700; color: var(--ink-soft); }
    .sv-letra button { min-width: 46px; height: 44px; border: 0; border-radius: 9px; background: transparent; font-family: inherit; font-weight: 800; color: var(--ink); cursor: pointer; }
    .sv-letra button.t1 { font-size: 15px; } .sv-letra button.t2 { font-size: 18px; } .sv-letra button.t3 { font-size: 21px; }
    .sv-letra button.on { background: var(--teal-deep); color: #fff; }
    .sv-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.8em; }
    .sv-card, .sv-box { background: var(--paper-raised); border: 1.5px solid var(--line-strong); border-radius: 18px; padding: 1em; display: flex; flex-direction: column; gap: 0.6em; }
    .sv-num { margin: 0; font-size: 0.82em; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--terracotta-deep); }
    .sv-tipo { margin: 0; font-size: 1.3em; font-weight: 800; line-height: 1.15; }
    .sv-pill { align-self: flex-start; padding: 0.25em 0.8em; border-radius: 999px; font-weight: 800; font-size: 0.92em; color: var(--c, var(--ink)); background: var(--c-bg, var(--paper-sunk)); }
    .sv-sigue { margin: 0; }
    .sv-btn { width: 100%; min-height: 3.1em; }
    .sv-volver { align-self: flex-start; min-height: 2.8em; }
    .sv-det { display: flex; flex-direction: column; gap: 0.9em; }
    .sv-hero { background: var(--teal-deep); color: #fff; border-radius: 20px; padding: 1em; display: flex; flex-direction: column; gap: 0.5em; }
    .sv-hero-n { margin: 0; font-size: 0.8em; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--signal); }
    .sv-hero-e { margin: 0; display: flex; align-items: center; gap: 0.4em; font-family: "Fraunces", Georgia, serif; font-size: 1.9em; line-height: 1.05; color: #fff; outline: none; }
    .sv-hero-e svg { width: 1em; height: 1em; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; flex: none; }
    .sv-hero-t { margin: 0; color: #eef2ea; }
    .sv-trk { list-style: none; margin: 0.3em 0 0; padding: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; }
    .sv-trk li { display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; }
    .sv-trk-c { width: 100%; height: 8px; border-radius: 4px; background: rgba(255, 255, 255, 0.25); }
    .sv-trk .hecho .sv-trk-c { background: #9fd1c0; }
    .sv-trk .actual .sv-trk-c { background: var(--signal); }
    .sv-trk .rechazado .sv-trk-c { background: var(--terracotta); }
    .sv-trk-l { font-size: 0.68em; font-weight: 700; color: #d9e4df; overflow-wrap: anywhere; }
    .sv-trk .actual .sv-trk-l { color: #fff; }
    .sv-h { margin: 0; font-family: "Fraunces", Georgia, serif; font-size: 1.2em; color: var(--teal-deep); }
    .sv-h2 { margin: 0; font-size: 1.5em; }
    .sv-h4 { margin: 0; font-weight: 800; }
    .sv-datos { margin: 0; display: grid; gap: 0.5em; }
    .sv-datos dt { font-size: 0.78em; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink-soft); }
    .sv-datos dd { margin: 2px 0 0; font-weight: 700; font-size: 1.05em; overflow-wrap: anywhere; }
    .sv-cap::first-letter { text-transform: uppercase; }
    .sv-val { margin: 0; font-weight: 700; }
    .sv-nota { margin: 0; padding: 0.6em 0.75em; border-radius: 10px; background: var(--paper-sunk); }
    .sv-ev { margin: 0; padding: 0.6em 0.75em; border-radius: 12px; font-weight: 700; }
    .sv-ev-PROPUESTA { background: rgba(242, 177, 52, 0.25); color: #6d4b02; }
    .sv-ev-CONFIRMADA { background: rgba(27, 100, 87, 0.15); color: #0f5a4c; }
    .sv-ev-CAMBIO_PEDIDO, .sv-ev-LLAMAR { background: rgba(38, 101, 168, 0.14); color: #1d5288; }
    .sv-ev-VENCIDA { background: var(--paper-sunk); color: var(--ink-soft); }
    .sv-sug { display: flex; flex-wrap: wrap; gap: 8px; }
    .sv-sug .chip { min-height: 44px; font-size: 0.95em; }
    .sv-lbl { font-weight: 700; font-size: 0.95em; }
    .sv-lbl-up { margin: 0; font-size: 0.8em; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-soft); }
    .sv-inp { width: 100%; box-sizing: border-box; min-height: 2.8em; padding: 0.5em 0.75em; border-radius: 12px; border: 2px solid var(--line-strong); font: inherit; background: var(--paper); }
    .sv-ok { margin: 0; padding: 0.7em 0.9em; border-radius: 12px; background: rgba(27, 100, 87, 0.15); color: #0f5a4c; font-weight: 700; }
    .sv-codigo { display: flex; align-items: center; justify-content: space-between; gap: 0.6em; padding: 0.7em 0.8em; border-radius: 12px; background: rgba(242, 177, 52, 0.25); color: #6d4b02; }
    .sv-codigo p { margin: 0; font-weight: 600; font-size: 0.92em; }
    .sv-codigo b { font-family: ui-monospace, Consolas, monospace; font-size: 1.5em; letter-spacing: 0.12em; color: var(--ink); }
    .sv-tareas { margin: 0; padding-left: 1.3em; display: flex; flex-direction: column; gap: 0.3em; }
    .sv-steps { list-style: none; margin: 0; padding: 0; }
    .sv-steps li { position: relative; display: grid; grid-template-columns: 2.3em 1fr; gap: 0.7em; padding-bottom: 0.9em; }
    .sv-steps li:last-child { padding-bottom: 0; }
    .sv-steps li::before { content: ""; position: absolute; left: 1.05em; top: 2.3em; bottom: 0; width: 4px; border-radius: 2px; background: var(--line-strong); }
    .sv-steps li:last-child::before { display: none; }
    .sv-steps li.hecho::before { background: var(--teal); }
    .sv-dot { width: 2.3em; height: 2.3em; box-sizing: border-box; border-radius: 50%; display: grid; place-items: center; border: 4px solid var(--line-strong); background: var(--paper-raised); font-weight: 800; color: var(--ink-soft); }
    .hecho .sv-dot { background: var(--teal); border-color: var(--teal); color: #fff; }
    .actual .sv-dot { background: var(--signal); border-color: var(--teal-deep); color: var(--teal-deep); }
    .rechazado .sv-dot { background: var(--terracotta); border-color: var(--terracotta-deep); color: #fff; }
    .sv-st-t { margin: 0.3em 0 0; font-weight: 800; font-size: 1.05em; }
    .pendiente .sv-st-t { color: var(--ink-soft); }
    .sv-aqui { display: inline-block; margin-left: 0.3em; padding: 0.05em 0.5em; border-radius: 999px; background: var(--teal-deep); color: var(--signal); font-size: 0.68em; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; vertical-align: 0.15em; }
    .sv-st-d { margin: 0.1em 0 0; font-size: 0.92em; color: var(--ink-soft); }
    .sv-st-f { margin: 0.25em 0 0; font-size: 0.92em; font-weight: 700; }
    .sv-grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.6em; }
    .sv-contactos { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4em; }
    .sv-contactos li { display: flex; justify-content: space-between; align-items: center; gap: 0.6em; overflow-wrap: anywhere; }
    .sv-pie { margin: 0; text-align: center; color: var(--ink-soft); font-size: 0.92em; overflow-wrap: anywhere; }
    .sv-txt { margin: 0; }
    .sv-aviso { padding: 0.6em 0.75em; border-radius: 10px; background: rgba(242, 177, 52, 0.25); color: #6d4b02; font-weight: 600; }
    .sv-recibo { background: #fff; border: 2px dashed var(--line-strong); border-radius: 14px; padding: 1em; display: flex; flex-direction: column; gap: 0.6em; }
    .sv-recibo-n { margin: 0; font-family: "Fraunces", Georgia, serif; font-weight: 700; font-size: 2.2em; line-height: 1; color: var(--teal-deep); }
  `],
})
export class SeguimientoVecinoComponent implements OnChanges {
  /** Los tramites ya filtrados de la pantalla; se refrescan solos cada 10 s. */
  @Input({ required: true }) tramites: Tramite[] = [];
  @Input({ required: true }) nombreTipo!: (tipoId: number) => string;
  /** El tramite que devolvio el backend tras una accion: el padre lo reemplaza en su lista. */
  @Output() actualizado = new EventEmitter<Tramite>();

  @ViewChild('titulo') titulo?: ElementRef<HTMLElement>;

  readonly SUGERENCIAS = SUGERENCIAS;
  readonly MAX_CONTACTOS = MAX_CONTACTOS;
  readonly textoVisita = textoVisita;
  readonly TAMANOS: { id: Tam; txt: string; aria: string }[] = [
    { id: 't1', txt: 'A', aria: 'Letra normal' },
    { id: 't2', txt: 'A+', aria: 'Letra grande' },
    { id: 't3', txt: 'A++', aria: 'Letra muy grande' },
  ];

  tam: Tam = leerLetra();
  abierto: Tramite | null = null;
  vista: 'detalle' | 'comprobante' | 'familiar' = 'detalle';
  pasos: Paso[] = [];
  recorrido: PasoVista[] = [];
  cargando = false;
  error = '';

  enviando = false;
  pidiendoCambio = false;
  horarioPedido = '';
  errorResp = '';
  okResp = '';

  famNombre = '';
  famCorreo = '';
  guardandoFam = false;
  errorFam = '';

  /** Con que estado y version de la visita se cargo el recorrido: si el polling trae otra, se recarga. */
  private claveCargada: string | null = null;

  private readonly service = inject(RequestsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  ngOnChanges(): void {
    if (!this.abierto) return;
    const actual = this.tramites.find((t) => t.id === this.abierto!.id);
    // Quedo fuera del filtro (o se cambio de cuenta): se vuelve a la lista.
    if (!actual) {
      this.cerrar();
      return;
    }
    this.abierto = actual;
    if (clave(actual) !== this.claveCargada && !this.cargando) this.cargar(actual);
  }

  porId(_i: number, t: Tramite): number {
    return t.id;
  }

  cambiarLetra(t: Tam): void {
    this.tam = t;
    try {
      localStorage.setItem(CLAVE_LETRA, t);
    } catch {
      // Navegacion privada o almacenamiento lleno: la letra vale solo para esta visita.
    }
  }

  abiertoTramite(t: Tramite): boolean {
    return t.estado !== 'RESUELTO' && t.estado !== 'RECHAZADO';
  }

  paso(t: Tramite): string {
    if (t.estado === 'RECHAZADO') return 'No pudo seguir';
    if (t.estado === 'RESUELTO') return 'Listo';
    return `Paso ${FLUJO.indexOf(t.estado) + 1} de ${FLUJO.length} · ${ETIQUETA_VECINO[t.estado]}`;
  }

  estadoGrande(t: Tramite): string {
    return ETIQUETA_VECINO[t.estado];
  }

  icono(t: Tramite): string {
    return ICONO[t.estado];
  }

  visitaVigente(t: Tramite): boolean {
    return !!t.visita && this.abiertoTramite(t);
  }

  visitaConfirmada(t: Tramite): boolean {
    return this.visitaVigente(t) && (t.visita!.estado === 'CONFIRMADA' || t.estado === 'EN_TERRENO');
  }

  /** Una propuesta cuya fecha ya paso no se puede aceptar: se espera una nueva. */
  vencida(t: Tramite): boolean {
    return !!t.visita && t.visita.estado === 'PROPUESTA' && t.visita.fecha < hoyIso();
  }

  puedeResponder(t: Tramite): boolean {
    return this.visitaVigente(t) && t.visita!.estado === 'PROPUESTA' && !this.vencida(t);
  }

  estadoVisita(t: Tramite): string {
    const v = t.visita!;
    if (this.vencida(t)) return 'Esta fecha ya pasó. Le propondremos otra y le avisaremos.';
    switch (v.estado) {
      case 'PROPUESTA': return 'Falta que nos diga si estará en casa.';
      case 'CONFIRMADA': return 'Visita confirmada. La esperamos.';
      case 'CAMBIO_PEDIDO': return `Pidió otro horario: «${v.horarioPedido ?? ''}». Le confirmaremos por correo.`;
      case 'LLAMAR': return 'Pidió que la llamemos para acordar el día. La llamaremos pronto.';
    }
  }

  queSigue(t: Tramite): string {
    if (t.id < 0) return 'estamos registrando su solicitud.';
    if (t.estado === 'RECHAZADO') return 'nada: no pudimos seguir. Vea el motivo en su trámite.';
    if (t.estado === 'RESUELTO') return 'nada. Trámite terminado.';
    if (t.estado === 'EN_TERRENO' && t.enCaminoDesde) return 'la cuadrilla va en camino.';
    if (this.puedeResponder(t)) return `confirmar la visita del ${textoVisita(t.visita!)}.`;
    if (this.vencida(t)) return 'le propondremos una nueva fecha de visita.';
    if (this.visitaVigente(t)) {
      return t.visita!.estado === 'CONFIRMADA' ? `la visita del ${textoVisita(t.visita!)}.` : 'le confirmaremos el nuevo horario.';
    }
    return SIGUE[t.estado] ?? '';
  }

  heroTexto(t: Tramite): string {
    if (t.estado === 'RECHAZADO') {
      const motivo = this.pasos.find((p) => p.estado === 'RECHAZADO')?.nota;
      return motivo ? `No pudimos seguir: ${motivo}` : 'No pudimos seguir con su solicitud. Puede pedirla de nuevo con «+ Nuevo trámite».';
    }
    if (t.estado === 'RESUELTO') return 'Trabajo terminado. Le enviamos el certificado por correo.';
    if (t.estado === 'EN_TERRENO' && t.enCaminoDesde) {
      return `La cuadrilla salió a las ${new Date(t.enCaminoDesde).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false })} y va a su dirección.`;
    }
    const sigue = this.queSigue(t);
    return 'Qué sigue: ' + sigue;
  }

  /** Cinco tramos: cumplido, actual, pendiente; en un rechazo, rojo donde se corto. */
  tracker(t: Tramite): { label: string; cls: string }[] {
    if (t.estado === 'RESUELTO') return FLUJO.map((e) => ({ label: ETIQUETA_VECINO[e], cls: 'hecho' }));
    const hasta = t.estado === 'RECHAZADO' ? this.ultimoCumplido() : FLUJO.indexOf(t.estado);
    return FLUJO.map((e, i) => {
      if (t.estado === 'RECHAZADO') return { label: i === hasta + 1 ? 'No siguió' : ETIQUETA_VECINO[e], cls: i <= hasta ? 'hecho' : i === hasta + 1 ? 'rechazado' : '' };
      return { label: ETIQUETA_VECINO[e], cls: i < hasta ? 'hecho' : i === hasta ? 'actual' : '' };
    });
  }

  abrir(t: Tramite): void {
    if (t.id < 0) return;
    this.abierto = t;
    this.vista = 'detalle';
    this.limpiar();
    this.cargar(t, true);
  }

  cerrar(): void {
    const id = this.abierto?.id;
    this.abierto = null;
    this.vista = 'detalle';
    this.pasos = [];
    this.recorrido = [];
    this.claveCargada = null;
    this.limpiar();
    // Devuelve el foco a la tarjeta de la que se vino (teclado y lector de pantalla).
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus());
  }

  private limpiar(): void {
    this.pidiendoCambio = false;
    this.horarioPedido = '';
    this.errorResp = '';
    this.okResp = '';
    this.famNombre = '';
    this.famCorreo = '';
    this.errorFam = '';
  }

  /** enfocar: solo al abrir; la recarga por polling no debe mover el foco. */
  cargar(t: Tramite, enfocar = false): void {
    // Se marca al empezar: si falla, ngOnChanges (corre en cada ciclo) no reintenta en bucle.
    this.claveCargada = clave(t);
    this.cargando = true;
    this.error = '';
    this.service.seguimiento(t.id)
      .pipe(finalize(() => (this.cargando = false)))
      .subscribe({
        next: (pasos) => {
          if (this.abierto?.id !== t.id) return; // volvio a la lista o abrio otro mientras cargaba
          this.pasos = pasos;
          this.recorrido = armarRecorrido(t, pasos);
          if (enfocar) setTimeout(() => this.titulo?.nativeElement.focus());
        },
        error: (e) => (this.error = e.error?.detail ?? `No se pudo cargar el recorrido (${e.status}).`),
      });
  }

  responder(t: Tramite, respuesta: RespuestaVisita): void {
    if (this.enviando || !this.puedeResponder(t)) return; // doble toque, o vencio mientras miraba
    if (respuesta === 'CAMBIAR' && !this.horarioPedido.trim()) return;
    this.enviando = true;
    this.errorResp = '';
    this.okResp = '';
    this.service.responderVisita(t.id, respuesta, respuesta === 'CAMBIAR' ? this.horarioPedido : undefined)
      .pipe(finalize(() => (this.enviando = false)))
      .subscribe({
        next: (real) => {
          this.pidiendoCambio = false;
          this.horarioPedido = '';
          this.okResp = respuesta === 'CONFIRMAR'
            ? 'Listo, le avisamos al funcionario que estará en casa.'
            : 'Listo, le avisamos al funcionario. Le responderá por correo.';
          this.aplicar(real);
        },
        // 409: ya respondio (otra pestaña o el correo) o el funcionario reprogramo; el polling trae lo real.
        error: (e) => (this.errorResp = e.error?.detail ?? `No se pudo enviar su respuesta (${e.status}). Intente de nuevo.`),
      });
  }

  abrirFamiliar(): void {
    this.famNombre = '';
    this.famCorreo = '';
    this.errorFam = '';
    this.vista = 'familiar';
  }

  /** Lo que impide guardar, dicho en simple; null si se puede. */
  problemaFamiliar(t: Tramite): string | null {
    const correo = this.famCorreo.trim().toLowerCase();
    if (!this.famNombre.trim() || !correo) return null; // aun escribiendo: el boton se deshabilita igual
    if (!CORREO.test(correo)) return 'Revise el correo: le falta algo (por ejemplo, la @).';
    if (correo === t.vecinoUsername.toLowerCase()) return 'Ese es su propio correo: los avisos ya le llegan.';
    if (t.contactos?.some((c) => c.correo.toLowerCase() === correo)) return 'Ese correo ya recibe los avisos.';
    return null;
  }

  agregarContacto(t: Tramite): void {
    if (this.guardandoFam || !this.famNombre.trim() || !this.famCorreo.trim() || this.problemaFamiliar(t)) return;
    this.guardandoFam = true;
    this.errorFam = '';
    this.service.agregarContacto(t.id, this.famNombre, this.famCorreo)
      .pipe(finalize(() => (this.guardandoFam = false)))
      .subscribe({
        next: (real) => {
          this.aplicar(real);
          this.vista = 'detalle';
          this.okResp = `Listo: ${this.famNombre.trim()} también recibirá los avisos.`;
        },
        error: (e) => (this.errorFam = e.error?.detail ?? `No se pudo guardar (${e.status}).`),
      });
  }

  quitarContacto(t: Tramite, contactoId: number): void {
    if (this.guardandoFam) return;
    this.guardandoFam = true;
    this.service.quitarContacto(t.id, contactoId)
      .pipe(finalize(() => (this.guardandoFam = false)))
      .subscribe({
        next: (real) => this.aplicar(real),
        error: (e) => (this.errorResp = e.error?.detail ?? `No se pudo quitar (${e.status}).`),
      });
  }

  /**
   * Imprime solo el comprobante: styles.css esconde todo lo demas mientras body tiene
   * la clase `imprimiendo` (los estilos del componente no alcanzan a la barra superior).
   */
  imprimir(): void {
    document.body.classList.add('imprimiendo');
    // En algunos navegadores (Safari iOS) print() no bloquea: la clase se quita recien al terminar.
    window.addEventListener('afterprint', () => document.body.classList.remove('imprimiendo'), { once: true });
    window.print();
  }

  private aplicar(real: Tramite): void {
    if (this.abierto?.id === real.id) this.abierto = real;
    this.actualizado.emit(real);
  }

  private ultimoCumplido(): number {
    const idx = this.pasos.filter((p) => p.fechaCumplido).map((p) => FLUJO.indexOf(p.estado)).filter((i) => i >= 0);
    return idx.length ? Math.max(...idx) : 0;
  }
}

/** La recarga del recorrido depende del estado y de la version de la visita (la reprogramacion mueve la fecha estimada). */
function clave(t: Tramite): string {
  return `${t.estado}|${t.visita?.actualizadoEn ?? ''}|${t.enCaminoDesde ?? ''}`;
}

function hoyIso(): string {
  const d = new Date();
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

function leerLetra(): Tam {
  try {
    const v = localStorage.getItem(CLAVE_LETRA);
    return v === 't1' || v === 't2' || v === 't3' ? v : 't2';
  } catch {
    return 't2';
  }
}

function fechaLarga(iso: string): string {
  return new Date(iso).toLocaleString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Los 5 pasos con su fecha real o estimada; en un rechazo, solo lo alcanzado mas el rechazo. */
function armarRecorrido(t: Tramite, pasos: Paso[]): PasoVista[] {
  const por = new Map(pasos.map((p) => [p.estado, p]));
  // Tramites anteriores a los hitos (V3) pueden no traer el ingreso: se usa la fecha del tramite.
  if (!por.get('INGRESADO')?.fechaCumplido) {
    por.set('INGRESADO', { estado: 'INGRESADO', fechaCumplido: t.fechaIngreso, fechaEstimada: null, nota: por.get('INGRESADO')?.nota ?? null, actualizadoPor: null });
  }
  const actual = FLUJO.indexOf(t.estado);
  const estados: EstadoTramite[] = t.estado === 'RECHAZADO'
    ? [...FLUJO.filter((e) => por.get(e)?.fechaCumplido), 'RECHAZADO']
    : FLUJO;
  return estados.map((e, i) => {
    const p = por.get(e);
    let cls: PasoVista['cls'] = 'pendiente';
    if (e === 'RECHAZADO') cls = 'rechazado';
    else if (t.estado === 'RESUELTO' || t.estado === 'RECHAZADO' || FLUJO.indexOf(e) < actual) cls = 'hecho';
    else if (e === t.estado) cls = 'actual';
    let fecha: string | null = null;
    if (p?.fechaCumplido) fecha = fechaLarga(p.fechaCumplido);
    else if (p?.fechaEstimada && cls === 'pendiente') {
      // Una estimacion que ya paso no se muestra como futura.
      fecha = new Date(p.fechaEstimada).getTime() >= Date.now() ? 'Estimado: ' + fechaLarga(p.fechaEstimada) : 'Estaba previsto para el ' + fechaLarga(p.fechaEstimada);
    }
    return { n: i + 1, titulo: ETIQUETA_VECINO[e], detalle: DETALLE_PASO[e], fecha, nota: p?.nota ?? null, cls };
  });
}
