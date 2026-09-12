import { Injectable } from '@angular/core';
import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Observable, TimeoutError, throwError, timer } from 'rxjs';
import { catchError, retry, timeout } from 'rxjs/operators';

/**
 * El API Gateway corta las integraciones a los 30s. Sin un limite propio, un
 * backend colgado dejaba la peticion viva todo ese rato y la UI se quedaba con
 * el boton deshabilitado esperando una respuesta que no llegaba.
 */
const LIMITE_MS = 20_000;

/**
 * Estados transitorios que vuelven rapido: reintentarlos cuesta milisegundos.
 *
 * <p>El 408 (nuestro propio timeout) queda fuera a proposito: si algo esta
 * colgado, cada intento gasta LIMITE_MS completos y reintentar tres veces
 * dejaria al usuario mirando el skeleton mas de un minuto. Ese caso falla una
 * vez y se le ofrece el boton de reintentar.
 */
const TRANSITORIOS = [0, 502, 503, 504];

const INTENTOS = 3;

/**
 * Acota toda llamada HTTP y reintenta las que fallan por causas transitorias.
 *
 * <p>Motivo del reintento: al encender el lab, las 7 JVM de ec2-apps arrancan a
 * la vez en 2 vCPU y tardan ~80s. El BFF queda arriba antes que catalog/requests,
 * asi que abrir la app en esa ventana devolvia 503 y obligaba a reintentar a mano.
 *
 * <p>Solo se reintentan metodos idempotentes (GET/HEAD). Reintentar un POST o un
 * PUT podria crear un tramite duplicado o repetir un cambio de estado: ante una
 * respuesta perdida no hay forma de saber si el servidor alcanzo a aplicarlo.
 */
@Injectable()
export class HttpResilienceInterceptor implements HttpInterceptor {
  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    const idempotente = req.method === 'GET' || req.method === 'HEAD';

    return next.handle(req).pipe(
      timeout(LIMITE_MS),
      catchError((e: unknown) => throwError(() => this.normalizar(e, req))),
      retry({
        count: idempotente ? INTENTOS - 1 : 0,
        delay: (error: HttpErrorResponse, intento: number) => {
          if (!TRANSITORIOS.includes(error.status)) return throwError(() => error);
          // Backoff: 1.5s, 3s. Da tiempo a que el microservicio termine de arrancar.
          return timer(1500 * intento);
        },
      }),
    );
  }

  /** Unifica el corte por timeout con los errores HTTP para que todo tenga .error.detail. */
  private normalizar(e: unknown, req: HttpRequest<unknown>): unknown {
    if (e instanceof TimeoutError) {
      return new HttpErrorResponse({
        status: 408,
        statusText: 'Request Timeout',
        url: req.url,
        error: { detail: 'El servidor no respondió a tiempo. Vuelve a intentarlo.' },
      });
    }
    return e;
  }
}
