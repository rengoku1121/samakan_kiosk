import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { DispensePage } from './dispense.page';

const routes: Routes = [
  {
    path: '',
    component: DispensePage,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class DispensePageRoutingModule {}
