import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, interval } from 'rxjs';
import { catchError, finalize, switchMap } from 'rxjs/operators';
import { SessionService } from '../auth/session.service';
import { CatalogService, TipoTramite } from '../catalog/catalog.service';
import { CupoInfo, EstadoTramite, Paso, RequestsService, Tramite } from './requests.service';

/** Siguiente estado sugerido en la UI; el backend vuelve a validar la transicion. */
const SIGUIENTE: Partial<Record<EstadoTramite, EstadoTramite>> = {
  INGRESADO: 'ADMITIDO',
  ADMITIDO: 'EN_GESTION',
  EN_GESTION: 'EN_TERRENO',
  EN_TERRENO: 'RESUELTO',
};

/** El backend usa el enum (EN_GESTION); la pantalla no tiene por que mostrar guiones bajos. */
export const ETIQUETA: Record<EstadoTramite, string> = {
  INGRESADO: 'Ingresado',
  ADMITIDO: 'Admitido',
  EN_GESTION: 'En gestión',
  EN_TERRENO: 'En terreno',
  RESUELTO: 'Resuelto',
  RECHAZADO: 'Rechazado',
};

/** Que significa cada paso para el vecino, en una linea. */
const DETALLE: Record<EstadoTramite, string> = {
  INGRESADO: 'Recibimos tu solicitud.',
  ADMITIDO: 'Cumple los requisitos y tomó un cupo del día.',
  EN_GESTION: 'Un funcionario la está trabajando.',
  EN_TERRENO: 'Una cuadrilla irá a la dirección indicada.',
  RESUELTO: 'Trámite cerrado. Te enviamos el certificado.',
  RECHAZADO: 'La solicitud no pudo seguir adelante.',
};

type EstadoParada = 'hecho' | 'actual' | 'pendiente' | 'omitido' | 'rechazado';

interface Edicion {
  tramiteId: number;
  estado: EstadoTramite;
  /** Valor de un <input type="datetime-local"> ("2026-10-20T09:30"), o "" sin fecha. */
  fecha: string;
  nota: string;
}

