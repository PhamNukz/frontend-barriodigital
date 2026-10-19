import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/** Una cola de RabbitMQ, tal como la reporta ms-barriodigital-rabbitadmin. */
export interface InfoCola {
  nombre: string;
  mensajes: number;
  consumidores: number;
}

@Injectable({ providedIn: 'root' })
export class QueuesService {
  private readonly base = `${environment.apiBaseUrl}/api/admin/queues`;

  constructor(private http: HttpClient) {}

  /** BFF -> rabbitadmin (GET /admin/queues): las colas configuradas, con mensajes y consumidores. */
  listar(): Observable<InfoCola[]> {
    return this.http.get<InfoCola[]>(this.base);
  }
}
