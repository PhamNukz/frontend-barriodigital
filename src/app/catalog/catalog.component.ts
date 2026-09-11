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
      <strong>Nuevo tipo de trámite (rol Admin)</strong>
      <input [(ngModel)]="nuevo.nombre" name="nombre" placeholder="Nombre" required />
      <textarea [(ngModel)]="nuevo.requisitos" name="requisitos" placeholder="Requisitos"></textarea>
      <input [(ngModel)]="nuevo.cupoDiario" name="cupoDiario" type="number" placeholder="Cupo diario" required />
      <button type="submit">Crear</button>
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
    this.service.crear(this.nuevo).subscribe({
      next: () => {
        this.nuevo = { nombre: '', requisitos: '', cupoDiario: 5 };
        this.cargar();
      },
      error: (e) => (this.error = `No se pudo crear (${e.status})`),
    });
  }
}
