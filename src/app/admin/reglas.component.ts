import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs/operators';
import { SessionService } from '../auth/session.service';
import { CatalogService, TipoTramite } from '../catalog/catalog.service';
import { Reglas, RequestsService, Tramite } from '../requests/requests.service';
import { SeguimientoVecinoComponent } from '../vecino/seguimiento.component';

/** Como se nombra cada regla en el resumen de cambios y en el aviso. */
const NOMBRE: Record<keyof Reglas, (v: never) => string> = {
  mostrarNombreFuncionario: (v: boolean) => `Nombre del funcionario: ${v ? 'se muestra' : 'oculto'}`,
  mostrarRechazados: (v: boolean) => `Rechazados para el vecino: ${v ? 'visibles' : 'ocultos'}`,
  mesesHistorial: (v: number) => `Historial tras ${v} meses`,
  diasPapelera: (v: number) => `Papelera: ${v} días`,
  alVencer: (v: string) => `Al vencer: ${v === 'ANONIMIZAR' ? 'anonimizar' : 'borrar'}`,
  auditorRestaura: (v: boolean) => `Auditor restaura: ${v ? 'sí' : 'no'}`,
};

const CERRADOS = ['RESUELTO', 'RECHAZADO'];

/**
 * Admin B: reglas de que ve el vecino y de la papelera, con vista previa en vivo, mas las
 * listas de ocultos y de la papelera para restaurar (las reglas solas no borran nada).
 * El Auditor la ve en solo lectura y restaura solo si la regla `auditorRestaura` lo permite.
 */
