import { Routes } from '@angular/router';
import { MsalGuard } from '@azure/msal-angular';
import { HomeComponent } from './home.component';
import { RequestsComponent } from './requests/requests.component';
import { CatalogComponent } from './catalog/catalog.component';
import { AuditComponent } from './audit/audit.component';
import { roleGuard } from './auth/role.guard';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'requests', component: RequestsComponent, canActivate: [MsalGuard] },
  { path: 'catalog', component: CatalogComponent, canActivate: [MsalGuard, roleGuard(['Admin', 'Funcionario'])] },
  { path: 'audit', component: AuditComponent, canActivate: [MsalGuard, roleGuard(['Admin', 'Auditor'])] },
  { path: '**', redirectTo: '' },
];
