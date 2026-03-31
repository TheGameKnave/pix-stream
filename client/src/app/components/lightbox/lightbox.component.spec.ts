import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { LightboxComponent } from './lightbox.component';

describe('LightboxComponent', () => {
  let component: LightboxComponent;
  let fixture: ComponentFixture<LightboxComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LightboxComponent, RouterModule],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: {
                get: (key: string) => key === 'id' ? 'sunset-beach' : null,
              },
            },
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LightboxComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('reads photoId from route params', () => {
    expect(component.photoId).toBe('sunset-beach');
  });

  it('renders the photo ID in the template', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('sunset-beach');
  });

  it('renders a back-to-gallery link', () => {
    const el: HTMLElement = fixture.nativeElement;
    const link = el.querySelector('a[href="/"]');
    expect(link).toBeTruthy();
    expect(link!.textContent).toContain('Back to gallery');
  });
});

describe('LightboxComponent with no id', () => {
  it('sets photoId to null when param is missing', async () => {
    await TestBed.configureTestingModule({
      imports: [LightboxComponent, RouterModule],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: { get: () => null },
            },
          },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LightboxComponent);
    const component = fixture.componentInstance;
    expect(component.photoId).toBeNull();
  });
});
