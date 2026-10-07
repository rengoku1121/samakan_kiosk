import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { ConfirmPage } from './confirm.page';

const routes: Routes = [
  {
    path: '',
    component: ConfirmPage,
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class ConfirmPageRoutingModule {}
