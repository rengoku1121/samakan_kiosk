import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { KioskIdleService } from '../services/kiosk-idle.service';

export interface ScreensaverSlide {
  id: string;
  src: string;
  bg: string;
  label: string;
  durationMs: number;
  /** Tanggal terakhir slide boleh tampil (YYYY-MM-DD, waktu lokal). */
  showUntil?: string;
  /** Gambar menutup seluruh layar, tanpa kartu dan tanpa chrome. */
  fill?: boolean;
}

/** Durasi produksi: tiap slide 12 detik. */
const DEFAULT_MS = 12_000;
const QR_MS = 12_000;
/** Lama crossfade; slide sebelumnya tetap dirender selama ini. */
export const SCREENSAVER_FADE_MS = 900;

const asset = (id: string) => `assets/screensaver/${id}.webp`;
const bgAsset = (id: string) => `assets/screensaver/${id}-bg.webp`;

const slide = (id: string, label: string, durationMs = DEFAULT_MS, showUntil?: string): ScreensaverSlide => ({
  id,
  src: asset(id),
  bg: bgAsset(id),
  label,
  durationMs,
  showUntil,
});

/** Harga soft launch hanya berlaku sampai 18 Oktober 2026. */
const FLEI_UNTIL = '2026-10-18';

export const SCREENSAVER_SLIDES: ScreensaverSlide[] = [
  { ...slide('01-buka-bisnis', 'Buka bisnis, bukan tambah beban'), fill: true },
  { ...slide('02-restoran-tanpa-restoran', 'Restoran tanpa restoran'), fill: true },
  { ...slide('03-pantau-hp', 'Pantau dari HP, bukan dari dapur', DEFAULT_MS, FLEI_UNTIL), fill: true },
  { ...slide('04-pemilik-samakan', 'Jadi pemilik Samakan', DEFAULT_MS, FLEI_UNTIL), fill: true },
  { ...slide('05-mitra-menu', 'Jadi mitra menu'), fill: true },
  { ...slide('06-mitra-lokasi', 'Jadi mitra lokasi'), fill: true },
  { ...slide('07-scan-soft-launch', 'Scan dulu, kunci harga soft launch', QR_MS, FLEI_UNTIL), fill: true },
];

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

@Component({
  selector: 'app-screensaver',
  templateUrl: './screensaver.component.html',
  styleUrls: ['./screensaver.component.scss'],
  standalone: false,
})
export class ScreensaverComponent implements OnInit, OnDestroy {
  visible = false;
  slides: ScreensaverSlide[] = [];
  index = 0;
  prevIndex = -1;
  clock = '';
  dateLabel = '';

  private sub?: Subscription;
  private slideTimer: ReturnType<typeof setTimeout> | null = null;
  private fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private clockTimer: ReturnType<typeof setInterval> | null = null;
  private readonly failed = new Set<string>();

  constructor(private readonly idle: KioskIdleService) {}

  get current(): ScreensaverSlide | null {
    return this.slides[this.index] || null;
  }

  ngOnInit(): void {
    this.sub = this.idle.active$.subscribe((on) => {
      this.visible = on;
      if (on) this.startLoop();
      else this.stopLoop();
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.stopLoop();
  }

  trackSlide(_: number, s: ScreensaverSlide): string {
    return s.id;
  }

  isRendered(i: number): boolean {
    return i === this.index || i === this.prevIndex;
  }

  /** Segmen progress: sudah lewat, sedang berjalan, atau belum. */
  segmentState(i: number): 'done' | 'active' | 'todo' {
    if (i < this.index) return 'done';
    if (i === this.index) return 'active';
    return 'todo';
  }

  dismiss(ev: Event): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.idle.hide();
  }

  onImageError(s: ScreensaverSlide): void {
    if (this.failed.has(s.id)) return;
    this.failed.add(s.id);
    const currentId = this.current?.id;
    this.slides = this.slides.filter((x) => x.id !== s.id);
    if (!this.slides.length) {
      this.clearSlideTimers();
      return;
    }
    const keep = this.slides.findIndex((x) => x.id === currentId);
    if (keep >= 0) {
      this.index = keep;
      this.prevIndex = -1;
      return;
    }
    this.prevIndex = -1;
    this.goTo(Math.min(this.index, this.slides.length - 1));
  }

  protected now(): Date {
    return new Date();
  }

  private startLoop(): void {
    this.stopLoop();
    const today = ymd(this.now());
    this.slides = SCREENSAVER_SLIDES.filter(
      (s) => !this.failed.has(s.id) && (!s.showUntil || today <= s.showUntil)
    );
    this.prevIndex = -1;
    this.tickClock();
    this.clockTimer = setInterval(() => this.tickClock(), 1000);
    if (this.slides.length) this.goTo(0);
  }

  private stopLoop(): void {
    this.clearSlideTimers();
    if (this.clockTimer) clearInterval(this.clockTimer);
    this.clockTimer = null;
    this.index = 0;
    this.prevIndex = -1;
  }

  private clearSlideTimers(): void {
    if (this.slideTimer) clearTimeout(this.slideTimer);
    if (this.fadeTimer) clearTimeout(this.fadeTimer);
    this.slideTimer = null;
    this.fadeTimer = null;
  }

  private goTo(i: number): void {
    this.clearSlideTimers();
    if (i !== this.index) this.prevIndex = this.index;
    this.index = i;
    const s = this.slides[i];
    if (!s) return;

    if (this.prevIndex >= 0) {
      this.fadeTimer = setTimeout(() => {
        this.prevIndex = -1;
        this.fadeTimer = null;
      }, SCREENSAVER_FADE_MS);
    }
    this.preload(this.slides[(i + 1) % this.slides.length]);

    if (this.slides.length > 1) {
      this.slideTimer = setTimeout(() => this.goTo((this.index + 1) % this.slides.length), s.durationMs);
    }
  }

  private preload(s: ScreensaverSlide | undefined): void {
    if (!s || typeof Image === 'undefined') return;
    const img = new Image();
    img.src = s.src;
    const bg = new Image();
    bg.src = s.bg;
  }

  private tickClock(): void {
    const now = this.now();
    this.clock = now.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
    });
    this.dateLabel = now.toLocaleDateString('id-ID', {
      weekday: 'long',
      day: 'numeric',
      month: 'short',
    });
  }
}