@Component({
  selector: 'app-reglas',
  standalone: true,
  imports: [CommonModule, FormsModule, SeguimientoVecinoComponent],
  template: `
    <header class="page-head">
      <div>
        <p class="eyebrow">Administración</p>
        <h1>Reglas y papelera</h1>
        <p class="lead-sm">Nada se borra de verdad: ocultar y enviar a la papelera se puede deshacer, pide motivo y queda en la auditoría.
          A la derecha ve cómo queda la app de un vecino con las reglas que está editando.</p>
      </div>
    </header>

    <p class="rg-ok" *ngIf="aviso" role="status">{{ aviso }}</p>
    <p class="aviso-error" *ngIf="error" role="alert">{{ error }}</p>
    <p class="hint" *ngIf="!esAdmin">Está en modo de solo lectura: solo el Admin cambia reglas y tipos.</p>

    <div class="rg-layout">
      <div class="rg-main">
        <p class="rg-aviso" *ngIf="sinReglas">El backend todavía no tiene reglas de visibilidad. Los tipos de trámite sí se pueden administrar.</p>

        <ng-container *ngIf="borrador as b">
          <section class="rg-card" aria-label="Qué ve el vecino">
            <h2 class="rg-h">Qué ve el vecino</h2>
            <div class="rg-regla">
              <div><p class="rg-t">Nombre del funcionario a cargo</p><p class="rg-s">Si se apaga, el vecino no ve quién lleva su trámite ni quién lo ingresó en el mesón.</p></div>
              <button type="button" class="rg-sw" role="switch" [attr.aria-checked]="b.mostrarNombreFuncionario" [class.on]="b.mostrarNombreFuncionario"
                      [disabled]="!esAdmin" aria-label="Mostrar el nombre del funcionario" (click)="b.mostrarNombreFuncionario = !b.mostrarNombreFuncionario"></button>
            </div>
            <div class="rg-regla">
              <div><p class="rg-t">Trámites rechazados</p><p class="rg-s">Si se apaga, el vecino deja de verlos; el municipio y la auditoría sí.</p></div>
              <button type="button" class="rg-sw" role="switch" [attr.aria-checked]="b.mostrarRechazados" [class.on]="b.mostrarRechazados"
                      [disabled]="!esAdmin" aria-label="Mostrar los trámites rechazados" (click)="b.mostrarRechazados = !b.mostrarRechazados"></button>
            </div>
            <div class="rg-regla">
              <div><p class="rg-t">Mover a «Historial» los cerrados hace más de</p><p class="rg-s">No se borran: pasan a una sección aparte para que su lista sea corta.</p></div>
              <div class="rg-seg" role="group" aria-label="Meses para pasar al historial">
                <button type="button" *ngFor="let m of MESES" [class.on]="b.mesesHistorial === m" [attr.aria-pressed]="b.mesesHistorial === m"
                        [disabled]="!esAdmin" (click)="b.mesesHistorial = m">{{ m }} meses</button>
              </div>
            </div>
          </section>

          <section class="rg-card" aria-label="Papelera">
            <h2 class="rg-h">Papelera</h2>
            <div class="rg-regla">
              <div><p class="rg-t">Días en la papelera</p><p class="rg-s">Mientras tanto, todo se puede restaurar.</p></div>
              <div class="rg-seg" role="group" aria-label="Días en la papelera">
                <button type="button" *ngFor="let d of DIAS" [class.on]="b.diasPapelera === d" [attr.aria-pressed]="b.diasPapelera === d"
                        [disabled]="!esAdmin" (click)="b.diasPapelera = d">{{ d }}</button>
              </div>
            </div>
            <div class="rg-regla">
              <div>
                <p class="rg-t">Al cumplirse el plazo</p>
                <p class="rg-s">{{ b.alVencer === 'ANONIMIZAR' ? 'Se quitan nombre, correo y dirección; quedan tipo, fechas y estado para las estadísticas.' : 'Se elimina el registro; la auditoría guarda que existió.' }}
                  La regla queda guardada; el proceso automático todavía no está activo.</p>
              </div>
              <div class="rg-seg" role="group" aria-label="Qué hacer al cumplirse el plazo">
                <button type="button" [class.on]="b.alVencer === 'ANONIMIZAR'" [attr.aria-pressed]="b.alVencer === 'ANONIMIZAR'" [disabled]="!esAdmin" (click)="b.alVencer = 'ANONIMIZAR'">Anonimizar</button>
                <button type="button" [class.on]="b.alVencer === 'BORRAR'" [attr.aria-pressed]="b.alVencer === 'BORRAR'" [disabled]="!esAdmin" (click)="b.alVencer = 'BORRAR'">Borrar</button>
              </div>
            </div>
            <div class="rg-regla">
              <div><p class="rg-t">El Auditor también puede restaurar</p><p class="rg-s">El Admin siempre puede. El Auditor siempre ve la papelera.</p></div>
              <button type="button" class="rg-sw" role="switch" [attr.aria-checked]="b.auditorRestaura" [class.on]="b.auditorRestaura"
                      [disabled]="!esAdmin" aria-label="El Auditor puede restaurar" (click)="b.auditorRestaura = !b.auditorRestaura"></button>
            </div>
          </section>

          <div class="rg-guardar" *ngIf="esAdmin">
            <p>{{ cambios.length ? cambios.length + ' cambio(s) sin guardar: ' + cambios.join(' · ') : 'Sin cambios pendientes' }}</p>
            <div class="row-actions">
              <button type="button" class="btn btn-ghost btn-sm" [disabled]="!cambios.length || guardando" (click)="descartar()">Descartar</button>
              <button type="button" class="btn btn-primary btn-sm rg-btn-claro" [disabled]="!cambios.length || guardando" (click)="guardar()">
                {{ guardando ? 'Guardando…' : 'Guardar cambios' }}
              </button>
            </div>
          </div>
        </ng-container>

        <section class="rg-card" aria-label="Tipos de trámite">
          <h2 class="rg-h">Tipos de trámite que se pueden pedir</h2>
          <p class="muted" *ngIf="!tipos.length && !errorTipos">Cargando…</p>
          <p class="aviso-error" *ngIf="errorTipos">{{ errorTipos }}</p>
          <div class="rg-regla" *ngFor="let t of tipos; trackBy: porId">
            <div>
              <p class="rg-t">{{ t.nombre }}</p>
              <p class="rg-s">{{ t.activo ? 'Disponible' : 'Desactivado: no aparece para pedir' }} · {{ abiertos(t.id) }} trámite(s) abiertos</p>
              <p class="rg-alerta" *ngIf="t.activo && abiertos(t.id)">Si lo desactiva, esos trámites siguen su curso: solo deja de aparecer para pedir nuevos.</p>
            </div>
            <button type="button" class="rg-sw" role="switch" [attr.aria-checked]="t.activo" [class.on]="t.activo"
                    [disabled]="!esAdmin || guardandoTipo.has(t.id)" [attr.aria-label]="'Tipo ' + t.nombre + ' disponible'" (click)="alternarTipo(t)"></button>
          </div>
        </section>

        <ng-container *ngIf="conVisibilidad">
          <!-- Solo Admin: el Auditor no lista los tramites (ver contrato §6.2) -->
          <section class="rg-card" aria-label="Ocultos al vecino" *ngIf="esAdmin">
            <h2 class="rg-h">Ocultos al vecino ({{ ocultos.length }})</h2>
            <p class="rg-s" *ngIf="!ocultos.length">Ninguno. Se ocultan desde la ficha del trámite en el Tablero.</p>
            <div class="rg-item" *ngFor="let t of ocultos; trackBy: porId">
              <p class="rg-t">N° {{ t.id }} · {{ nombreTipo(t.tipoId) }} · {{ t.vecinoUsername }}</p>
              <p class="rg-s">Motivo: {{ t.motivoVisibilidad || '—' }}</p>
              <div class="rg-fila" *ngIf="esAdmin">
                <label class="sr-only" [for]="'mo-' + t.id">Motivo para volver a mostrar</label>
                <input [id]="'mo-' + t.id" class="rg-inp" maxlength="200" placeholder="Motivo (queda en la auditoría)"
                       [ngModel]="motivos.get(t.id) ?? ''" (ngModelChange)="motivos.set(t.id, $event)" [name]="'mo' + t.id" />
                <button type="button" class="btn btn-outline btn-sm" [disabled]="ocupado.has(t.id) || (motivos.get(t.id) ?? '').trim().length < 3"
                        (click)="mostrar(t)">Mostrar al vecino</button>
              </div>
            </div>
          </section>

          <section class="rg-card" aria-label="Papelera">
            <h2 class="rg-h">En la papelera ({{ papelera.length }})</h2>
            <p class="aviso-error" *ngIf="errorPapelera">{{ errorPapelera }}</p>
            <p class="rg-s" *ngIf="!papelera.length && !errorPapelera">Vacía. Se envía a la papelera desde la ficha del trámite en el Tablero.</p>
            <div class="rg-item" *ngFor="let t of papelera; trackBy: porId">
              <p class="rg-t">N° {{ t.id }} · {{ nombreTipo(t.tipoId) }} · {{ t.vecinoUsername }}</p>
              <p class="rg-s">Por {{ t.eliminadoPor || '—' }} el {{ t.eliminadoEn | date: 'd MMM y, HH:mm' }}<ng-container *ngIf="t.motivoVisibilidad"> · {{ t.motivoVisibilidad }}</ng-container></p>
              <p class="rg-s" *ngIf="reglas">Según la regla, se {{ reglas.alVencer === 'ANONIMIZAR' ? 'anonimiza' : 'borra' }} desde el {{ vence(t) | date: 'd MMM y' }}.</p>
              <div class="rg-fila" *ngIf="puedeRestaurar">
                <label class="sr-only" [for]="'mr-' + t.id">Motivo para restaurar</label>
                <input [id]="'mr-' + t.id" class="rg-inp" maxlength="200" placeholder="Motivo (queda en la auditoría)"
                       [ngModel]="motivos.get(t.id) ?? ''" (ngModelChange)="motivos.set(t.id, $event)" [name]="'mr' + t.id" />
                <button type="button" class="btn btn-primary btn-sm" [disabled]="ocupado.has(t.id) || (motivos.get(t.id) ?? '').trim().length < 3"
                        (click)="restaurar(t)">Restaurar</button>
              </div>
            </div>
          </section>
        </ng-container>
        <p class="rg-aviso" *ngIf="sinReglas">El backend todavía no tiene borrado lógico: no hay ocultos ni papelera que mostrar.</p>
      </div>

      <aside class="rg-preview" aria-label="Vista previa de la app del vecino" *ngIf="vecinos.length">
        <label class="rg-lbl" for="rg-vecino">Así lo ve</label>
        <select id="rg-vecino" class="rg-inp" [(ngModel)]="vecinoPreview" name="vecinoPreview">
          <option *ngFor="let v of vecinos" [value]="v">{{ v }}</option>
        </select>
        <p class="rg-s">Vista previa con las reglas que está editando (sin guardar todavía).</p>
        <div class="rg-phone">
          <app-seguimiento-vecino *ngIf="previewTramites.length; else vacioPreview" [tramites]="previewTramites" [nombreTipo]="nombreTipoFn"
                                  [soloLectura]="true" [mesesHistorial]="borrador?.mesesHistorial ?? null"></app-seguimiento-vecino>
          <ng-template #vacioPreview><p class="rg-s">Con estas reglas, este vecino no ve ningún trámite.</p></ng-template>
        </div>
      </aside>
    </div>
  `,
  styles: [`
    .rg-layout { display: flex; flex-wrap: wrap; gap: 18px; align-items: flex-start; }
    .rg-main { flex: 999 1 520px; min-width: 0; display: flex; flex-direction: column; gap: 14px; }
    .rg-preview { flex: 1 1 340px; min-width: 0; display: flex; flex-direction: column; gap: 8px; position: sticky; top: 84px; }
    .rg-card { background: var(--paper-raised); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px 18px; box-shadow: var(--shadow); display: flex; flex-direction: column; }
    .rg-h { margin: 0 0 6px; font-size: 1.2rem; }
    .rg-regla { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 10px 0; border-bottom: 1px dashed var(--line-strong); }
    .rg-regla:last-child { border-bottom: 0; }
    .rg-t { margin: 0; font-weight: 800; overflow-wrap: anywhere; }
    .rg-s { margin: 2px 0 0; font-size: 0.86rem; color: var(--ink-soft); }
    .rg-alerta { margin: 6px 0 0; padding: 6px 10px; border-radius: 8px; background: rgba(242, 177, 52, 0.25); color: #6d4b02; font-size: 0.82rem; font-weight: 700; }
    .rg-aviso { margin: 0; padding: 12px 14px; border-radius: 12px; background: rgba(242, 177, 52, 0.25); color: #6d4b02; font-weight: 600; }
    .rg-sw { position: relative; flex: none; width: 56px; height: 32px; border-radius: 16px; border: 0; background: #b9b19c; cursor: pointer; padding: 0; }
    .rg-sw::after { content: ""; position: absolute; top: 4px; left: 4px; width: 24px; height: 24px; border-radius: 50%; background: #fff; transition: left 0.15s; }
    .rg-sw.on { background: var(--teal); }
    .rg-sw.on::after { left: 28px; }
    .rg-sw:disabled { opacity: 0.55; cursor: not-allowed; }
    .rg-seg { display: flex; flex-wrap: wrap; gap: 4px; padding: 3px; border-radius: 12px; background: var(--paper-sunk); flex: none; }
    .rg-seg button { min-height: 38px; padding: 4px 12px; border-radius: 9px; border: 0; background: transparent; font: inherit; font-weight: 700; color: var(--ink); cursor: pointer; }
    .rg-seg button.on { background: var(--teal-deep); color: #fff; }
    .rg-seg button:disabled { cursor: not-allowed; }
    .rg-guardar { position: sticky; bottom: 12px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; border-radius: 14px; background: var(--teal-deep); color: #fff; box-shadow: var(--shadow-lift); }
    .rg-guardar p { margin: 0; font-weight: 700; }
    .rg-btn-claro { background: var(--signal) !important; color: var(--teal-night) !important; }
    .rg-ok { margin: 0 0 14px; padding: 12px 16px; border-radius: 12px; background: rgba(27, 100, 87, 0.15); color: #0f5a4c; font-weight: 700; }
    .rg-item { display: flex; flex-direction: column; gap: 4px; padding: 10px 0; border-bottom: 1px dashed var(--line-strong); }
    .rg-item:last-child { border-bottom: 0; }
    .rg-fila { display: flex; gap: 8px; margin-top: 4px; }
    .rg-inp { width: 100%; box-sizing: border-box; min-height: 40px; padding: 8px 10px; border-radius: 10px; border: 1.5px solid var(--line-strong); font: inherit; background: var(--paper); }
    .rg-fila .rg-inp { flex: 1; min-width: 0; }
    .rg-lbl { font-size: 0.74rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-soft); }
    .rg-phone { max-height: 720px; overflow-y: auto; padding: 14px; border-radius: 28px; border: 10px solid var(--ink); background: var(--paper); }
    @media (max-width: 900px) { .rg-preview { position: static; } }
  `],
})
export class ReglasComponent implements OnInit {
  readonly MESES: Reglas['mesesHistorial'][] = [6, 12, 24];
  readonly DIAS: Reglas['diasPapelera'][] = [30, 90, 180];

