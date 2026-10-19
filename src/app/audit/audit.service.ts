import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/** Un cambio de estado de un tramite, tal como lo guardo ms-barriodigital-audit. */
export interface EventoAuditoria {
  id: number;
  tramiteId: number;
  /** Quien hizo el cambio. */
  usuario: string;
  estadoAnterior: string | null;
  estadoNuevo: string;
  /** Instant ISO (`2026-10-15T12:34:56.789Z`). */
  timestamp: string;
  /** Vecino dueno del tramite (null en eventos anteriores a que se guardara). */
  vecinoUsername: string | null;
  tipoId: number | null;
  /** Nota del funcionario, o "Ingresado por X a nombre de Y". */
  nota: string | null;
}

/** Filtros de la pantalla; las fechas vienen de un <input type="date"> ("2026-10-15"). */
export interface FiltroAuditoria {
  /** Quien hizo el cambio o el vecino afectado: todo lo que tiene que ver con esa persona. */
  persona: string;
  tramiteId: string;
  tipoEvento: string;
  desde: string;
  hasta: string;
}

export const FILTRO_VACIO: FiltroAuditoria = { persona: '', tramiteId: '', tipoEvento: '', desde: '', hasta: '' };

/**
 * El input da solo el dia; AuditController espera un Instant ISO. Se toma el dia
 * completo en la hora local del navegador (toISOString lo pasa a UTC), para que
 * "desde hoy" no deje fuera la manana por el desfase de zona.
 */
function instanteDe(fecha: string, finDelDia: boolean): string {
  return new Date(`${fecha}T${finDelDia ? '23:59:59.999' : '00:00:00'}`).toISOString();
}

@Injectable({ providedIn: 'root' })
export class AuditService {
  private readonly base = `${environment.apiBaseUrl}/api/audit/timeline`;

  constructor(private http: HttpClient) {}

  /** El BFF reenvia los query params tal cual al microservicio de auditoria. */
  timeline(f: FiltroAuditoria): Observable<EventoAuditoria[]> {
    let params = new HttpParams();
    // Un param vacio NO es "sin filtro": `persona=` bindea a "" en el backend y
    // no calza con ningun evento. Solo se manda lo que el usuario realmente lleno.
    if (f.persona.trim()) params = params.set('persona', f.persona.trim());
    if (f.tramiteId.trim()) params = params.set('tramiteId', f.tramiteId.trim().replace(/^#/, ''));
    if (f.tipoEvento) params = params.set('tipoEvento', f.tipoEvento);
    if (f.desde) params = params.set('desde', instanteDe(f.desde, false));
    if (f.hasta) params = params.set('hasta', instanteDe(f.hasta, true));
    return this.http.get<EventoAuditoria[]>(this.base, { params });
  }
}
