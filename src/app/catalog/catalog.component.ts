import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MsalService } from '@azure/msal-angular';
import { rolesDe } from '../auth/roles';
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

    <table *ngIf="tipos.length; else vacio">
      <thead>
        <tr><th>ID</th><th>Nombre</th><th>Requisitos</th><th>Cupo diario</th><th>Activo</th></tr>
      </thead>
      <tbody>
        <tr *ngFor="let t of tipos">
          <td>{{ t.id }}</td><td>{{ t.nombre }}</td><td>{{ t.requisitos }}</td>
          <td>{{ t.cupoDiario }}</td><td>{{ t.activo ? 'Sí' : 'No' }}</td>
        </tr>
      </tbody>
    </table>
    <ng-template #vacio><p class="muted">Sin tipos de trámite registrados.</p></ng-template>
  `,
})
export class CatalogComponent implements OnInit {
  tipos: TipoTramite[] = [];
  error = '';
  esAdmin = false;
  enviando = false;
  nuevo = { nombre: '', requisitos: '', cupoDiario: 5 };

  constructor(private service: CatalogService, private msal: MsalService) {}

  async ngOnInit(): Promise<void> {
    this.esAdmin = (await rolesDe(this.msal)).includes('Admin');
    this.cargar();
  }

  cargar(): void {
    this.service.listar().subscribe({
      next: (data) => (this.tipos = data),
      error: (e) => (this.error = `No se pudo cargar el catálogo (${e.status})`),
    });
  }

  crear(): void {
    if (this.enviando) return;
    this.enviando = true;
    this.service.crear(this.nuevo).subscribe({
      next: () => {
        this.enviando = false;
        this.nuevo = { nombre: '', requisitos: '', cupoDiario: 5 };
        this.cargar();
      },
      error: (e) => {
        this.enviando = false;
        this.error = e.error?.detail ?? `No se pudo crear (${e.status})`;
      },
    });
  }
}
