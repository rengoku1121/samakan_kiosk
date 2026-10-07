import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { RouterTestingModule } from '@angular/router/testing';
import { DEFAULT_SERVICE_PASSWORD, KioskConfigService } from '../services/kiosk-config.service';

import { HomePage } from './home.page';

describe('HomePage', () => {
  let component: HomePage;
  let fixture: ComponentFixture<HomePage>;

  beforeEach(async () => {
    localStorage.removeItem('samakan.kiosk.config');
    await TestBed.configureTestingModule({
      declarations: [HomePage],
      imports: [IonicModule.forRoot(), FormsModule, RouterTestingModule],
    }).compileComponents();

    fixture = TestBed.createComponent(HomePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem('samakan.kiosk.config');
  });

  function tapMachine(times: number): void {
    for (let i = 0; i < times; i += 1) component.onMachineTap();
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('lima ketukan membuka dialog password, belum pindah halaman', () => {
    const router = TestBed.inject(Router);
    const nav = spyOn(router, 'navigateByUrl');
    tapMachine(4);
    expect(component.gateOpen).toBeFalse();
    tapMachine(1);
    expect(component.gateOpen).toBeTrue();
    expect(nav).not.toHaveBeenCalled();
  });

  it('password salah tidak masuk ke mode servis', () => {
    const router = TestBed.inject(Router);
    const nav = spyOn(router, 'navigateByUrl');
    tapMachine(5);
    component.gatePassword = 'salah';
    component.submitGate();
    expect(component.gateError).toBeTrue();
    expect(component.gateOpen).toBeTrue();
    expect(nav).not.toHaveBeenCalled();
  });

  it('password benar masuk ke mode servis', () => {
    const router = TestBed.inject(Router);
    const nav = spyOn(router, 'navigateByUrl');
    tapMachine(5);
    component.gatePassword = DEFAULT_SERVICE_PASSWORD;
    component.submitGate();
    expect(nav).toHaveBeenCalledOnceWith('/service');
    expect(component.gateOpen).toBeFalse();
  });

  it('memakai password khusus mesin ini', () => {
    const config = TestBed.inject(KioskConfigService);
    expect(config.setServicePassword('mesin-a')).toBeTrue();
    const router = TestBed.inject(Router);
    const nav = spyOn(router, 'navigateByUrl');
    tapMachine(5);
    component.gatePassword = DEFAULT_SERVICE_PASSWORD;
    component.submitGate();
    expect(nav).not.toHaveBeenCalled();
    component.gatePassword = 'mesin-a';
    component.submitGate();
    expect(nav).toHaveBeenCalledOnceWith('/service');
  });
});
