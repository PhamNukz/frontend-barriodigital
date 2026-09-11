import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MsalService } from '@azure/msal-angular';
import { rolesDe } from '../auth/roles';
import { CatalogService, TipoTramite } from '../catalog/catalog.service';
import { EstadoTramite, RequestsService, Tramite } from './requests.service';

/** Siguiente estado sugerido en la UI; el backend vuelve a validar la transicion. */
const SIGUIENTE: Partial<Record<EstadoTramite, EstadoTramite>> = {
  INGRESADO: 'ADMITIDO',
  ADMITIDO: 'EN_GESTION',
  EN_GESTION: 'EN_TERRENO',
  EN_TERRENO: 'RESUELTO',
};

@Component({
  selector: 'app-requests',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h2>Trámites</h2>

    <form class="card" *ngIf="esVecinoOFuncionario" (ngSubmit)="crear()">
      <strong>Nuevo trámite</strong>
      <select [(ngModel)]="nuevo.tipoId" name="tipoId" required>
        <option [ngValue]="null" disabled>Selecciona un tipo</option>
        <option *ngFor="let t of tipos" [ngValue]="t.id">{{ t.nombre }}</option>
      </select>
      <textarea [(ngModel)]="nuevo.descripcion" name="descripcion" placeholder="Descripción" required></textarea>
      <input [(ngModel)]="nuevo.direccion" name="direccion" placeholder="Dirección" />
      <button type="submit">Ingresar trámite</button>
    </form>

    <p class="muted" *ngIf="error">{{ error }}</p>

    <table *ngIf="tramites.length; else vacio">
      <thead>
        <tr><th>ID</th><th>Vecino</th><th>Descripción</th><th>Estado</th><th>Funcionario</th><th *ngIf="esFuncionarioOAdmin"></th></tr>
      </thead>
      <tbody>
        <tr *ngFor="let t of tramites">
          <td>{{ t.id }}</td><td>{{ t.vecinoUsername }}</td><td>{{ t.descripcion }}</td>
          <td><span class="badge" [ngClass]="t.estado">{{ t.estado }}</span></td>
          <td>{{ t.funcionarioAsignado }}</td>
          <td *ngIf="esFuncionarioOAdmin">
            <button *ngIf="siguienteEstado(t.estado) as sig" (click)="avanzar(t, sig)">→ {{ sig }}</button>
            <button *ngIf="puedeRechazar(t.estado)" (click)="avanzar(t, 'RECHAZADO')">Rechazar</button>
          </td>
        </tr>
      </tbody>
    </table>
    <ng-template #vacio><p class="muted">Sin trámites.</p></ng-template>
  `,
})
export class RequestsComponent implements OnInit {
  tramites: Tramite[] = [];
  tipos: TipoTramite[] = [];
  error = '';
  esVecinoOFuncionario = false;
  esFuncionarioOAdmin = false;
  nuevo: { tipoId: number | null; descripcion: string; direccion: string } = {
    tipoId: null,
    descripcion: '',
    direccion: '',
  };

  constructor(
    private service: RequestsService,
    private catalogService: CatalogService,
    private msal: MsalService,
  ) {}

  async ngOnInit(): Promise<void> {
    const roles = await rolesDe(this.msal);
    this.esVecinoOFuncionario = roles.includes('Vecino') || roles.includes('Funcionario');
    this.esFuncionarioOAdmin = roles.includes('Funcionario') || roles.includes('Admin');
    this.cargar();
    if (this.esVecinoOFuncionario) {
      this.catalogService.listar().subscribe({ next: (data) => (this.tipos = data) });
    }
  }

  cargar(): void {
    this.service.listar().subscribe({
      next: (data) => (this.tramites = data),
      error: (e) => (this.error = `No se pudieron cargar los trámites (${e.status})`),
    });
  }

  crear(): void {
    if (this.nuevo.tipoId == null) return;
    this.service.crear({ tipoId: this.nuevo.tipoId, descripcion: this.nuevo.descripcion, direccion: this.nuevo.direccion })
      .subscribe({
        next: () => {
          this.nuevo = { tipoId: null, descripcion: '', direccion: '' };
          this.cargar();
        },
        error: (e) => (this.error = e.error?.detail ?? `No se pudo crear (${e.status})`),
      });
  }

  siguienteEstado(estado: EstadoTramite): EstadoTramite | null {
    return SIGUIENTE[estado] ?? null;
  }

  puedeRechazar(estado: EstadoTramite): boolean {
    return estado !== 'RESUELTO' && estado !== 'RECHAZADO';
  }

  avanzar(t: Tramite, nuevo: EstadoTramite): void {
    this.service.cambiarEstado(t.id, nuevo).subscribe({
      next: () => this.cargar(),
      error: (e) => (this.error = e.error?.detail ?? `No se pudo cambiar el estado (${e.status})`),
    });
  }
}
