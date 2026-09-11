import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type EstadoTramite = 'INGRESADO' | 'ADMITIDO' | 'EN_GESTION' | 'EN_TERRENO' | 'RESUELTO' | 'RECHAZADO';

export interface Tramite {
  id: number;
  tipoId: number;
  vecinoUsername: string;
  descripcion: string;
  direccion: string | null;
  estado: EstadoTramite;
  funcionarioAsignado: string | null;
  fechaIngreso: string;
  fechaAdmision: string | null;
  fechaResolucion: string | null;
}

export interface CrearTramite {
  tipoId: number;
  descripcion: string;
  direccion?: string;
}

@Injectable({ providedIn: 'root' })
export class RequestsService {
  private readonly base = `${environment.apiBaseUrl}/api/requests`;

  constructor(private http: HttpClient) {}

  listar(estado?: EstadoTramite): Observable<Tramite[]> {
    let params = new HttpParams();
    if (estado) params = params.set('estado', estado);
    return this.http.get<Tramite[]>(this.base, { params });
  }

  crear(body: CrearTramite): Observable<Tramite> {
    return this.http.post<Tramite>(this.base, body);
  }

  cambiarEstado(id: number, status: EstadoTramite): Observable<Tramite> {
    return this.http.put<Tramite>(`${this.base}/${id}/status`, { status });
  }
}
