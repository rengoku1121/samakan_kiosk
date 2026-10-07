import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { CatalogPage } from './catalog.page';
import { CatalogPageRoutingModule } from './catalog-routing.module';

@NgModule({
  imports: [CommonModule, FormsModule, IonicModule, CatalogPageRoutingModule],
  declarations: [CatalogPage],
})
export class CatalogPageModule {}
