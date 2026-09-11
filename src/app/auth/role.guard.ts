import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { SessionService } from './session.service';

/** Bloquea rutas a quien no tenga uno de los roles dados. Ej: roleGuard(['Admin', 'Funcionario']) para /catalog. */
export function roleGuard(rolesPermitidos: string[]): CanActivateFn {
  return async () => {
    const session = inject(SessionService);
    const router = inject(Router);
    // Espera a que termine de cargar (login recien hecho, o cambio de cuenta en curso) antes de decidir.
    const s = await firstValueFrom(session.estado$.pipe(filter((s) => !s.cargando), take(1)));
    if (s.roles.some((r) => rolesPermitidos.includes(r))) return true;
    return router.createUrlTree(['/']);
  };
}
