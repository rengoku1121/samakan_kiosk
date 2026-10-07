import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { ViewWillEnter } from '@ionic/angular';
import { Subscription } from 'rxjs';
import { KioskApiService } from '../services/kiosk-api.service';
import {
  MENU_PLACEHOLDER,
  PICKUP_DOOR_WAIT_MESSAGE,
  publicErrorMessage,
} from '../services/public-error';
import { KioskConfigService } from '../services/kiosk-config.service';
import { KioskDispenseService } from '../services/kiosk-dispense.service';
import { KioskSelectionService } from '../services/kiosk-selection.service';
import {
  buildMachineLayout,
  CatalogMode,
  CatalogProduct,
  CatalogSelection,
  CatalogSlot,
  groupSlotsByProduct,
  MACHINE_LAYOUT_COLS,
  MachineLayoutCell,
  pickSlotForProduct,
  slotsOutsideLayout,
  sortSlots,
} from './catalog.models';

@Component({
  selector: 'app-catalog',
  templateUrl: 'catalog.page.html',
  styleUrls: ['catalog.page.scss'],
  standalone: false,
})
export class CatalogPage implements ViewWillEnter, OnDestroy {
  readonly brand = 'samakan';
  readonly machineCode: string;
  readonly pickupDoorWaitMessage = PICKUP_DOOR_WAIT_MESSAGE;
  readonly pickupDoorOpen$;

  catalogColumns = 2;
  catalogMode: CatalogMode = 'product';

  /** Mode slot selalu memakai denah fisik mesin (4 kolom). */
  readonly layoutColumns = MACHINE_LAYOUT_COLS;

  loading = true;
  loadError = '';

  products: CatalogProduct[] = [];
  slots: CatalogSlot[] = [];
  layout: MachineLayoutCell[] = [];
  extraSlots: CatalogSlot[] = [];

  selectedProductCode: string | null = null;
  assignedSlotCode: string | null = null;

  private catalogSub?: Subscription;

  constructor(
    private readonly router: Router,
    private readonly kioskApi: KioskApiService,
    private readonly selectionSvc: KioskSelectionService,
    dispenseSvc: KioskDispenseService,
    config: KioskConfigService
  ) {
    this.machineCode = config.machineCode;
    this.pickupDoorOpen$ = dispenseSvc.pickupDoorOpen$;
  }

  ionViewWillEnter(): void {
    this.loadCatalog();
  }

  ngOnDestroy(): void {
    this.catalogSub?.unsubscribe();
  }

  get isSlotMode(): boolean {
    return this.catalogMode === 'slot';
  }

  get selected(): CatalogSelection | null {
    if (!this.assignedSlotCode) return null;

    if (this.isSlotMode) {
      const slot = this.slots.find((s) => s.slot_code === this.assignedSlotCode);
      if (!slot) return null;
      return {
        product_code: slot.product_code,
        product_name: slot.product_name,
        price: slot.price,
        stock: slot.stock,
        image_url: slot.image_url,
        desc: slot.desc,
        slot_code: slot.slot_code,
        catalog_mode: this.catalogMode,
        requires_heating: slot.requires_heating,
        heat_requested: null,
      };
    }

    if (!this.selectedProductCode) return null;
    const product = this.products.find((p) => p.product_code === this.selectedProductCode);
    if (!product) return null;
    return {
      product_code: product.product_code,
      product_name: product.product_name,
      price: product.price,
      stock: product.stock,
      image_url: product.image_url,
      desc: product.desc,
      slot_code: this.assignedSlotCode,
      catalog_mode: this.catalogMode,
      requires_heating: product.requires_heating,
      heat_requested: null,
    };
  }

  get availableCount(): number {
    if (this.isSlotMode) {
      return this.slots.filter((s) => s.stock > 0).length;
    }
    return this.products.filter((p) => p.stock > 0).length;
  }

  get ledeText(): string {
    return this.isSlotMode
      ? 'Pilih nomor sesuai posisi barang di mesin'
      : 'Pilih menu — stok digabung dari beberapa slot';
  }

  /** Kartu terpakai untuk *ngFor trackBy supaya grid tidak dirender ulang penuh. */
  trackByCell(_index: number, cell: MachineLayoutCell): string {
    return cell.slot_code;
  }

  trackBySlot(_index: number, slot: CatalogSlot): string {
    return slot.slot_code;
  }

  isCellSelectable(cell: MachineLayoutCell): boolean {
    return !!cell.slot && cell.slot.stock > 0;
  }

  priceFmt(n: number): string {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      maximumFractionDigits: 0,
    }).format(n);
  }

  selectProduct(product: CatalogProduct): void {
    if (product.stock <= 0) return;
    const slot = pickSlotForProduct(product);
    if (!slot) return;
    this.selectedProductCode = product.product_code;
    this.assignedSlotCode = slot;
  }

  selectSlot(slot: CatalogSlot): void {
    if (slot.stock <= 0) return;
    this.selectedProductCode = slot.product_code;
    this.assignedSlotCode = slot.slot_code;
  }

  selectCell(cell: MachineLayoutCell): void {
    if (!cell.slot) return;
    this.selectSlot(cell.slot);
  }

  clearSelection(): void {
    this.selectedProductCode = null;
    this.assignedSlotCode = null;
  }

  reload(): void {
    this.loadCatalog();
  }

  onContinue(): void {
    if (!this.selected) return;
    this.selectionSvc.set(this.selected);
    void this.router.navigateByUrl('/confirm');
  }

  goHome(): void {
    void this.router.navigateByUrl('/home');
  }

  onImgError(event: Event): void {
    const img = event.target as HTMLImageElement | null;
    if (!img) return;
    if (img.src.includes('menu-placeholder')) return;
    img.src = MENU_PLACEHOLDER;
  }

  private loadCatalog(): void {
    this.catalogSub?.unsubscribe();
    this.loading = true;
    this.loadError = '';
    this.clearSelection();

    this.catalogSub = this.kioskApi.getCatalog().subscribe({
      next: (data) => {
        this.catalogColumns = data.ui.catalog_columns;
        this.catalogMode = data.ui.catalog_mode;
        this.slots = sortSlots(data.slots);
        this.products = groupSlotsByProduct(this.slots);
        this.layout = buildMachineLayout(this.slots);
        this.extraSlots = slotsOutsideLayout(this.slots);
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        this.slots = [];
        this.products = [];
        this.layout = [];
        this.extraSlots = [];
        this.loadError = publicErrorMessage(
          err,
          'Gagal memuat katalog dari server. Coba lagi.'
        );
      },
    });
  }
}
