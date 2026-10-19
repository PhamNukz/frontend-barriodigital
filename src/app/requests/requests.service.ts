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
  /** Funcionario que lo ingreso a nombre del vecino; null si lo ingreso el vecino. */
  creadoPor?: string | null;
}

export interface CrearTramite {
  tipoId: number;
  descripcion: string;
  direccion?: string;
  /** Solo Funcionario: correo del vecino a cuyo nombre se ingresa. */
  vecinoUsername?: string;
}

/** Un paso del flujo del tramite: cuando se cumplio o cuando se estima que se cumplira. */
export interface Paso {
  estado: EstadoTramite;
  fechaCumplido: string | null;
  fechaEstimada: string | null;
  nota: string | null;
  actualizadoPor: string | null;
}

export interface CupoInfo {
  tipoId: number;
  nombre: string;
  cupoDiario: number;
  admitidosHoy: number;
  disponible: number;
  /** Momento en que se reinicia el cupo (medianoche local); lo calcula el backend. */
  reinicia: string;
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

  cambiarEstado(id: number, status: EstadoTramite, nota?: string): Observable<Tramite> {
    return this.http.put<Tramite>(`${this.base}/${id}/status`, { status, nota: nota?.trim() || null });
  }

  seguimiento(id: number): Observable<Paso[]> {
    return this.http.get<Paso[]>(`${this.base}/${id}/seguimiento`);
  }

  /** fechaEstimada: Instant ISO, o null para borrarla. */
  planificar(id: number, estado: EstadoTramite, fechaEstimada: string | null, nota: string): Observable<Paso[]> {
    return this.http.put<Paso[]>(`${this.base}/${id}/seguimiento/${estado}`, {
      fechaEstimada,
      nota: nota.trim() || null,
    });
  }

  /** Cupo de todos los tipos en una sola llamada (la tabla lo necesita por fila). */
  cupos(): Observable<CupoInfo[]> {
    return this.http.get<CupoInfo[]>(`${this.base}/cupos`);
  }
}
