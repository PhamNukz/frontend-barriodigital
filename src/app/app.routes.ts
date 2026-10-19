import { Routes } from '@angular/router';
import { MsalGuard } from '@azure/msal-angular';
import { HomeComponent } from './home.component';
import { RequestsComponent } from './requests/requests.component';
import { CatalogComponent } from './catalog/catalog.component';
import { DashboardComponent } from './dashboard/dashboard.component';
import { ReportsComponent } from './reports/reports.component';
import { AuditComponent } from './audit/audit.component';
import { roleGuard } from './auth/role.guard';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  // ponytail: /login es alias de la portada (Caso §6), no una redireccion. El redirectUri de
  // MSAL apunta a '/', y redirigir desde ahi podria borrar el #code= del popup antes de leerlo.
  { path: 'login', component: HomeComponent },
  { path: 'dashboard', component: DashboardComponent, canActivate: [MsalGuard] },
  { path: 'requests', component: RequestsComponent, canActivate: [MsalGuard] },
  { path: 'catalog', component: CatalogComponent, canActivate: [MsalGuard, roleGuard(['Admin', 'Funcionario'])] },
  { path: 'reports', component: ReportsComponent, canActivate: [MsalGuard, roleGuard(['Admin'])] },
  { path: 'audit', component: AuditComponent, canActivate: [MsalGuard, roleGuard(['Admin', 'Auditor'])] },
  { path: '**', redirectTo: '' },
];
