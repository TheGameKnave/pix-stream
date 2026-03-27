import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { SiteConfigService } from '@app/services/site-config.service';

interface AuthStatus {
  authenticated: boolean;
  setupRequired: boolean;
}

@Component({
  selector: 'app-admin',
  templateUrl: 'admin.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
})
export class AdminComponent {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly siteConfig = inject(SiteConfigService);

  readonly loading = signal(true);
  readonly authenticated = signal(false);
  readonly setupRequired = signal(false);
  readonly error = signal('');
  readonly showForgot = signal(false);

  password = '';
  confirmPassword = '';

  constructor() {
    this.checkStatus();
  }

  private checkStatus(): void {
    this.http.get<AuthStatus>('/api/auth/status').subscribe({
      next: (res) => {
        this.authenticated.set(res.authenticated);
        this.setupRequired.set(res.setupRequired);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  setup(): void {
    this.error.set('');
    if (this.password.length < 8) {
      this.error.set('Password must be at least 8 characters');
      return;
    }
    if (this.password !== this.confirmPassword) {
      this.error.set('Passwords do not match');
      return;
    }
    this.http.post<{ success?: boolean; error?: string }>('/api/auth/setup', { password: this.password }).subscribe({
      next: (res) => {
        if (res.success) {
          this.authenticated.set(true);
          this.setupRequired.set(false);
          this.siteConfig.adminSetupRequired.set(false);
          this.password = '';
          this.confirmPassword = '';
        }
      },
      error: (err) => this.error.set(err.error?.error || 'Setup failed'),
    });
  }

  login(): void {
    this.error.set('');
    this.http.post<{ success?: boolean; error?: string }>('/api/auth/login', { password: this.password }).subscribe({
      next: (res) => {
        if (res.success) {
          this.authenticated.set(true);
          this.password = '';
        }
      },
      error: (err) => this.error.set(err.error?.error || 'Login failed'),
    });
  }

  logout(): void {
    this.http.post('/api/auth/logout', {}).subscribe({
      next: () => {
        this.router.navigateByUrl('/');
      },
    });
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      if (this.setupRequired()) {
        this.setup();
      } else {
        this.login();
      }
    }
  }
}
