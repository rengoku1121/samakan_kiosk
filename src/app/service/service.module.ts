import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { ServicePage } from './service.page';
import { ServicePageRoutingModule } from './service-routing.module';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, ServicePageRoutingModule],
  declarations: [ServicePage],
})
export class ServicePageModule {}
