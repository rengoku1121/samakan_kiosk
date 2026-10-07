import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { PaymentPage } from './payment.page';
import { PaymentPageRoutingModule } from './payment-routing.module';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, PaymentPageRoutingModule],
  declarations: [PaymentPage],
})
export class PaymentPageModule {}
