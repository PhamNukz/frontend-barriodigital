import { Component, ElementRef, EventEmitter, Input, OnChanges, Output, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import { EstadoTramite, Paso, RequestsService, RespuestaVisita, Tramite, textoVisita } from '../requests/requests.service';
import { ETIQUETA_VECINO, FLUJO } from '../requests/estados';

/** Atajos para pedir otro horario: el adulto mayor toca uno en vez de escribir. */
const SUGERENCIAS = ['Otro día en la mañana', 'Otro día en la tarde', 'La próxima semana'];

/** Lo que "dice" la municipalidad al cumplirse cada paso. */
const MENSAJE: Record<EstadoTramite, string> = {
  INGRESADO: 'Recibimos tu solicitud. La estamos revisando.',
  ADMITIDO: 'Revisamos los datos y está todo en orden: tu solicitud fue aprobada.',
  EN_GESTION: 'Un funcionario está coordinando la visita.',
  EN_TERRENO: 'La cuadrilla va a la dirección que indicaste.',
  RESUELTO: 'Listo: terminamos el trabajo. Te enviamos el certificado por correo.',
  RECHAZADO: 'No pudimos seguir con tu solicitud.',
};

interface Mensaje {
  dia: string | null; // separador de dia: solo en el primer mensaje de cada dia
  estado: EstadoTramite;
  texto: string;
  nota: string | null;
  hora: string;
}

interface Siguiente {
  titulo: string;
  texto: string;
}

/**
 * Vecino B: cada tramite es una conversacion con la municipalidad, armada con el
 * seguimiento que ya entrega el backend (pasos cumplidos + nota del funcionario).
 * Si el backend trae `visita`, se suma la propuesta con respuestas fijas (sin texto libre
 * en el chat: eso pediria moderacion y un servicio de mensajeria).
 */
@Component({
  selector: 'app-conversacion',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <!-- LISTA: una conversacion por tramite -->
    <ul class="cv-lista" *ngIf="!abierto" aria-label="Tus trámites">
      <li *ngFor="let t of tramites; trackBy: porId">
        <button type="button" class="cv-fila" [disabled]="t.id < 0" (click)="abrir(t)" [attr.data-id]="t.id">
          <span class="cv-av" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.2-4.6A8 8 0 1 1 21 12z"></path></svg>
          </span>
          <span class="cv-fila-c">
            <span class="cv-fila-t">{{ nombreTipo(t.tipoId) }}</span>
            <span class="badge" [ngClass]="t.estado">{{ t.id < 0 ? 'Enviando…' : 'N° ' + t.id + ' · ' + paso(t) }}</span>
            <span class="cv-fila-m">{{ t.id < 0 ? 'Estamos registrando tu solicitud.' : mensajeCorto(t) }}</span>
          </span>
          <span class="cv-fila-h">
            {{ ultimoMovimiento(t) | date: 'd MMM, HH:mm' }}
            <span class="cv-nuevo" *ngIf="puedeResponder(t)">Responder</span>
          </span>
        </button>
      </li>
    </ul>

    <!-- HILO: los pasos del tramite como mensajes -->
    <section class="cv-hilo" *ngIf="abierto as t" [attr.aria-label]="'Conversación del trámite ' + t.id">
      <div class="cv-hilo-top">
        <button type="button" class="btn btn-outline btn-sm cv-volver" (click)="cerrar()">← Mis trámites</button>
        <div>
          <h2 class="cv-titulo" tabindex="-1" #titulo>{{ nombreTipo(t.tipoId) }}</h2>
          <p class="cv-sub">Trámite N° {{ t.id }}<ng-container *ngIf="t.direccion"> · {{ t.direccion }}</ng-container></p>
        </div>
      </div>

      <div class="cv-prog">
        <p class="cv-prog-t">{{ paso(t) }}</p>
        <div class="cv-barra" aria-hidden="true">
          <span *ngFor="let s of barra(t)" [class]="s"></span>
        </div>
      </div>

      <p class="muted" *ngIf="cargando">Cargando la conversación…</p>
      <div class="load-error" *ngIf="error && !cargando">
        <p>{{ error }}</p>
        <button class="btn btn-outline btn-sm" type="button" (click)="cargar(t)">Reintentar</button>
      </div>

      <ol class="cv-msgs" *ngIf="!cargando && !error" role="log" aria-label="Mensajes del trámite">
        <li *ngFor="let m of mensajes">
          <p class="cv-dia" *ngIf="m.dia">{{ m.dia }}</p>
          <div class="cv-bub" [class.cv-bub-rech]="m.estado === 'RECHAZADO'">
            <p class="cv-de">Municipalidad</p>
            <span class="badge" [ngClass]="m.estado">{{ etiqueta(m.estado) }}</span>
            <p class="cv-txt">{{ m.texto }}</p>
            <blockquote class="cv-nota" *ngIf="m.nota">{{ m.nota }}</blockquote>
            <span class="cv-hora">{{ m.hora }}</span>
          </div>
        </li>
        <!-- Visita: la propuesta del funcionario y lo que respondio el vecino -->
        <li *ngIf="visitaVigente(t) && t.visita as v">
          <div class="cv-bub cv-visita">
            <p class="cv-de">Municipalidad</p>
            <p class="cv-txt">{{ v.estado === 'PROPUESTA' ? 'Te proponemos esta visita. ¿Te acomoda?' : 'Tu visita' }}</p>
            <dl class="cv-vdatos">
              <div><dt>Día y hora</dt><dd>{{ textoVisita(v) }}</dd></div>
              <div *ngIf="t.direccion"><dt>Dirección</dt><dd>{{ t.direccion }}</dd></div>
              <div><dt>Quién va</dt><dd>{{ v.cuadrilla }}</dd></div>
            </dl>
            <blockquote class="cv-nota" *ngIf="v.nota">{{ v.nota }}</blockquote>
            <p class="cv-vestado" [ngClass]="'cv-v-' + v.estado">{{ estadoVisita(t) }}</p>
          </div>
        </li>
        <li *ngIf="t.estado === 'EN_TERRENO' && t.enCaminoDesde">
          <div class="cv-bub">
            <p class="cv-de">Municipalidad</p>
            <span class="badge EN_TERRENO">{{ etiqueta('EN_TERRENO') }}</span>
            <p class="cv-txt">La cuadrilla salió a las {{ t.enCaminoDesde | date: 'HH:mm' }} y va en camino a tu dirección.</p>
          </div>
        </li>
        <li *ngIf="siguiente && !visitaVigente(t) && siguiente as s">
          <div class="cv-sig">
            <p class="cv-sig-t">{{ s.titulo }}</p>
            <p>{{ s.texto }}</p>
          </div>
        </li>
      </ol>

      <!-- Respuestas fijas a la visita propuesta -->
      <div class="cv-resp" *ngIf="!cargando && puedeResponder(t)">
        <ng-container *ngIf="!pidiendoCambio">
          <button type="button" class="btn btn-primary cv-qr" [disabled]="enviando" (click)="responder(t, 'CONFIRMAR')">
            {{ enviando ? 'Enviando…' : 'Sí, me acomoda' }}
          </button>
          <button type="button" class="btn btn-outline cv-qr" [disabled]="enviando" (click)="pidiendoCambio = true">Necesito otro día u hora</button>
          <button type="button" class="btn btn-outline cv-qr" [disabled]="enviando" (click)="responder(t, 'LLAMAR')">Prefiero que me llamen</button>
        </ng-container>
        <ng-container *ngIf="pidiendoCambio">
          <p class="cv-resp-t">¿Qué día y hora te acomoda?</p>
          <div class="cv-sug" role="group" aria-label="Sugerencias">
            <button type="button" class="chip" *ngFor="let s of SUGERENCIAS" [class.on]="horarioPedido === s" (click)="horarioPedido = s">{{ s }}</button>
          </div>
          <label class="cv-lbl" for="cv-horario">O escríbelo con tus palabras</label>
          <input id="cv-horario" class="cv-inp" [(ngModel)]="horarioPedido" name="horarioPedido" maxlength="100"
                 placeholder="Ej.: viernes en la tarde" autocomplete="off" />
          <button type="button" class="btn btn-primary cv-qr" [disabled]="enviando || !horarioPedido.trim()" (click)="responder(t, 'CAMBIAR')">
            {{ enviando ? 'Enviando…' : 'Pedir este horario' }}
          </button>
          <button type="button" class="btn btn-outline cv-qr" [disabled]="enviando" (click)="pidiendoCambio = false">Volver</button>
        </ng-container>
      </div>
      <p class="aviso-error" *ngIf="errorResp" role="alert">{{ errorResp }}</p>
      <p class="cv-ok" *ngIf="okResp" role="status">{{ okResp }}</p>

      <p class="cv-pie">{{ pie(t) }}</p>
    </section>
  `,
  styles: [`
    :host { display: block; max-width: 720px; }
    .cv-lista { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .cv-fila {
      width: 100%; display: grid; grid-template-columns: 52px minmax(0, 1fr) auto; gap: 14px; align-items: center;
      padding: 14px 16px; border-radius: var(--radius); border: 1px solid var(--line); background: var(--paper-raised);
      box-shadow: var(--shadow); font: inherit; color: inherit; text-align: left; cursor: pointer;
    }
    .cv-fila:hover:not(:disabled) { border-color: var(--teal); }
    .cv-fila:disabled { opacity: 0.6; cursor: progress; }
    .cv-av { width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; background: var(--teal); color: #fff; }
    .cv-av svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 2; }
    .cv-fila-c { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 0; }
    .cv-fila-t { font-weight: 800; font-size: 1.1rem; }
    .cv-fila-m { color: var(--ink-soft); font-size: 0.98rem; }
    .cv-fila-h { align-self: start; font-size: 0.85rem; color: var(--ink-soft); white-space: nowrap; }
    .cv-hilo { display: flex; flex-direction: column; gap: 14px; }
    .cv-hilo-top { display: flex; align-items: flex-start; gap: 14px; flex-wrap: wrap; }
    .cv-volver { min-height: 44px; }
    .cv-titulo { margin: 0; font-size: 1.7rem; line-height: 1.1; outline: none; }
    .cv-sub { margin: 4px 0 0; color: var(--ink-soft); font-size: 1rem; }
    .cv-prog { display: flex; align-items: center; gap: 14px; padding: 12px 16px; border-radius: 12px; background: var(--paper-raised); border: 1px solid var(--line); }
    .cv-prog-t { margin: 0; font-weight: 800; font-size: 1.02rem; white-space: nowrap; color: var(--teal-deep); }
    .cv-barra { flex: 1; display: flex; gap: 4px; }
    .cv-barra span { flex: 1; height: 9px; border-radius: 5px; background: var(--paper-sunk); }
    .cv-barra span.on { background: var(--teal); }
    .cv-barra span.rech { background: var(--terracotta); }
    .cv-msgs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
    .cv-dia { margin: 6px auto; width: fit-content; padding: 4px 12px; border-radius: 999px; background: var(--paper-sunk); font-size: 0.9rem; font-weight: 700; text-transform: capitalize; }
    .cv-bub {
      max-width: 88%; display: flex; flex-direction: column; align-items: flex-start; gap: 8px;
      padding: 14px 16px; border-radius: 6px 18px 18px 18px; background: var(--paper-raised); border: 1px solid var(--line);
    }
    .cv-bub-rech { border-color: var(--terracotta); }
    .cv-de { margin: 0; font-size: 0.82rem; font-weight: 800; color: var(--terracotta-deep); }
    .cv-txt { margin: 0; font-size: 1.1rem; line-height: 1.45; }
    .cv-nota { margin: 0; padding: 10px 12px; border-radius: 10px; background: var(--paper-sunk); font-size: 1.02rem; line-height: 1.45; }
    .cv-hora { align-self: flex-end; font-size: 0.85rem; color: var(--ink-soft); }
    .cv-sig { padding: 14px 16px; border-radius: 14px; border: 2px dashed var(--line-strong); background: transparent; }
    .cv-sig p { margin: 0; font-size: 1.05rem; }
    .cv-sig-t { font-weight: 800; color: var(--teal-deep); margin-bottom: 4px !important; }
    .cv-pie { margin: 0; text-align: center; color: var(--ink-soft); font-size: 1rem; }
    .cv-nuevo { display: block; margin-top: 6px; padding: 2px 10px; border-radius: 999px; background: var(--terracotta-deep); color: #fff; font-size: 0.8rem; font-weight: 800; text-align: center; }
    .cv-visita { border: 2px solid var(--teal); }
    .cv-vdatos { margin: 0; display: grid; gap: 8px; }
    .cv-vdatos dt { font-size: 0.78rem; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ink-soft); }
    .cv-vdatos dd { margin: 2px 0 0; font-size: 1.12rem; font-weight: 700; }
    .cv-vdatos dd::first-letter { text-transform: uppercase; }
    .cv-vestado { margin: 0; padding: 10px 12px; border-radius: 10px; font-weight: 700; font-size: 1.02rem; }
    .cv-v-PROPUESTA { background: rgba(242, 177, 52, 0.25); color: #6d4b02; }
    .cv-v-CONFIRMADA { background: rgba(27, 100, 87, 0.15); color: #0f5a4c; }
    .cv-v-CAMBIO_PEDIDO, .cv-v-LLAMAR { background: rgba(38, 101, 168, 0.14); color: #1d5288; }
    .cv-resp { display: flex; flex-direction: column; gap: 10px; padding: 14px; border-radius: 14px; background: var(--paper-raised); border: 1px solid var(--line); }
    .cv-qr { width: 100%; min-height: 56px; font-size: 1.08rem; }
    .cv-resp-t { margin: 0; font-weight: 800; font-size: 1.1rem; }
    .cv-sug { display: flex; flex-wrap: wrap; gap: 8px; }
    .cv-sug .chip { min-height: 44px; font-size: 0.98rem; }
    .cv-lbl { font-weight: 700; font-size: 0.95rem; }
    .cv-inp { width: 100%; box-sizing: border-box; min-height: 52px; padding: 10px 14px; border-radius: 12px; border: 2px solid var(--line-strong); font: inherit; font-size: 1.05rem; background: var(--paper); }
    .cv-ok { margin: 0; padding: 12px 14px; border-radius: 12px; background: rgba(27, 100, 87, 0.15); color: #0f5a4c; font-weight: 700; }
    @media (max-width: 600px) {
      .cv-fila { grid-template-columns: 44px minmax(0, 1fr); }
      .cv-av { width: 44px; height: 44px; }
      .cv-fila-h { grid-column: 2; }
      .cv-bub { max-width: 100%; }
      .cv-prog { flex-wrap: wrap; }
    }
  `],
})
export class ConversacionComponent implements OnChanges {
  /** Los tramites ya filtrados de la pantalla; se refrescan solos cada 10 s. */
  @Input({ required: true }) tramites: Tramite[] = [];
  @Input({ required: true }) nombreTipo!: (tipoId: number) => string;
  /** El tramite que devolvio el backend al responder: el padre lo reemplaza en su lista. */
  @Output() actualizado = new EventEmitter<Tramite>();

  @ViewChild('titulo') titulo?: ElementRef<HTMLElement>;

  readonly SUGERENCIAS = SUGERENCIAS;
  readonly textoVisita = textoVisita;

  abierto: Tramite | null = null;
  mensajes: Mensaje[] = [];
  siguiente: Siguiente | null = null;
  cargando = false;
  error = '';

  enviando = false;
  pidiendoCambio = false;
  horarioPedido = '';
  errorResp = '';
  okResp = '';
  /** Estado con el que se cargo el hilo: si el polling trae otro, se recarga. */
  private estadoCargado: EstadoTramite | null = null;
  private pasosCumplidos: Paso[] = [];

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
    if (actual.estado !== this.estadoCargado && !this.cargando) this.cargar(actual);
  }

  porId(_i: number, t: Tramite): number {
    return t.id;
  }

  etiqueta(e: EstadoTramite): string {
    return ETIQUETA_VECINO[e];
  }

  /** "Paso 3 de 5: En proceso", o el cierre sin numero. */
  paso(t: Tramite): string {
    if (t.estado === 'RECHAZADO') return 'No pudo seguir';
    if (t.estado === 'RESUELTO') return 'Listo';
    return `Paso ${FLUJO.indexOf(t.estado) + 1} de ${FLUJO.length}: ${ETIQUETA_VECINO[t.estado]}`;
  }

  mensajeCorto(t: Tramite): string {
    if (this.puedeResponder(t)) return `Te proponemos una visita: ${textoVisita(t.visita!)}. ¿Te acomoda?`;
    if (t.estado === 'EN_TERRENO' && t.enCaminoDesde) return 'La cuadrilla va en camino.';
    return MENSAJE[t.estado];
  }

  /** La visita importa mientras el tramite siga abierto; al cerrarse ya es historia. */
  visitaVigente(t: Tramite): boolean {
    return !!t.visita && t.estado !== 'RESUELTO' && t.estado !== 'RECHAZADO';
  }

  puedeResponder(t: Tramite): boolean {
    return this.visitaVigente(t) && t.visita!.estado === 'PROPUESTA';
  }

  estadoVisita(t: Tramite): string {
    const v = t.visita!;
    switch (v.estado) {
      case 'PROPUESTA': return 'Falta que nos digas si te acomoda.';
      case 'CONFIRMADA': return 'Confirmaste la visita. Te esperamos.';
      case 'CAMBIO_PEDIDO': return `Pediste otro horario: «${v.horarioPedido ?? ''}». Te confirmaremos por aquí y por correo.`;
      case 'LLAMAR': return 'Pediste que te llamemos para acordar el día. Te llamaremos pronto.';
    }
  }

  responder(t: Tramite, respuesta: RespuestaVisita): void {
    if (this.enviando) return; // doble toque
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
            ? 'Listo, le avisamos al funcionario que estarás.'
            : 'Listo, le avisamos al funcionario. Te responderá por aquí y por correo.';
          if (this.abierto?.id === real.id) this.abierto = real;
          this.actualizado.emit(real);
        },
        // 409: ya respondio (otra pestaña o el correo); el polling trae el estado real.
        error: (e) => (this.errorResp = e.error?.detail ?? `No se pudo enviar tu respuesta (${e.status}). Intenta de nuevo.`),
      });
  }

  ultimoMovimiento(t: Tramite): string {
    return t.fechaResolucion ?? t.fechaAdmision ?? t.fechaIngreso;
  }

  /** Cinco segmentos; en un rechazo se pinta hasta donde llego y el siguiente en rojo. */
  barra(t: Tramite): string[] {
    if (t.estado === 'RESUELTO') return FLUJO.map(() => 'on');
    const hasta = t.estado === 'RECHAZADO' ? this.ultimoCumplido() : FLUJO.indexOf(t.estado);
    return FLUJO.map((_, i) => (i <= hasta ? 'on' : t.estado === 'RECHAZADO' && i === hasta + 1 ? 'rech' : ''));
  }

  pie(t: Tramite): string {
    if (t.estado === 'RECHAZADO') return 'Si quieres, puedes pedirlo de nuevo con «+ Nuevo trámite».';
    if (t.estado === 'RESUELTO') return 'Trámite terminado.';
    return 'Te escribiremos aquí y a tu correo cuando avance.';
  }

  abrir(t: Tramite): void {
    if (t.id < 0) return;
    this.abierto = t;
    this.limpiarRespuesta();
    this.cargar(t, true);
  }

  private limpiarRespuesta(): void {
    this.pidiendoCambio = false;
    this.horarioPedido = '';
    this.errorResp = '';
    this.okResp = '';
  }

  cerrar(): void {
    const id = this.abierto?.id;
    this.abierto = null;
    this.mensajes = [];
    this.siguiente = null;
    this.pasosCumplidos = [];
    this.estadoCargado = null;
    this.limpiarRespuesta();
    // Devuelve el foco a la fila de la que se vino (teclado y lector de pantalla).
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus());
  }

  /** enfocar: solo al abrir; la recarga por polling no debe mover el foco del usuario. */
  cargar(t: Tramite, enfocar = false): void {
    // Se marca al empezar (no al terminar): si falla, ngOnChanges -- que corre en cada ciclo,
    // porque `filtrados` es un getter -- no debe reintentar en bucle. Se reintenta con el boton.
    this.estadoCargado = t.estado;
    this.cargando = true;
    this.error = '';
    this.service.seguimiento(t.id)
      .pipe(finalize(() => (this.cargando = false)))
      .subscribe({
        next: (pasos) => {
          // El usuario pudo volver a la lista o abrir otro mientras cargaba.
          if (this.abierto?.id !== t.id) return;
          this.armar(t, pasos);
          if (enfocar) setTimeout(() => this.titulo?.nativeElement.focus());
        },
        error: (e) => {
          this.error = e.error?.detail ?? `No se pudo cargar la conversación (${e.status}).`;
        },
      });
  }

  /** Indice en FLUJO del ultimo paso cumplido (0 = ingreso); lo usa la barra de un rechazo. */
  private ultimoCumplido(): number {
    const idx = this.pasosCumplidos.map((p) => FLUJO.indexOf(p.estado)).filter((i) => i >= 0);
    return idx.length ? Math.max(...idx) : 0;
  }

  private armar(t: Tramite, pasos: Paso[]): void {
    const cumplidos = pasos
      .filter((p) => p.fechaCumplido)
      .sort((a, b) => a.fechaCumplido!.localeCompare(b.fechaCumplido!));
    // Tramites anteriores a los hitos (V3) pueden no traer el paso de ingreso: se arma con la fecha del tramite.
    if (!cumplidos.some((p) => p.estado === 'INGRESADO')) {
      cumplidos.unshift({ estado: 'INGRESADO', fechaCumplido: t.fechaIngreso, fechaEstimada: null, nota: null, actualizadoPor: null });
    }
    this.pasosCumplidos = cumplidos;

    let diaAnterior = '';
    this.mensajes = cumplidos.map((p) => {
      const fecha = new Date(p.fechaCumplido!);
      const dia = this.textoDia(fecha);
      const m: Mensaje = {
        dia: dia !== diaAnterior ? dia : null,
        estado: p.estado,
        texto: this.textoPaso(t, p.estado),
        nota: p.nota,
        hora: fecha.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false }),
      };
      diaAnterior = dia;
      return m;
    });
    this.siguiente = this.calcularSiguiente(t, pasos);
  }

  private textoPaso(t: Tramite, e: EstadoTramite): string {
    if (e !== 'INGRESADO') return MENSAJE[e];
    const base = `Recibimos tu solicitud N° ${t.id}. La estamos revisando.`;
    return t.creadoPor ? `${base} La ingresaron en la municipalidad a tu nombre.` : base;
  }

  /** El proximo paso que falta, con su fecha estimada si el funcionario la programo. */
  private calcularSiguiente(t: Tramite, pasos: Paso[]): Siguiente | null {
    if (t.estado === 'RESUELTO' || t.estado === 'RECHAZADO') return null;
    const sig = FLUJO[FLUJO.indexOf(t.estado) + 1];
    if (!sig) return null;
    const p = pasos.find((x) => x.estado === sig);
    const titulo = `Lo que sigue: ${ETIQUETA_VECINO[sig]}`;
    if (p?.fechaEstimada) {
      const f = new Date(p.fechaEstimada);
      const cuando = f.toLocaleString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', hour12: false });
      // Una fecha estimada que ya paso no se presenta como futura.
      const texto = f.getTime() >= Date.now()
        ? `Estimado para el ${cuando}.`
        : `Estaba previsto para el ${cuando}. Seguimos en eso y te avisaremos.`;
      return { titulo, texto: p.nota ? `${texto} ${p.nota}` : texto };
    }
    return { titulo, texto: p?.nota ?? 'Todavía no tiene fecha. Te avisaremos apenas la tengamos.' };
  }

  private textoDia(d: Date): string {
    const hoy = new Date();
    const ayer = new Date(hoy);
    ayer.setDate(hoy.getDate() - 1);
    if (d.toDateString() === hoy.toDateString()) return 'Hoy';
    if (d.toDateString() === ayer.toDateString()) return 'Ayer';
    const conAnio = d.getFullYear() !== hoy.getFullYear();
    return d.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', ...(conAnio ? { year: 'numeric' } : {}) });
  }
}
