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
    path: 'admin',
    loadComponent: () => import('./components/admin/admin.component').then(m => m.AdminComponent),
  },
  {
    path: '**',
    redirectTo: '',
    pathMatch: 'full',
  },
];
