import { ComponentFixture, TestBed, discardPeriodicTasks, fakeAsync, tick } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { KioskIdleService } from '../services/kiosk-idle.service';
import { SCREENSAVER_FADE_MS, SCREENSAVER_SLIDES, ScreensaverComponent } from './screensaver.component';

describe('ScreensaverComponent', () => {
  let fixture: ComponentFixture<ScreensaverComponent>;
  let component: ScreensaverComponent;
  let idle: { active$: BehaviorSubject<boolean>; hide: jasmine.Spy };
  let today: Date;

  beforeEach(async () => {
    idle = {
      active$: new BehaviorSubject<boolean>(false),
      hide: jasmine.createSpy('hide').and.callFake(() => idle.active$.next(false)),
    };
    await TestBed.configureTestingModule({
      declarations: [ScreensaverComponent],
      providers: [{ provide: KioskIdleService, useValue: idle }],
    }).compileComponents();

    today = new Date(2026, 9, 7, 12, 0, 0);
    fixture = TestBed.createComponent(ScreensaverComponent);
    component = fixture.componentInstance;
    spyOn(component as unknown as { now: () => Date }, 'now').and.callFake(() => today);
    fixture.detectChanges();
  });

  afterEach(() => {
    idle.active$.next(false);
  });

  function show(): void {
    idle.active$.next(true);
    fixture.detectChanges();
  }

  function ids(): string[] {
    return component.slides.map((s) => s.id);
  }

  it('menampilkan tujuh slide selama promo FLEI masih berlaku', fakeAsync(() => {
    show();
    expect(ids()).toEqual(SCREENSAVER_SLIDES.map((s) => s.id));
    expect(component.current?.id).toBe('01-buka-bisnis');
    expect(component.current?.fill).toBeTrue();
    expect(fixture.nativeElement.querySelector('.panel.is-fill')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.segment').length).toBe(7);
    expect(fixture.nativeElement.querySelector('.meta')).toBeNull();
    expect(fixture.nativeElement.querySelector('.cta')).toBeNull();
    tick(component.slides[0].durationMs);
    fixture.detectChanges();
    expect(component.current?.id).toBe('02-restoran-tanpa-restoran');
    expect(component.current?.fill).toBeTrue();
    expect(fixture.nativeElement.querySelector('.panel.is-fill')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.meta')).toBeNull();
    expect(fixture.nativeElement.querySelector('.cta')).toBeNull();
    expect(SCREENSAVER_SLIDES[1].fill).toBeTrue();
    expect(SCREENSAVER_SLIDES[2].id).toBe('03-pantau-hp');
    expect(SCREENSAVER_SLIDES[2].fill).toBeTrue();
    expect(SCREENSAVER_SLIDES[2].showUntil).toBe('2026-10-18');
    expect(SCREENSAVER_SLIDES[3].fill).toBeTrue();
    expect(SCREENSAVER_SLIDES[4].id).toBe('05-mitra-menu');
    expect(SCREENSAVER_SLIDES[4].fill).toBeTrue();
    expect(SCREENSAVER_SLIDES[4].showUntil).toBeUndefined();
    expect(SCREENSAVER_SLIDES[5].fill).toBeTrue();
    expect(SCREENSAVER_SLIDES[6].id).toBe('07-scan-soft-launch');
    expect(SCREENSAVER_SLIDES[6].fill).toBeTrue();
    expect(SCREENSAVER_SLIDES[6].showUntil).toBe('2026-10-18');
    expect(SCREENSAVER_SLIDES[3].showUntil).toBe('2026-10-18');
    expect(fixture.nativeElement.querySelectorAll('.segment').length).toBe(7);
    discardPeriodicTasks();
    idle.active$.next(false);
  }));

  it('menyembunyikan slide harga soft launch setelah 18 Oktober 2026', fakeAsync(() => {
    today = new Date(2026, 9, 19, 9, 0, 0);
    show();
    expect(ids()).not.toContain('04-pemilik-samakan');
    expect(ids()).not.toContain('03-pantau-hp');
    expect(ids()).toContain('05-mitra-menu');
    expect(ids()).not.toContain('07-scan-soft-launch');
    expect(component.slides.length).toBe(4);
    idle.active$.next(false);
  }));

  it('masih menampilkan slide FLEI pada tanggal 18 Oktober', fakeAsync(() => {
    today = new Date(2026, 9, 18, 23, 30, 0);
    show();
    expect(ids()).toContain('07-scan-soft-launch');
    idle.active$.next(false);
  }));

  it('berpindah slide sesuai durasi masing-masing', fakeAsync(() => {
    show();
    const qrIndex = ids().indexOf('07-scan-soft-launch');
    for (let i = 0; i < qrIndex; i++) {
      tick(component.slides[i].durationMs);
    }
    const qrMs = component.current?.durationMs ?? 0;
    expect(component.current?.id).toBe('07-scan-soft-launch');
    expect(qrMs).toBe(3_000);

    tick(qrMs - 1);
    expect(component.current?.id).toBe('07-scan-soft-launch');
    tick(1);
    expect(component.current?.id).toBe('01-buka-bisnis');
    idle.active$.next(false);
  }));

  it('kembali ke slide pertama setelah slide terakhir', fakeAsync(() => {
    show();
    const total = component.slides.reduce((sum, s) => sum + s.durationMs, 0);
    tick(total);
    expect(component.index).toBe(0);
    idle.active$.next(false);
  }));

  it('menahan slide sebelumnya hanya selama crossfade', fakeAsync(() => {
    show();
    tick(component.slides[0].durationMs);
    expect(component.prevIndex).toBe(0);
    expect(component.isRendered(0)).toBeTrue();
    tick(SCREENSAVER_FADE_MS);
    expect(component.prevIndex).toBe(-1);
    expect(component.isRendered(0)).toBeFalse();
    idle.active$.next(false);
  }));

  it('mulai lagi dari slide pertama setiap screensaver muncul', fakeAsync(() => {
    show();
    tick(component.slides[0].durationMs + component.slides[1].durationMs);
    expect(component.index).toBe(2);

    idle.active$.next(false);
    show();
    expect(component.index).toBe(0);
    expect(component.prevIndex).toBe(-1);
    idle.active$.next(false);
  }));

  it('menghentikan semua timer saat disembunyikan', fakeAsync(() => {
    show();
    idle.active$.next(false);
    tick(60_000);
    expect(component.index).toBe(0);
  }));

  it('satu sentuhan menutup screensaver tanpa meneruskan klik', fakeAsync(() => {
    show();
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    spyOn(ev, 'stopPropagation').and.callThrough();
    fixture.nativeElement.querySelector('.saver').dispatchEvent(ev);
    expect(idle.hide).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBeTrue();
    expect(ev.stopPropagation).toHaveBeenCalled();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.saver')).toBeNull();
  }));

  it('melewati slide yang gambarnya gagal dimuat dan jatuh ke logo bila semua gagal', fakeAsync(() => {
    show();
    const first = component.slides[0];
    component.onImageError(first);
    expect(ids()).not.toContain(first.id);
    expect(component.current?.id).toBe('02-restoran-tanpa-restoran');

    [...component.slides].forEach((s) => component.onImageError(s));
    fixture.detectChanges();
    expect(component.slides.length).toBe(0);
    expect(fixture.nativeElement.querySelector('.brand-logo')).not.toBeNull();
    idle.active$.next(false);
  }));
});
