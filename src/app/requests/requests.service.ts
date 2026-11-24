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
  /** Punto marcado en el mapa; null en los tramites sin mapa. */
  lat?: number | null;
  lng?: number | null;
  /** Cerro, pasaje, escalera, color de la casa. */
  referencia?: string | null;
  /** Asignacion explicita (≠ funcionarioAsignado, que es el ultimo que cambio el estado). */
  responsable?: string | null;
  /** Momento en que la cuadrilla salio; solo en EN_TERRENO. */
  enCaminoDesde?: string | null;
  /**
   * undefined = el backend todavia no tiene visitas (la UI se esconde);
   * null = las tiene, pero este tramite aun no tiene visita propuesta.
   */
  visita?: Visita | null;
}

export type Franja = 'MANANA' | 'TARDE';
export type EstadoVisita = 'PROPUESTA' | 'CONFIRMADA' | 'CAMBIO_PEDIDO' | 'LLAMAR';
export type RespuestaVisita = 'CONFIRMAR' | 'CAMBIAR' | 'LLAMAR';

export interface Visita {
  /** LocalDate ISO ("2026-11-26"). */
  fecha: string;
  franja: Franja;
  cuadrilla: string;
  nota: string | null;
  estado: EstadoVisita;
  /** Lo que pidio el vecino con CAMBIAR (texto corto). */
  horarioPedido: string | null;
  actualizadoEn: string;
}

export const HORARIO_FRANJA: Record<Franja, string> = { MANANA: '9:00 a 12:00', TARDE: '14:00 a 17:00' };

/** "jueves 26 de noviembre, 9:00 a 12:00". La fecha es LocalDate: se arma a mediodia para no correrse de dia por zona horaria. */
export function textoVisita(v: Visita): string {
  const dia = new Date(v.fecha + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
  return `${dia}, ${HORARIO_FRANJA[v.franja]}`;
}

export interface CrearTramite {
  tipoId: number;
  descripcion: string;
  direccion?: string;
  /** Solo Funcionario: correo del vecino a cuyo nombre se ingresa. */
  vecinoUsername?: string;
  /** Opcionales, lat y lng juntos: el backend valida que caigan en la comuna de Valparaiso. */
  lat?: number;
  lng?: number;
  referencia?: string;
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

  // Los cuatro devuelven el tramite completo: la pantalla lo reemplaza sin recargar.

  /** Solo Funcionario/Admin; 409 si el tramite esta cerrado. */
  asignarResponsable(id: number, responsable: string): Observable<Tramite> {
    return this.http.put<Tramite>(`${this.base}/${id}/responsable`, { responsable: responsable.trim() });
  }

  /** Crea o reprograma la visita (queda PROPUESTA). fecha: LocalDate "2026-11-26". */
  proponerVisita(id: number, fecha: string, franja: Franja, cuadrilla: string, nota: string): Observable<Tramite> {
    return this.http.put<Tramite>(`${this.base}/${id}/visita`, { fecha, franja, cuadrilla: cuadrilla.trim(), nota: nota.trim() || null });
  }

  /** Solo el vecino dueno; CAMBIAR exige horarioPedido. 409 si ya respondio. */
  responderVisita(id: number, respuesta: RespuestaVisita, horarioPedido?: string): Observable<Tramite> {
    return this.http.post<Tramite>(`${this.base}/${id}/visita/respuesta`, { respuesta, horarioPedido: horarioPedido?.trim() || null });
  }

  /** Idempotente: repetirlo no reenvia el correo. */
  avisarEnCamino(id: number): Observable<Tramite> {
    return this.http.put<Tramite>(`${this.base}/${id}/en-camino`, {});
  }
}