  esAdmin = false;
  esAuditor = false;
  reglas: Reglas | null = null;
  borrador: Reglas | null = null;
  sinReglas = false;
  guardando = false;
  aviso = '';
  error = '';

  tipos: TipoTramite[] = [];
  errorTipos = '';
  guardandoTipo = new Set<number>();
  tramites: Tramite[] = [];
  papelera: Tramite[] = [];
  errorPapelera = '';
  /** Motivo escrito por tramite (mostrar o restaurar). */
  motivos = new Map<number, string>();
  ocupado = new Set<number>();
  vecinoPreview = '';

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private service: RequestsService,
    private catalog: CatalogService,
    private session: SessionService,
  ) {}

  ngOnInit(): void {
    this.session.estado$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((s) => {
      if (s.cargando) return;
      this.esAdmin = s.roles.includes('Admin');
      this.esAuditor = s.roles.includes('Auditor');
    });
    this.service.reglas().subscribe({
      next: (r) => {
        this.reglas = r;
        this.borrador = { ...r };
        // Reglas = backend con §6: la papelera existe aunque el listado (Auditor) venga vacio.
        this.cargarPapelera();
      },
      // Backend sin §6: la pagina sigue sirviendo para los tipos de tramite.
      error: () => (this.sinReglas = true),
    });
    this.cargarTipos();
    this.cargarTramites();
  }

  // ---------- reglas ----------

  get cambios(): string[] {
    if (!this.reglas || !this.borrador) return [];
    return (Object.keys(NOMBRE) as (keyof Reglas)[])
      .filter((k) => this.reglas![k] !== this.borrador![k])
      .map((k) => NOMBRE[k](this.borrador![k] as never));
  }

  descartar(): void {
    if (this.reglas) this.borrador = { ...this.reglas };
  }

  guardar(): void {
    if (!this.borrador || !this.cambios.length || this.guardando) return;
    const resumen = this.cambios.join(' · ');
    this.guardando = true;
    this.error = '';
    this.aviso = '';
    this.service.guardarReglas(this.borrador)
      .pipe(finalize(() => (this.guardando = false)))
      .subscribe({
        next: (r) => {
          this.reglas = r;
          this.borrador = { ...r };
          this.aviso = `Reglas guardadas: ${resumen}. Se aplican de inmediato y quedaron en la auditoría.`;
        },
        error: (e) => (this.error = e.error?.detail ?? `No se pudieron guardar las reglas (${e.status}).`),
      });
  }

  // ---------- tipos (catalogo) ----------

  cargarTipos(): void {
    this.errorTipos = '';
    this.catalog.listar().subscribe({
      next: (t) => (this.tipos = t),
      error: (e) => (this.errorTipos = e.error?.detail ?? `No se pudo cargar el catálogo (${e.status}).`),
    });
  }

  alternarTipo(t: TipoTramite): void {
    if (!this.esAdmin || this.guardandoTipo.has(t.id)) return;
    this.guardandoTipo.add(t.id);
    this.error = '';
    this.catalog.actualizar(t.id, { requisitos: t.requisitos, cupoDiario: t.cupoDiario, activo: !t.activo })
      .pipe(finalize(() => this.guardandoTipo.delete(t.id)))
      .subscribe({
        next: (real) => {
          this.tipos = this.tipos.map((x) => (x.id === real.id ? real : x));
          this.aviso = `«${real.nombre}» ${real.activo ? 'vuelve a estar disponible' : 'ya no aparece para pedir'}.`;
        },
        error: (e) => (this.error = e.error?.detail ?? `No se pudo cambiar el tipo (${e.status}).`),
      });
  }

  abiertos(tipoId: number): number {
    return this.tramites.filter((t) => t.tipoId === tipoId && !CERRADOS.includes(t.estado)).length;
  }

  nombreTipo(tipoId: number): string {
    return this.tipos.find((t) => t.id === tipoId)?.nombre ?? `Tipo #${tipoId}`;
  }

  readonly nombreTipoFn = (tipoId: number): string => this.nombreTipo(tipoId);

  // ---------- ocultos y papelera ----------

  /** Backend con §6: responde las reglas (el Auditor no lista tramites, asi que no sirve mirar visibleVecino). */
  get conVisibilidad(): boolean {
    return !!this.reglas;
  }

  get ocultos(): Tramite[] {
    return this.tramites.filter((t) => t.visibleVecino === false);
  }

  get puedeRestaurar(): boolean {
    return this.esAdmin || (this.esAuditor && !!this.reglas?.auditorRestaura);
  }

  cargarTramites(): void {
    this.service.listar().subscribe({
      next: (data) => {
        this.tramites = data;
        if (!this.vecinoPreview || !this.vecinos.includes(this.vecinoPreview)) this.vecinoPreview = this.vecinos[0] ?? '';
      },
      error: (e) => (this.error = e.error?.detail ?? `No se pudieron cargar los trámites (${e.status}).`),
    });
  }

  cargarPapelera(): void {
    this.errorPapelera = '';
    this.service.papelera().subscribe({
      // Un backend que ignore ?papelera devolveria todo: se filtra por eliminadoEn por si acaso.
      next: (data) => (this.papelera = data.filter((t) => !!t.eliminadoEn)),
      error: (e) => (this.errorPapelera = e.error?.detail ?? `No se pudo cargar la papelera (${e.status}).`),
    });
  }

  private recargarListas(): void {
    this.cargarTramites();
    if (this.conVisibilidad) this.cargarPapelera();
  }

  /** Fecha desde la que la regla anonimiza o borra (informativo: el proceso automatico no esta activo). */
  vence(t: Tramite): Date {
    const d = new Date(t.eliminadoEn!);
    d.setDate(d.getDate() + (this.reglas?.diasPapelera ?? 90));
    return d;
  }

  mostrar(t: Tramite): void {
    const motivo = (this.motivos.get(t.id) ?? '').trim();
    if (motivo.length < 3 || this.ocupado.has(t.id)) return;
    this.hacer(t, this.service.cambiarVisibilidad(t.id, true, motivo), `N° ${t.id} vuelve a ser visible para el vecino.`);
  }

  restaurar(t: Tramite): void {
    const motivo = (this.motivos.get(t.id) ?? '').trim();
    if (motivo.length < 3 || this.ocupado.has(t.id)) return;
    this.hacer(t, this.service.restaurar(t.id, motivo), `N° ${t.id} restaurado con la visibilidad que tenía.`);
  }

  private hacer(t: Tramite, peticion: ReturnType<RequestsService['restaurar']>, ok: string): void {
    this.ocupado.add(t.id);
    this.error = '';
    this.aviso = '';
    peticion.pipe(finalize(() => this.ocupado.delete(t.id))).subscribe({
      next: () => {
        this.motivos.delete(t.id);
        this.aviso = ok + ' Quedó en la auditoría con el motivo.';
        this.recargarListas(); // pudo cambiar mas de una lista (de la papelera vuelve a ocultos o a activos)
      },
      // 409: otro admin ya lo restauro o lo mostro; se recarga para ver lo real.
      error: (e) => {
        this.error = e.error?.detail ?? `No se pudo guardar (${e.status}).`;
        this.recargarListas();
      },
    });
  }

  // ---------- vista previa ----------

  get vecinos(): string[] {
    return [...new Set(this.tramites.map((t) => t.vecinoUsername))].sort();
  }

  /** Lo que veria ese vecino con las reglas del borrador (el backend aplica lo mismo al guardarlas). */
  get previewTramites(): Tramite[] {
    const b = this.borrador;
    return this.tramites.filter((t) =>
      t.vecinoUsername === this.vecinoPreview &&
      t.visibleVecino !== false &&
      !t.eliminadoEn &&
      (!b || b.mostrarRechazados || t.estado !== 'RECHAZADO'));
  }

  porId(_i: number, x: { id: number }): number {
    return x.id;
  }
}