@Component({
  selector: 'app-requests',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <header class="page-head">
      <div>
        <p class="eyebrow">{{ esFuncionarioOAdmin ? 'Gestión municipal' : 'Tu espacio vecinal' }}</p>
        <h1>{{ esFuncionarioOAdmin ? 'Trámites del barrio' : 'Mis trámites' }}</h1>
        <p class="lead-sm">
          {{ esFuncionarioOAdmin
              ? 'Toca un trámite para ver su recorrido, programar fechas y dejar notas al vecino.'
              : 'Toca un trámite para ver en qué paso va y cuándo se espera el siguiente.' }}
        </p>
      </div>
      <button
        *ngIf="esVecinoOFuncionario"
        class="btn btn-primary btn-lg"
        type="button"
        (click)="formAbierto = !formAbierto"
        [attr.aria-expanded]="formAbierto"
        aria-controls="nuevo-tramite"
      >
        {{ formAbierto ? 'Cerrar' : '+ Nuevo trámite' }}
      </button>
    </header>

    <form id="nuevo-tramite" class="card form-nuevo" *ngIf="esVecinoOFuncionario && formAbierto" (ngSubmit)="crear()">
      <p class="card-title">Nuevo trámite</p>

      <!-- Funcionario: el vecino que no sabe hacerlo solo va a la municipalidad y el
           funcionario lo ingresa por el, con su correo. La auditoria registra a los dos. -->
      <div class="a-nombre" *ngIf="esFuncionario">
        <label class="check">
          <input type="checkbox" [(ngModel)]="aNombreDeVecino" name="aNombre" />
          Ingresarlo a nombre de un vecino
        </label>
        <ng-container *ngIf="aNombreDeVecino">
          <label for="vecino">Correo del vecino</label>
          <input id="vecino" type="email" [(ngModel)]="nuevo.vecinoUsername" name="vecinoUsername"
                 placeholder="vecino@duocuc.cl" required autocomplete="off" />
          <p class="hint">Quedará registrado que tú lo ingresaste a nombre de este vecino.</p>
        </ng-container>
      </div>

      <label for="tipo">Tipo de trámite</label>
      <select id="tipo" [(ngModel)]="nuevo.tipoId" name="tipoId" required>
        <option [ngValue]="null" disabled>Selecciona un tipo</option>
        <option *ngFor="let t of tipos" [ngValue]="t.id">{{ t.nombre }}</option>
      </select>
      <p class="hint" *ngIf="cupoDe(nuevo.tipoId) as c">
        <ng-container *ngIf="c.disponible > 0; else agotado">
          Quedan <b>{{ c.disponible }}</b> de {{ c.cupoDiario }} cupos hoy para este trámite.
        </ng-container>
        <ng-template #agotado>
          Cupo diario agotado ({{ c.cupoDiario }}/día). Igual puedes ingresarlo: quedará en espera
          hasta que el cupo se reinicie {{ textoReinicio(c) }}.
        </ng-template>
      </p>

      <label for="descripcion">Descripción</label>
      <!-- Los requisitos que el Admin definio para este tipo en el Catalogo. -->
      <p class="requisitos-hint" *ngIf="requisitosDe(nuevo.tipoId) as req">
        <b>Requisitos de este trámite:</b> {{ req }}
      </p>
      <textarea
        id="descripcion"
        [(ngModel)]="nuevo.descripcion"
        name="descripcion"
        [placeholder]="requisitosDe(nuevo.tipoId) ?? 'Cuéntanos qué necesitas'"
        required
      ></textarea>

      <label for="direccion">Dirección</label>
      <input id="direccion" [(ngModel)]="nuevo.direccion" name="direccion" placeholder="Calle y número" />

      <button type="submit" class="btn btn-primary" [disabled]="enviando || !formValido">
        {{ enviando ? 'Ingresando…' : 'Ingresar trámite' }}
      </button>
    </form>

    <p class="aviso-error" *ngIf="error" role="alert">{{ error }}</p>

    <!-- Fallo de carga: NO se muestra el estado vacio, que haria creer que no hay tramites -->
    <div class="load-error" *ngIf="errorCarga && !cargando">
      <p>{{ errorCarga }}</p>
      <button class="btn btn-outline btn-sm" (click)="cargar()">Reintentar</button>
    </div>

    <div class="lista-tramites" *ngIf="cargando" aria-hidden="true">
      <div class="tramite tramite-skeleton" *ngFor="let fila of filasSkeleton">
        <span class="skeleton skeleton-sm"></span>
        <span class="skeleton skeleton-lg"></span>
        <span class="skeleton skeleton-badge"></span>
      </div>
    </div>

    <ng-container *ngIf="!cargando && !errorCarga">
      <div class="filtros" *ngIf="tramites.length">
        <div class="chips" role="group" aria-label="Filtrar por estado">
          <button type="button" class="chip" [class.on]="!filtroEstado" (click)="filtroEstado = ''">
            Todos <span>{{ tramites.length }}</span>
          </button>
          <ng-container *ngFor="let e of ESTADOS">
            <button
              type="button"
              *ngIf="contar(e) as n"
              class="chip"
              [ngClass]="e"
              [class.on]="filtroEstado === e"
              (click)="filtroEstado = filtroEstado === e ? '' : e"
            >
              {{ etiqueta(e) }} <span>{{ n }}</span>
            </button>
          </ng-container>
        </div>

        <label class="sr-only" for="f-tipo">Tipo</label>
        <select id="f-tipo" class="filtro-select" [(ngModel)]="filtroTipo" name="filtroTipo">
          <option [ngValue]="''">Todos los tipos</option>
          <option *ngFor="let c of cupos.values()" [ngValue]="c.tipoId">{{ c.nombre }}</option>
        </select>
      </div>

      <div class="lista-tramites" *ngIf="filtrados.length; else vacio">
        <article
          *ngFor="let t of filtrados; trackBy: trackById"
          class="tramite"
          [class.abierto]="abiertos.has(t.id)"
          [class.optimista]="esOptimista(t)"
          [ngClass]="'borde-' + t.estado"
        >
          <button
            type="button"
            class="tramite-head"
            (click)="alternar(t)"
            [disabled]="esOptimista(t)"
            [attr.aria-expanded]="abiertos.has(t.id)"
            [attr.aria-controls]="'seg-' + t.id"
          >
            <span class="tramite-id">{{ esOptimista(t) ? '…' : '#' + t.id }}</span>
            <span class="tramite-main">
              <span class="tramite-tipo">{{ nombreTipo(t.tipoId) }}</span>
              <span class="tramite-desc">{{ t.descripcion }}</span>
              <span class="tramite-meta">
                Ingresado {{ t.fechaIngreso | date: 'd MMM y, HH:mm' }}
                <ng-container *ngIf="esFuncionarioOAdmin"> · {{ usuario(t.vecinoUsername) }}</ng-container>
                <ng-container *ngIf="t.creadoPor"> · ingresado por {{ usuario(t.creadoPor) }}</ng-container>
              </span>
            </span>
            <span class="badge" [ngClass]="t.estado">{{ etiqueta(t.estado) }}</span>
            <span class="chevron" aria-hidden="true"></span>
          </button>

          <section class="seguimiento" *ngIf="abiertos.has(t.id)" [id]="'seg-' + t.id">
            <p class="muted" *ngIf="cargandoPasos.has(t.id)">Cargando el recorrido…</p>
            <p class="aviso-error" *ngIf="errorPasos.get(t.id) as err">{{ err }}</p>

            <!-- Linea de metro: cada estacion es un paso. Llena = cumplido; con anillo =
                 donde va el tramite; hueca = lo que falta, con su fecha estimada si la hay. -->
            <ol class="metro" *ngIf="pasosVisibles(t) as lista">
              <li *ngFor="let p of lista" class="parada" [ngClass]="parada(t, p)">
                <span class="estacion" aria-hidden="true"></span>
                <div class="parada-cuerpo">
                  <p class="parada-titulo">
                    {{ etiqueta(p.estado) }}
                    <span class="parada-tag" *ngIf="parada(t, p) === 'actual'">Aquí va</span>
                  </p>
                  <p class="parada-detalle">{{ detalle(p.estado) }}</p>

                  <p class="parada-fecha" *ngIf="p.fechaCumplido">
                    <b>Cumplido</b> el {{ p.fechaCumplido | date: "EEEE d 'de' MMMM, HH:mm" }}
                  </p>
                  <p class="parada-fecha estimada" *ngIf="!p.fechaCumplido && p.fechaEstimada && parada(t, p) !== 'omitido'">
                    <b>Estimado</b> para el {{ p.fechaEstimada | date: "EEEE d 'de' MMMM, HH:mm" }}
                  </p>
                  <p class="parada-fecha sin-fecha" *ngIf="!p.fechaCumplido && !p.fechaEstimada && parada(t, p) === 'pendiente'">
                    Sin fecha estimada todavía
                  </p>

                  <blockquote class="parada-nota" *ngIf="p.nota">
                    {{ p.nota }}
                    <cite *ngIf="p.actualizadoPor && esFuncionarioOAdmin">— {{ usuario(p.actualizadoPor) }}</cite>
                  </blockquote>

                  <!-- Funcionario: fecha estimada y nota de los pasos que faltan (y la nota de los cumplidos). -->
                  <ng-container *ngIf="esFuncionarioOAdmin && parada(t, p) !== 'omitido'">
                    <button
                      *ngIf="!editandoEste(t, p)"
                      type="button"
                      class="btn-link"
                      (click)="editar(t, p)"
                    >{{ p.fechaCumplido ? 'Editar nota' : 'Programar fecha y nota' }}</button>

                    <form class="editor-paso" *ngIf="editandoEste(t, p) && edicion as ed" (ngSubmit)="guardarPaso(t)">
                      <ng-container *ngIf="!p.fechaCumplido">
                        <label [for]="'fecha-' + t.id + p.estado">Fecha estimada</label>
                        <input [id]="'fecha-' + t.id + p.estado" type="datetime-local" [(ngModel)]="ed.fecha" name="fecha" />
                      </ng-container>
                      <label [for]="'nota-' + t.id + p.estado">Nota para el vecino</label>
                      <textarea [id]="'nota-' + t.id + p.estado" [(ngModel)]="ed.nota" name="nota" maxlength="500"
                                placeholder="Ej.: la cuadrilla pasará en la mañana"></textarea>
                      <div class="row-actions">
                        <button type="submit" class="btn btn-primary btn-sm" [disabled]="guardandoPaso">
                          {{ guardandoPaso ? 'Guardando…' : 'Guardar' }}
                        </button>
                        <button type="button" class="btn btn-ghost btn-sm btn-cancelar" (click)="edicion = null">Cancelar</button>
                      </div>
                    </form>
                  </ng-container>
                </div>
              </li>
            </ol>

            <dl class="ficha">
              <div *ngIf="t.direccion"><dt>Dirección</dt><dd>{{ t.direccion }}</dd></div>
              <div *ngIf="esFuncionarioOAdmin"><dt>Vecino</dt><dd>{{ t.vecinoUsername }}</dd></div>
              <div *ngIf="t.funcionarioAsignado"><dt>Último funcionario</dt><dd>{{ t.funcionarioAsignado }}</dd></div>
              <div *ngIf="t.creadoPor"><dt>Ingresado por</dt><dd>{{ t.creadoPor }} (a nombre del vecino)</dd></div>
            </dl>

            <!-- Acciones del funcionario: avanzar o rechazar, con una nota opcional para el vecino. -->
            <div class="acciones" *ngIf="esFuncionarioOAdmin && puedeRechazar(t.estado)">
              <label [for]="'nota-avance-' + t.id">Nota al cambiar de estado <span class="opcional">(opcional)</span></label>
              <textarea
                [id]="'nota-avance-' + t.id"
                [ngModel]="notaAvance.get(t.id) ?? ''"
                (ngModelChange)="notaAvance.set(t.id, $event)"
                [name]="'notaAvance' + t.id"
                maxlength="500"
                placeholder="Lo verá el vecino en su seguimiento"
              ></textarea>
              <div class="row-actions">
                <ng-container *ngIf="siguienteEstado(t.estado) as sig">
                  <!-- Admitir consume cupo: si no queda, se bloquea aqui y se explica por que. -->
                  <button
                    class="btn btn-primary btn-sm btn-accion"
                    [disabled]="actualizando.has(t.id) || sinCupo(t, sig)"
                    [title]="sinCupo(t, sig) ? 'Sin cupo disponible hoy para este tipo de trámite' : ''"
                    (click)="avanzar(t, sig)"
                  >
                    {{ actualizando.has(t.id) ? 'Guardando…' : 'Pasar a ' + etiqueta(sig) }}
                  </button>
                </ng-container>
                <button class="btn btn-danger btn-sm btn-accion" [disabled]="actualizando.has(t.id)" (click)="avanzar(t, 'RECHAZADO')">
                  Rechazar
                </button>
                <a *ngIf="puedeVerAuditoria" class="btn-link" [routerLink]="'/audit'" [queryParams]="{ persona: t.vecinoUsername }">
                  Ver historial del vecino →
                </a>
              </div>
              <p class="sin-cupo" *ngIf="cupoAgotadoDe(t) as c">Sin cupo hoy · se reinicia {{ textoReinicio(c) }}</p>
            </div>
            <p class="acciones-fin" *ngIf="esFuncionarioOAdmin && !puedeRechazar(t.estado) && puedeVerAuditoria">
              <a class="btn-link" [routerLink]="'/audit'" [queryParams]="{ persona: t.vecinoUsername }">Ver historial del vecino →</a>
            </p>
          </section>
        </article>
      </div>
      <ng-template #vacio>
        <div class="vacio">
          <p>{{ tramites.length ? 'Ningún trámite coincide con el filtro.' : 'Todavía no hay trámites.' }}</p>
          <button *ngIf="!tramites.length && esVecinoOFuncionario" class="btn btn-outline btn-sm" (click)="formAbierto = true">
            Ingresar el primero
          </button>
        </div>
      </ng-template>
    </ng-container>
  `,
})
export class RequestsComponent implements OnInit {
  tramites: Tramite[] = [];
  tipos: TipoTramite[] = [];
  /** Cupo del dia por tipoId; lo usa el formulario y cada tarjeta. */
  cupos = new Map<number, CupoInfo>();
  cargando = true;
  /** Separado de `error` (acciones): distingue "no se pudo cargar" de "no hay datos". */
  errorCarga = '';
  error = '';
  esVecinoOFuncionario = false;
  esFuncionarioOAdmin = false;
  esFuncionario = false;
  puedeVerAuditoria = false;
  enviando = false;
  username = '';
  formAbierto = false;
  aNombreDeVecino = false;
  filtroEstado: EstadoTramite | '' = '';
  filtroTipo: number | '' = '';
  readonly ESTADOS = Object.keys(ETIQUETA) as EstadoTramite[];
  readonly filasSkeleton = [1, 2, 3, 4];
  /** ids de tramites con un cambio de estado en curso (deshabilita sus botones). */
  actualizando = new Set<number>();
  nuevo: { tipoId: number | null; descripcion: string; direccion: string; vecinoUsername: string } = {
    tipoId: null,
    descripcion: '',
    direccion: '',
    vecinoUsername: '',
  };

  /** Tarjetas desplegadas; sobreviven al refresco periodico de la lista. */
  abiertos = new Set<number>();
  pasos = new Map<number, Paso[]>();
  cargandoPasos = new Set<number>();
  errorPasos = new Map<number, string>();
  notaAvance = new Map<number, string>();
  edicion: Edicion | null = null;
  guardandoPaso = false;

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private service: RequestsService,
    private catalogService: CatalogService,
    private session: SessionService,
  ) {}

  ngOnInit(): void {
    // takeUntilDestroyed: sin esto la suscripcion sobrevivia al componente y
    // cada visita a la pantalla sumaba una mas (y con ella otra carga del catalogo).
    this.session.estado$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((s) => {
      if (s.cargando) return;
      this.username = s.username;
      this.esVecinoOFuncionario = s.roles.includes('Vecino') || s.roles.includes('Funcionario');
      this.esFuncionarioOAdmin = s.roles.includes('Funcionario') || s.roles.includes('Admin');
      this.esFuncionario = s.roles.includes('Funcionario');
      this.puedeVerAuditoria = ['Admin', 'Auditor', 'Funcionario'].some((r) => s.roles.includes(r));
      this.catalogService.listar().subscribe({ next: (data) => (this.tipos = data) });
      this.cargarCupos();
    });
    this.cargar();
    // Refresco silencioso (sin spinner ni error) para ver los tramites nuevos sin F5.
    // ponytail: polling cada 10 s en vez de WebSocket/SSE -- HTTP API Gateway no
    // soporta WebSocket y corta SSE a los 30 s.
    interval(10_000)
      .pipe(
        switchMap(() => this.service.listar().pipe(catchError(() => EMPTY))), // un fallo no mata el polling
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((data) => (this.tramites = this.conservarOptimistas(data)));
  }

  cargar(): void {
    this.cargando = true;
    this.errorCarga = '';
    this.service.listar()
      .pipe(finalize(() => (this.cargando = false)))
      .subscribe({
        next: (data) => (this.tramites = data),
        error: (e) => {
          this.errorCarga = e.error?.detail ?? `No se pudieron cargar los trámites (${e.status}).`;
        },
      });
  }

  /** El polling no puede borrar un tramite que se esta creando (todavia sin id real). */
  private conservarOptimistas(data: Tramite[]): Tramite[] {
    return [...this.tramites.filter((t) => this.esOptimista(t)), ...data];
  }

  trackById(_i: number, t: Tramite): number {
    return t.id;
  }

  cargarCupos(): void {
    this.service.cupos().subscribe({
      next: (lista) => (this.cupos = new Map(lista.map((c) => [c.tipoId, c]))),
      // El cupo es informativo: si falla, la lista y el formulario siguen usables.
      error: () => this.cupos.clear(),
    });
  }

  cupoDe(tipoId: number | null): CupoInfo | undefined {
    return tipoId == null ? undefined : this.cupos.get(tipoId);
  }

  nombreTipo(tipoId: number): string {
    return this.cupos.get(tipoId)?.nombre ?? this.tipos.find((t) => t.id === tipoId)?.nombre ?? `Tipo #${tipoId}`;
  }

  etiqueta(estado: EstadoTramite): string {
    return ETIQUETA[estado];
  }

  detalle(estado: EstadoTramite): string {
    return DETALLE[estado];
  }

  contar(estado: EstadoTramite): number {
    return this.tramites.filter((t) => t.estado === estado).length;
  }

  /** Solo la parte local del correo: todas las cuentas comparten dominio. El correo completo va en la ficha. */
  usuario(email: string | null | undefined): string {
    return email ? email.split('@')[0] : '';
  }

  /** Requisitos que el Admin definio para el tipo en el Catalogo; guian que escribir. */
  requisitosDe(tipoId: number | null): string | null {
    if (tipoId == null) return null;
    const requisitos = this.tipos.find((t) => t.id === tipoId)?.requisitos;
    return requisitos?.trim() ? requisitos : null;
  }

  get formValido(): boolean {
    const base = this.nuevo.tipoId != null && !!this.nuevo.descripcion.trim();
    return base && (!this.aNombreDeVecino || /^\S+@\S+\.\S+$/.test(this.nuevo.vecinoUsername.trim()));
  }

  /** Filtro en memoria: la lista es chica y asi responde sin ida y vuelta al backend. */
  get filtrados(): Tramite[] {
    return this.tramites.filter(
      (t) =>
        (!this.filtroEstado || t.estado === this.filtroEstado) &&
        (this.filtroTipo === '' || t.tipoId === this.filtroTipo),
    );
  }

  // ---------- seguimiento ----------

  alternar(t: Tramite): void {
    if (this.abiertos.has(t.id)) {
      this.abiertos.delete(t.id);
      return;
    }
    this.abiertos.add(t.id);
    this.cargarPasos(t.id);
  }

  private cargarPasos(id: number): void {
    this.cargandoPasos.add(id);
    this.errorPasos.delete(id);
    this.service.seguimiento(id)
      .pipe(finalize(() => this.cargandoPasos.delete(id)))
      .subscribe({
        next: (lista) => this.pasos.set(id, lista),
        error: (e) => this.errorPasos.set(id, e.error?.detail ?? `No se pudo cargar el recorrido (${e.status}).`),
      });
  }

  /**
   * Un tramite rechazado no muestra los pasos que nunca alcanzo (se leia como si
   * hubiera pasado por "Resuelto"): solo lo cumplido y el rechazo.
   */
  pasosVisibles(t: Tramite): Paso[] | undefined {
    const lista = this.pasos.get(t.id);
    if (!lista || t.estado !== 'RECHAZADO') return lista;
    return lista.filter((p) => p.fechaCumplido || p.estado === 'RECHAZADO');
  }

  /** Como se dibuja la estacion de un paso en la linea. */
  parada(t: Tramite, p: Paso): EstadoParada {
    if (p.estado === 'RECHAZADO') return 'rechazado';
    if (p.estado === t.estado) return 'actual';
    if (p.fechaCumplido) return 'hecho';
    return t.estado === 'RECHAZADO' ? 'omitido' : 'pendiente';
  }

  editandoEste(t: Tramite, p: Paso): boolean {
    return this.edicion?.tramiteId === t.id && this.edicion.estado === p.estado;
  }

  editar(t: Tramite, p: Paso): void {
    this.edicion = { tramiteId: t.id, estado: p.estado, fecha: aInputLocal(p.fechaEstimada), nota: p.nota ?? '' };
  }

  guardarPaso(t: Tramite): void {
    const ed = this.edicion;
    if (!ed || this.guardandoPaso) return;
    this.guardandoPaso = true;
    this.error = '';
    this.service.planificar(t.id, ed.estado, ed.fecha ? new Date(ed.fecha).toISOString() : null, ed.nota)
      .pipe(finalize(() => (this.guardandoPaso = false)))
      .subscribe({
        next: (lista) => {
          this.pasos.set(t.id, lista);
          this.edicion = null;
        },
        error: (e) => (this.error = e.error?.detail ?? `No se pudo guardar el paso (${e.status})`),
      });
  }

  // ---------- cupos y transiciones ----------

  /** Solo admitir consume cupo; el resto de las transiciones no. */
  sinCupo(t: Tramite, siguiente: EstadoTramite): boolean {
    if (siguiente !== 'ADMITIDO') return false;
    const c = this.cupos.get(t.tipoId);
    return !!c && c.disponible <= 0;
  }

  /** Devuelve el cupo solo si esta agotado y este tramite espera ser admitido. */
  cupoAgotadoDe(t: Tramite): CupoInfo | undefined {
    return this.sinCupo(t, 'ADMITIDO') && this.siguienteEstado(t.estado) === 'ADMITIDO'
      ? this.cupos.get(t.tipoId)
      : undefined;
  }

  /** "a las 00:00 (en 8 h 20 min)" -- la hora la define el backend segun su zona. */
  textoReinicio(c: CupoInfo): string {
    const reinicia = new Date(c.reinicia);
    // hour12:false -> "00:00" y no "12:00 a. m.", que se lee como mediodia.
    const hora = reinicia.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false });
    const minutos = Math.max(0, Math.round((reinicia.getTime() - Date.now()) / 60000));
    const falta = minutos >= 60 ? `${Math.floor(minutos / 60)} h ${minutos % 60} min` : `${minutos} min`;
    return `a las ${hora} (en ${falta})`;
  }

  /** Un tramite optimista es el placeholder local que se muestra antes de que el backend confirme la creacion. */
  esOptimista(t: Tramite): boolean {
    return t.id < 0;
  }

  crear(): void {
    // Guarda contra doble envio: Enter dispara ngSubmit, y si despues tambien
    // se hace clic en el boton (o se aprieta Enter dos veces) se duplicaba el tramite.
    if (this.enviando || !this.formValido || this.nuevo.tipoId == null) return;
    this.enviando = true;
    this.error = '';

    const vecino = this.aNombreDeVecino ? this.nuevo.vecinoUsername.trim() : '';
    const cuerpo = {
      tipoId: this.nuevo.tipoId,
      descripcion: this.nuevo.descripcion,
      direccion: this.nuevo.direccion,
      ...(vecino ? { vecinoUsername: vecino } : {}),
    };
    this.nuevo = { tipoId: null, descripcion: '', direccion: '', vecinoUsername: '' };
    this.aNombreDeVecino = false;
    this.formAbierto = false;

    // Optimistic update: se muestra de inmediato, sin esperar la respuesta del backend.
    const tempId = -Date.now();
    const optimista: Tramite = {
      id: tempId,
      tipoId: cuerpo.tipoId,
      vecinoUsername: vecino || this.username,
      descripcion: cuerpo.descripcion,
      direccion: cuerpo.direccion || null,
      estado: 'INGRESADO',
      funcionarioAsignado: null,
      fechaIngreso: new Date().toISOString(),
      fechaAdmision: null,
      fechaResolucion: null,
      creadoPor: vecino ? this.username : null,
    };
    this.tramites = [optimista, ...this.tramites];

    // finalize corre en exito, error y cancelacion: el boton no puede quedar trabado.
    this.service.crear(cuerpo)
      .pipe(finalize(() => (this.enviando = false)))
      .subscribe({
        next: (real) => {
          this.tramites = this.tramites.map((t) => (t.id === tempId ? real : t));
        },
        error: (e) => {
          this.tramites = this.tramites.filter((t) => t.id !== tempId);
          this.error = e.error?.detail ?? `No se pudo crear (${e.status})`;
          // El backend pudo haber alcanzado a guardarlo aunque la respuesta fallara
          // (timeout, 503): se re-sincroniza en vez de confiar en el rollback local.
          this.cargar();
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
    this.error = '';
    const anterior = t.estado;
    t.estado = nuevo; // optimistic: el badge y los botones cambian de inmediato

    this.service.cambiarEstado(t.id, nuevo, this.notaAvance.get(t.id))
      .pipe(finalize(() => this.actualizando.delete(t.id)))
      .subscribe({
        next: (real) => {
          Object.assign(t, real);
          this.notaAvance.delete(t.id);
          if (this.abiertos.has(t.id)) this.cargarPasos(t.id);
          // Admitir consume un cupo: hay que reflejarlo en las demas tarjetas del mismo tipo.
          if (nuevo === 'ADMITIDO') this.cargarCupos();
        },
        error: (e) => {
          t.estado = anterior;
          this.error = e.error?.detail ?? `No se pudo cambiar el estado (${e.status})`;
          // Igual que al crear: el cambio pudo haberse aplicado en la BD aunque
          // la respuesta no llegara, asi que la verdad la trae el servidor.
          this.cargar();
        },
      });
  }
}

/** Instant ISO -> valor de <input type="datetime-local"> en la hora local del navegador. */
function aInputLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}T${dos(d.getHours())}:${dos(d.getMinutes())}`;
}
