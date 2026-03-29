import { Route } from '@angular/router';

export const routes: Route[] = [
  {
    path: '',
    loadComponent: () => import('./components/gallery/gallery.component').then(m => m.GalleryComponent),
  },
  {
    path: 'photo/:id',
    loadComponent: () => import('./components/gallery/gallery.component').then(m => m.GalleryComponent),
  },
  {
    path: 'kiosk',
    loadComponent: () => import('./components/gallery/gallery.component').then(m => m.GalleryComponent),
  },
  {
    path: 'kiosk/:tags',
    loadComponent: () => import('./components/gallery/gallery.component').then(m => m.GalleryComponent),
  },
  {
    path: 'admin',
    loadComponent: () => import('./components/admin/admin.component').then(m => m.AdminComponent),
  },
  {
    // Top-level tag filter: /portrait, /portrait+fashion, etc.
    path: ':tags',
    loadComponent: () => import('./components/gallery/gallery.component').then(m => m.GalleryComponent),
  },
  {
    path: '**',
    redirectTo: '',
    pathMatch: 'full',
  },
];
