import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  {
    path: 'home',
    loadChildren: () => import('./home/home.module').then((m) => m.HomePageModule),
  },
  {
    path: 'catalog',
    loadChildren: () => import('./catalog/catalog.module').then((m) => m.CatalogPageModule),
  },
  {
    path: 'confirm',
    loadChildren: () => import('./confirm/confirm.module').then((m) => m.ConfirmPageModule),
  },
  {
    path: 'payment',
    loadChildren: () => import('./payment/payment.module').then((m) => m.PaymentPageModule),
  },
  {
    path: 'dispense',
    loadChildren: () => import('./dispense/dispense.module').then((m) => m.DispensePageModule),
  },
  {
    path: 'success',
    loadChildren: () => import('./success/success.module').then((m) => m.SuccessPageModule),
  },
  {
    path: 'service',
    loadChildren: () => import('./service/service.module').then((m) => m.ServicePageModule),
  },
  {
    path: '',
    redirectTo: 'home',
    pathMatch: 'full',
  },
];


@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule { }
