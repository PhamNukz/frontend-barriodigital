import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { finalize } from 'rxjs/operators';
import { SessionService } from '../auth/session.service';
import { CatalogService, TipoTramite } from './catalog.service';

@Component({
  selector: 'app-catalog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h2>Catálogo de trámites</h2>

    <form class="card" *ngIf="esAdmin" (ngSubmit)="crear()">
      <p class="card-title">Nuevo tipo de trámite · rol Admin</p>

      <label for="nombre">Nombre</label>
      <input id="nombre" [(ngModel)]="nuevo.nombre" name="nombre" placeholder="Ej: Poda de árbol" required />

      <label for="requisitos">Requisitos</label>
      <textarea id="requisitos" [(ngModel)]="nuevo.requisitos" name="requisitos" placeholder="Qué debe adjuntar el vecino"></textarea>

      <label for="cupo">Cupo diario</label>
      <input id="cupo" [(ngModel)]="nuevo.cupoDiario" name="cupoDiario" type="number" min="0" required />

      <button type="submit" class="btn btn-primary" [disabled]="enviando">
        {{ enviando ? 'Creando…' : 'Crear tipo de trámite' }}
      </button>
    </form>

    <p class="muted" *ngIf="error">{{ error }}</p>

    <!-- Skeleton: misma estructura que la tabla real para que no salte el layout -->
    <table *ngIf="cargando" class="skeleton-table" aria-hidden="true">
      <thead>
        <tr><th>ID</th><th>Nombre</th><th>Requisitos</th><th>Cupo diario</th><th>Activo</th></tr>
      </thead>
      <tbody>
        <tr *ngFor="let fila of filasSkeleton">
          <td><span class="skeleton skeleton-sm"></span></td>
          <td><span class="skeleton"></span></td>
          <td><span class="skeleton skeleton-lg"></span></td>
          <td><span class="skeleton skeleton-sm"></span></td>
          <td><span class="skeleton skeleton-sm"></span></td>
        </tr>
      </tbody>
    </table>

    <ng-container *ngIf="!cargando">
      <table *ngIf="tipos.length; else vacio">
        <thead>
          <tr><th>ID</th><th>Nombre</th><th>Requisitos</th><th>Cupo diario</th><th>Activo</th></tr>
        </thead>
        <tbody>
          <tr *ngFor="let t of tipos; trackBy: trackById" [class.optimista]="esOptimista(t)">
            <td>{{ esOptimista(t) ? '…' : t.id }}</td><td>{{ t.nombre }}</td><td>{{ t.requisitos }}</td>
            <td>{{ t.cupoDiario }}</td><td>{{ t.activo ? 'Sí' : 'No' }}</td>
          </tr>
        </tbody>
      </table>
      <ng-template #vacio><p class="muted">Sin tipos de trámite registrados.</p></ng-template>
    </ng-container>
  `,
})
export class CatalogComponent implements OnInit {
  tipos: TipoTramite[] = [];
  cargando = true;
  error = '';
  esAdmin = false;
  enviando = false;
  readonly filasSkeleton = [1, 2, 3];
  nuevo = { nombre: '', requisitos: '', cupoDiario: 5 };

  private readonly destroyRef = inject(DestroyRef);

  constructor(private service: CatalogService, private session: SessionService) {}

  ngOnInit(): void {
    // Se resuscribe con cada cambio de cuenta desde la topbar, y se corta al
    // destruir el componente (sin esto quedaba viva por cada visita a la pantalla).
    this.session.estado$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((s) => (this.esAdmin = s.roles.includes('Admin')));
    this.cargar();
  }

  cargar(): void {
    this.cargando = true;
    this.service.listar()
      .pipe(finalize(() => (this.cargando = false)))
      .subscribe({
        next: (data) => (this.tipos = data),
        error: (e) => (this.error = e.error?.detail ?? `No se pudo cargar el catálogo (${e.status})`),
      });
  }

  trackById(_i: number, t: TipoTramite): number {
    return t.id;
  }

  esOptimista(t: TipoTramite): boolean {
    return t.id < 0;
  }

  crear(): void {
    if (this.enviando) return;
    this.enviando = true;
    this.error = '';

    const cuerpo = { ...this.nuevo };
    this.nuevo = { nombre: '', requisitos: '', cupoDiario: 5 };

    // Optimistic update: aparece al instante, sin esperar al backend ni recargar.
    const tempId = -Date.now();
    const optimista: TipoTramite = {
      id: tempId,
      nombre: cuerpo.nombre,
      requisitos: cuerpo.requisitos || null,
      cupoDiario: cuerpo.cupoDiario,
      activo: true,
    };
    this.tipos = [...this.tipos, optimista];

    this.service.crear(cuerpo)
      .pipe(finalize(() => (this.enviando = false)))
      .subscribe({
        next: (real) => {
          this.tipos = this.tipos.map((t) => (t.id === tempId ? real : t));
        },
        error: (e) => {
          this.tipos = this.tipos.filter((t) => t.id !== tempId);
          this.error = e.error?.detail ?? `No se pudo crear (${e.status})`;
          // Pudo haberse guardado aunque la respuesta fallara: la verdad la trae el servidor.
          this.cargar();
        },
      });
  }
}
