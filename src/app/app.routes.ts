import { Routes } from '@angular/router';
import { MsalGuard } from '@azure/msal-angular';
import { HomeComponent } from './home.component';
import { RequestsComponent } from './requests/requests.component';
import { CatalogComponent } from './catalog/catalog.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'requests', component: RequestsComponent, canActivate: [MsalGuard] },
  { path: 'catalog', component: CatalogComponent, canActivate: [MsalGuard] },
  { path: '**', redirectTo: '' },
];
