import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { DispensePage } from './dispense.page';
import { DispensePageRoutingModule } from './dispense-routing.module';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, DispensePageRoutingModule],
  declarations: [DispensePage],
})
export class DispensePageModule {}
