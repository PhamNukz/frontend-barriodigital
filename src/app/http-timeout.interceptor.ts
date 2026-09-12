import { Injectable } from '@angular/core';
import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Observable, TimeoutError, throwError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';

/**
 * El API Gateway corta las integraciones a los 30s. Sin un limite propio, un
 * backend colgado dejaba la peticion viva todo ese rato y la UI se quedaba con
 * el boton deshabilitado esperando una respuesta que no llegaba.
 */
const LIMITE_MS = 20_000;

/** Acota toda llamada HTTP y traduce el corte a un error con el mismo shape que los del backend. */
@Injectable()
export class HttpTimeoutInterceptor implements HttpInterceptor {
  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(req).pipe(
      timeout(LIMITE_MS),
      catchError((e: unknown) => {
        if (e instanceof TimeoutError) {
          // Se convierte a HttpErrorResponse con .error.detail para que los
          // componentes lo muestren igual que cualquier error del backend.
          return throwError(() => new HttpErrorResponse({
            status: 408,
            statusText: 'Request Timeout',
            url: req.url,
            error: { detail: 'El servidor no respondió a tiempo. Vuelve a intentarlo.' },
          }));
        }
        return throwError(() => e);
      }),
    );
  }
}
