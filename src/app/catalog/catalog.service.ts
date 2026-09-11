import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface TipoTramite {
  id: number;
  nombre: string;
  requisitos: string | null;
  cupoDiario: number;
  activo: boolean;
}

export interface CrearTipoTramite {
  nombre: string;
  requisitos?: string;
  cupoDiario: number;
}

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly base = `${environment.apiBaseUrl}/api/catalog/procedures`;

  constructor(private http: HttpClient) {}

  listar(): Observable<TipoTramite[]> {
    return this.http.get<TipoTramite[]>(this.base);
  }

  crear(body: CrearTipoTramite): Observable<TipoTramite> {
    return this.http.post<TipoTramite>(this.base, body);
  }
}
