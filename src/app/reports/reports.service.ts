import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * Los unicos valores que acepta el microservicio de reportes: cualquier otro
 * hace que KpiService.parseRange() lance IllegalArgumentException (400).
 */
export type RangoReporte = 'last24h' | 'last7d';

export interface TramitesPorHora {
  /** Instant ISO truncado a la hora, ej "2026-10-15T14:00:00Z". */
  hora: string;
  cantidad: number;
}

export interface Kpis {
  tramitesPorHora: TramitesPorHora[];
  tramitesActivos: number;
  tiempoResolucionPromedioMin: number;
}

/** El reporte solo conoce el id del tipo; el nombre lo pone la pantalla desde el catalogo. */
export interface TopProcedure {
  tipoId: number;
  cantidad: number;
}

@Injectable({ providedIn: 'root' })
export class ReportsService {
  private readonly base = `${environment.apiBaseUrl}/api/report`;

  constructor(private http: HttpClient) {}

  kpis(range: RangoReporte): Observable<Kpis> {
    return this.http.get<Kpis>(`${this.base}/kpis`, { params: { range } });
  }

  topProcedures(range: RangoReporte): Observable<TopProcedure[]> {
    return this.http.get<TopProcedure[]>(`${this.base}/top-procedures`, { params: { range } });
  }
}
