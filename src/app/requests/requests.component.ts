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
      <p class="card-title">Nuevo trámite</p>

      <label for="tipo">Tipo de trámite</label>
      <select id="tipo" [(ngModel)]="nuevo.tipoId" name="tipoId" required>
        <option [ngValue]="null" disabled>Selecciona un tipo</option>
        <option *ngFor="let t of tipos" [ngValue]="t.id">{{ t.nombre }}</option>
      </select>

      <label for="descripcion">Descripción</label>
      <textarea id="descripcion" [(ngModel)]="nuevo.descripcion" name="descripcion" placeholder="Cuéntanos qué necesitas" required></textarea>

      <label for="direccion">Dirección</label>
      <input id="direccion" [(ngModel)]="nuevo.direccion" name="direccion" placeholder="Calle y número" />

      <button type="submit" class="btn btn-primary" [disabled]="enviando">
        {{ enviando ? 'Ingresando…' : 'Ingresar trámite' }}
      </button>
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
            <div class="row-actions">
              <button class="btn btn-outline btn-sm" *ngIf="siguienteEstado(t.estado) as sig" (click)="avanzar(t, sig)">→ {{ sig }}</button>
              <button class="btn btn-danger btn-sm" *ngIf="puedeRechazar(t.estado)" (click)="avanzar(t, 'RECHAZADO')">Rechazar</button>
            </div>
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
  enviando = false;
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
    // Guarda contra doble envio: Enter dispara ngSubmit, y si despues tambien
    // se hace clic en el boton (o se aprieta Enter dos veces) se duplicaba el tramite.
    if (this.enviando || this.nuevo.tipoId == null) return;
    this.enviando = true;
    this.service.crear({ tipoId: this.nuevo.tipoId, descripcion: this.nuevo.descripcion, direccion: this.nuevo.direccion })
      .subscribe({
        next: () => {
          this.enviando = false;
          this.nuevo = { tipoId: null, descripcion: '', direccion: '' };
          this.cargar();
        },
        error: (e) => {
          this.enviando = false;
          this.error = e.error?.detail ?? `No se pudo crear (${e.status})`;
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
    this.service.cambiarEstado(t.id, nuevo).subscribe({
      next: () => this.cargar(),
      error: (e) => (this.error = e.error?.detail ?? `No se pudo cambiar el estado (${e.status})`),
    });
  }
}
