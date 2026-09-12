import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs/operators';
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

/** El backend usa el enum (EN_GESTION); la pantalla no tiene por que mostrar guiones bajos. */
const ETIQUETA: Record<EstadoTramite, string> = {
  INGRESADO: 'Ingresado',
  ADMITIDO: 'Admitido',
  EN_GESTION: 'En gestión',
  EN_TERRENO: 'En terreno',
  RESUELTO: 'Resuelto',
  RECHAZADO: 'Rechazado',
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
      <select id="tipo" [(ngModel)]="nuevo.tipoId" name="tipoId" required>
        <option [ngValue]="null" disabled>Selecciona un tipo</option>
        <option *ngFor="let t of tipos" [ngValue]="t.id">{{ t.nombre }}</option>
      </select>
      <p class="muted cupo-hint" *ngIf="cupoDe(nuevo.tipoId) as c">
        <ng-container *ngIf="c.disponible > 0; else agotado">
          Quedan <b>{{ c.disponible }}</b> de {{ c.cupoDiario }} cupos hoy para este trámite.
        </ng-container>
        <ng-template #agotado>
          Cupo diario agotado ({{ c.cupoDiario }}/día) — igual puedes ingresarlo, quedará en espera
          hasta que el cupo se reinicie {{ textoReinicio(c) }}.
        </ng-template>
      </p>

      <label for="descripcion">Descripción</label>
      <!-- Los requisitos que el Admin definio para este tipo en el Catalogo:
           es la guia de que tiene que escribir el vecino, no un texto generico. -->
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

      <button type="submit" class="btn btn-primary" [disabled]="enviando">
        {{ enviando ? 'Ingresando…' : 'Ingresar trámite' }}
      </button>
    </form>

    <p class="muted" *ngIf="error">{{ error }}</p>

    <!-- Fallo de carga: NO se muestra el estado vacio, que haria creer que no hay tramites -->
    <div class="load-error" *ngIf="errorCarga && !cargando">
      <p>{{ errorCarga }}</p>
      <button class="btn btn-outline btn-sm" (click)="cargar()">Reintentar</button>
    </div>

    <!-- Skeleton: misma estructura que la tabla real para que no salte el layout -->
    <div class="tabla-scroll" *ngIf="cargando">
      <table class="skeleton-table" aria-hidden="true">
      <thead>
        <tr><th>ID</th><th>Tipo</th><th>Vecino</th><th>Descripción</th><th>Estado</th><th>Funcionario</th><th *ngIf="esFuncionarioOAdmin"></th></tr>
      </thead>
      <tbody>
        <tr *ngFor="let fila of filasSkeleton">
          <td><span class="skeleton skeleton-sm"></span></td>
          <td><span class="skeleton"></span></td>
          <td><span class="skeleton"></span></td>
          <td><span class="skeleton skeleton-lg"></span></td>
          <td><span class="skeleton skeleton-badge"></span></td>
          <td><span class="skeleton"></span></td>
          <td *ngIf="esFuncionarioOAdmin"><span class="skeleton skeleton-btn"></span></td>
        </tr>
      </tbody>
      </table>
    </div>

    <ng-container *ngIf="!cargando && !errorCarga">
      <div class="filtros" *ngIf="tramites.length">
        <label for="f-estado">Estado</label>
        <select id="f-estado" class="filtro-select" [(ngModel)]="filtroEstado" name="filtroEstado">
          <option value="">Todos</option>
          <option *ngFor="let e of ESTADOS" [value]="e">{{ etiqueta(e) }}</option>
        </select>

        <label for="f-tipo">Tipo</label>
        <select id="f-tipo" class="filtro-select" [(ngModel)]="filtroTipo" name="filtroTipo">
          <option [ngValue]="''">Todos</option>
          <option *ngFor="let c of cupos.values()" [ngValue]="c.tipoId">{{ c.nombre }}</option>
        </select>

        <span class="filtros-conteo">{{ filtrados.length }} de {{ tramites.length }}</span>
        <button class="btn btn-ghost btn-sm btn-cancelar" *ngIf="filtroEstado || filtroTipo !== ''" (click)="limpiarFiltros()">
          Limpiar
        </button>
      </div>

      <div class="tabla-scroll" *ngIf="filtrados.length; else vacio">
        <table>
        <thead>
          <tr><th>ID</th><th>Tipo</th><th>Vecino</th><th>Descripción</th><th>Estado</th><th>Funcionario</th><th *ngIf="esFuncionarioOAdmin"></th></tr>
        </thead>
        <tbody>
          <tr *ngFor="let t of filtrados; trackBy: trackById" [class.optimista]="esOptimista(t)">
            <td>{{ esOptimista(t) ? '…' : t.id }}</td>
            <td class="col-tipo">
              <ng-container *ngIf="cupos.get(t.tipoId) as c; else tipoDesconocido">
                {{ c.nombre }}
                <span class="cupo-fila" [class.cupo-agotado]="c.disponible <= 0">
                  {{ c.admitidosHoy }}/{{ c.cupoDiario }} cupos hoy
                </span>
              </ng-container>
              <ng-template #tipoDesconocido><span class="muted">#{{ t.tipoId }}</span></ng-template>
            </td>
            <td [title]="t.vecinoUsername">{{ usuario(t.vecinoUsername) }}</td>
            <td>{{ t.descripcion }}</td>
            <td><span class="badge" [ngClass]="t.estado">{{ etiqueta(t.estado) }}</span></td>
            <td [title]="t.funcionarioAsignado ?? ''">{{ usuario(t.funcionarioAsignado) }}</td>
            <td *ngIf="esFuncionarioOAdmin">
              <div class="row-actions" *ngIf="!esOptimista(t)">
                <ng-container *ngIf="siguienteEstado(t.estado) as sig">
                  <!-- Admitir consume cupo: si no queda, se bloquea aqui y se explica por que,
                       en vez de dejar pulsar y responder 409 con el mensaje lejos de la fila. -->
                  <button
                    class="btn btn-outline btn-sm btn-accion"
                    [disabled]="actualizando.has(t.id) || sinCupo(t, sig)"
                    [title]="sinCupo(t, sig) ? 'Sin cupo disponible hoy para este tipo de trámite' : ''"
                    (click)="avanzar(t, sig)"
                  >
                    {{ actualizando.has(t.id) ? 'Guardando…' : '→ ' + etiqueta(sig) }}
                  </button>
                </ng-container>
                <button class="btn btn-danger btn-sm btn-accion" *ngIf="puedeRechazar(t.estado)" [disabled]="actualizando.has(t.id)" (click)="avanzar(t, 'RECHAZADO')">Rechazar</button>
              </div>
              <p class="sin-cupo" *ngIf="cupoAgotadoDe(t) as c">
                Sin cupo hoy · se reinicia {{ textoReinicio(c) }}
              </p>
            </td>
          </tr>
        </tbody>
        </table>
      </div>
      <ng-template #vacio>
        <p class="muted">{{ tramites.length ? 'Ningún trámite coincide con el filtro.' : 'Sin trámites.' }}</p>
      </ng-template>
    </ng-container>
  `,
})
export class RequestsComponent implements OnInit {
  tramites: Tramite[] = [];
  tipos: TipoTramite[] = [];
  /** Cupo del dia por tipoId; lo usa el formulario y cada fila de la tabla. */
  cupos = new Map<number, CupoInfo>();
  cargando = true;
  /** Separado de `error` (acciones): distingue "no se pudo cargar" de "no hay datos". */
  errorCarga = '';
  error = '';
  esVecinoOFuncionario = false;
  esFuncionarioOAdmin = false;
  enviando = false;
  username = '';
  filtroEstado: EstadoTramite | '' = '';
  filtroTipo: number | '' = '';
  readonly ESTADOS = Object.keys(ETIQUETA) as EstadoTramite[];
  readonly filasSkeleton = [1, 2, 3, 4];
  /** ids de tramites con un cambio de estado en curso (deshabilita sus botones). */
  actualizando = new Set<number>();
  nuevo: { tipoId: number | null; descripcion: string; direccion: string } = {
    tipoId: null,
    descripcion: '',
    direccion: '',
  };

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
      this.username = s.username;
      this.esVecinoOFuncionario = s.roles.includes('Vecino') || s.roles.includes('Funcionario');
      this.esFuncionarioOAdmin = s.roles.includes('Funcionario') || s.roles.includes('Admin');
      if (this.esVecinoOFuncionario) {
        this.catalogService.listar().subscribe({ next: (data) => (this.tipos = data) });
      }
      this.cargarCupos();
    });
    this.cargar();
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

  trackById(_i: number, t: Tramite): number {
    return t.id;
  }

  cargarCupos(): void {
    this.service.cupos().subscribe({
      next: (lista) => (this.cupos = new Map(lista.map((c) => [c.tipoId, c]))),
      // El cupo es informativo: si falla, la tabla y el formulario siguen usables.
      error: () => this.cupos.clear(),
    });
  }

  cupoDe(tipoId: number | null): CupoInfo | undefined {
    return tipoId == null ? undefined : this.cupos.get(tipoId);
  }

  etiqueta(estado: EstadoTramite): string {
    return ETIQUETA[estado];
  }

  /**
   * Solo la parte local del correo: todas las cuentas comparten dominio, y
   * repetirlo en dos columnas dejaba la tabla tan ancha que los botones de
   * accion quedaban fuera de la vista. El correo completo va en el title.
   */
  usuario(email: string | null): string {
    return email ? email.split('@')[0] : '';
  }

  /** Requisitos que el Admin definio para el tipo en el Catalogo; guian que escribir. */
  requisitosDe(tipoId: number | null): string | null {
    if (tipoId == null) return null;
    const requisitos = this.tipos.find((t) => t.id === tipoId)?.requisitos;
    return requisitos?.trim() ? requisitos : null;
  }

  /** Filtro en memoria: la lista es chica y asi responde sin ida y vuelta al backend. */
  get filtrados(): Tramite[] {
    return this.tramites.filter(
      (t) =>
        (!this.filtroEstado || t.estado === this.filtroEstado) &&
        (this.filtroTipo === '' || t.tipoId === this.filtroTipo),
    );
  }

  limpiarFiltros(): void {
    this.filtroEstado = '';
    this.filtroTipo = '';
  }

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
    if (this.enviando || this.nuevo.tipoId == null) return;
    this.enviando = true;
    this.error = '';

    const cuerpo = { tipoId: this.nuevo.tipoId, descripcion: this.nuevo.descripcion, direccion: this.nuevo.direccion };
    this.nuevo = { tipoId: null, descripcion: '', direccion: '' };

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
    t.estado = nuevo; // optimistic: el badge y el boton cambian de inmediato

    this.service.cambiarEstado(t.id, nuevo)
      .pipe(finalize(() => this.actualizando.delete(t.id)))
      .subscribe({
        next: (real) => {
          Object.assign(t, real);
          // Admitir consume un cupo: hay que reflejarlo en las demas filas del mismo tipo.
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
