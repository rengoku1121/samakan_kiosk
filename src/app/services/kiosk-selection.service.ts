import { Injectable } from '@angular/core';
import { CatalogSelection } from '../catalog/catalog.models';

@Injectable({ providedIn: 'root' })
export class KioskSelectionService {
  private selection: CatalogSelection | null = null;

  set(selection: CatalogSelection): void {
    this.selection = { ...selection };
  }

  get(): CatalogSelection | null {
    return this.selection ? { ...this.selection } : null;
  }

  clear(): void {
    this.selection = null;
  }
}
