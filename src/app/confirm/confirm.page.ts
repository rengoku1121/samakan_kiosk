import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ViewWillEnter } from '@ionic/angular';
import { CatalogSelection } from '../catalog/catalog.models';
import {
  MENU_PLACEHOLDER,
  PICKUP_DOOR_WAIT_MESSAGE,
  publicSlotCheckMessage,
} from '../services/public-error';
import { KioskDispenseService } from '../services/kiosk-dispense.service';
import { KioskSelectionService } from '../services/kiosk-selection.service';

@Component({
  selector: 'app-confirm',
  templateUrl: 'confirm.page.html',
  styleUrls: ['confirm.page.scss'],
  standalone: false,
})
export class ConfirmPage implements ViewWillEnter {
  readonly brand = 'samakan';
  item: CatalogSelection | null = null;

  /** null = belum pilih; true = dipanaskan; false = tidak */
  heatChoice: boolean | null = null;
  heatError = '';
  slotError = '';
  /** Lubang masih terbuka — bukan pesan gagal. */
  slotNotice = '';
  checkingSlot = false;

  constructor(
    private readonly router: Router,
    private readonly selectionSvc: KioskSelectionService,
    private readonly dispenseSvc: KioskDispenseService
  ) {}

  ionViewWillEnter(): void {
    this.item = this.selectionSvc.get();
    this.heatChoice = null;
    this.heatError = '';
    this.slotError = '';
    this.slotNotice = '';
    this.checkingSlot = false;
    if (!this.item) {
      void this.router.navigateByUrl('/catalog');
      return;
    }
    if (this.item.requires_heating) {
      this.heatChoice = true;
    }
  }

  get isSlotMode(): boolean {
    return this.item?.catalog_mode === 'slot';
  }

  get canContinue(): boolean {
    if (this.checkingSlot) return false;
    if (this.heatChoice === null) return false;
    if (this.item?.requires_heating && this.heatChoice === false) return false;
    return true;
  }

  priceFmt(n: number): string {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(n);
  }

  chooseHeat(value: boolean): void {
    this.heatChoice = value;
    this.heatError = '';
    this.slotError = '';
    this.slotNotice = '';
    if (this.item?.requires_heating && value === false) {
      this.heatError =
        'Menu ini wajib dipanaskan. Pilih “Dipanaskan” untuk melanjutkan.';
    }
  }

  goBack(): void {
    void this.router.navigateByUrl('/catalog');
  }

  async onContinue(): Promise<void> {
    if (!this.item || this.checkingSlot) return;
    if (this.heatChoice === null) {
      this.heatError = 'Pilih dulu mau dipanaskan atau tidak.';
      return;
    }
    if (this.item.requires_heating && this.heatChoice === false) {
      this.heatError =
        'Menu ini wajib dipanaskan. Pilih “Dipanaskan” untuk melanjutkan.';
      return;
    }

    this.checkingSlot = true;
    this.slotError = '';
    this.slotNotice = '';
    const check = await this.dispenseSvc.checkSlotReady(this.item.slot_code);
    this.checkingSlot = false;

    if (!check.ok) {
      const msg = publicSlotCheckMessage(check.detail);
      if (msg === PICKUP_DOOR_WAIT_MESSAGE || this.dispenseSvc.isPickupDoorOpen) {
        this.slotNotice = PICKUP_DOOR_WAIT_MESSAGE;
        return;
      }
      this.slotError = msg;
      return;
    }

    this.selectionSvc.set({
      ...this.item,
      heat_requested: this.heatChoice === true,
    });

    void this.router.navigateByUrl('/payment');
  }

  onImgError(event: Event): void {
    const img = event.target as HTMLImageElement | null;
    if (!img) return;
    if (img.src.includes('menu-placeholder')) return;
    img.src = MENU_PLACEHOLDER;
  }
}
