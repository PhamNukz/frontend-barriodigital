import {
  AfterViewInit, Component, ElementRef, EventEmitter, Input, NgZone, OnDestroy, Output, ViewChild,
  ViewEncapsulation, inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import type { LatLng, LatLngBounds, Map as MapaLeaflet, Marker } from 'leaflet';

/**
 * Rectangulo de la comuna de Valparaiso continental (limite OSM, relacion 110808, redondeado
 * hacia afuera). Es el mismo que valida ms-barriodigital-requests: un punto fuera daria 400.
 */
const COMUNA = { sur: -33.22, norte: -33.01, oeste: -71.76, este: -71.38 };
const BBOX = `${COMUNA.oeste},${COMUNA.sur},${COMUNA.este},${COMUNA.norte}`;
const CENTRO: [number, number] = [-33.045, -71.62];

export interface Punto {
  lat: number;
  lng: number;
}

interface Sugerencia {
  texto: string;
  lat: number;
  lng: number;
}

/**
 * Mapa para marcar la puerta exacta del tramite. En los cerros de Valparaiso la numeracion de
 * OpenStreetMap es incompleta, asi que manda el pin y no el texto:
 * - buscar (Photon) solo acerca el mapa a la calle o el cerro;
 * - tocar el mapa o arrastrar el pin pide la direccion a Nominatim y la propone, editable.
 * Con soloLectura muestra el pin y el link a Google Maps para la cuadrilla.
 */
@Component({
  selector: 'app-mapa-direccion',
  standalone: true,
  imports: [CommonModule],
  // Los nodos que crea Leaflet (pin, controles) no llevan el atributo de encapsulacion.
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="mapa-dir">
      <ng-container *ngIf="!soloLectura">
        <label for="mapa-buscar">Ubicación en el mapa <span class="opcional">(opcional, ayuda a la cuadrilla)</span></label>
        <input
          id="mapa-buscar"
          type="search"
          autocomplete="off"
          placeholder="Busca la calle, el cerro o un lugar cercano"
          (input)="buscar($any($event.target).value)"
          (keydown.enter)="$event.preventDefault(); sugerencias[0] && elegir(sugerencias[0])"
          (keydown.escape)="sugerencias = []"
        />
        <ul class="mapa-sugerencias" *ngIf="sugerencias.length">
          <li *ngFor="let s of sugerencias">
            <button type="button" (click)="elegir(s)">{{ s.texto }}</button>
          </li>
        </ul>
        <p class="hint">Toca el mapa o arrastra el pin hasta la puerta. La dirección se completa sola y la puedes corregir.</p>
      </ng-container>

      <div #mapa class="mapa" [class.mapa-mini]="soloLectura"
           [attr.aria-label]="soloLectura ? 'Mapa con la ubicación del trámite' : 'Mapa para marcar la ubicación'"></div>

      <a *ngIf="soloLectura && lat != null && lng != null" class="btn-link" target="_blank" rel="noopener"
         [href]="'https://www.google.com/maps?q=' + lat + ',' + lng">Abrir en Google Maps →</a>
    </div>
  `,
  styles: [`
    .mapa-dir .mapa {
      height: 300px; margin-top: 8px; border-radius: 12px; border: 1px solid var(--line-strong);
      /* Contiene los z-index de Leaflet (400-1000) para que no tapen la barra superior. */
      position: relative; z-index: 0;
    }
    .mapa-dir .mapa.mapa-mini { height: 200px; margin-bottom: 6px; }
    .mapa-sugerencias {
      list-style: none; margin: 4px 0 0; padding: 4px; border: 1px solid var(--line-strong);
      border-radius: 10px; background: var(--paper-raised); box-shadow: var(--shadow);
    }
    .mapa-sugerencias button {
      width: 100%; text-align: left; padding: 8px 10px; border: 0; border-radius: 6px;
      background: none; font: inherit; color: var(--ink); cursor: pointer;
    }
    .mapa-sugerencias button:hover, .mapa-sugerencias button:focus-visible { background: var(--paper-sunk); }
    .mapa-pin {
      width: 26px; height: 26px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg);
      background: var(--terracotta); border: 3px solid #fff; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
    }
  `],
})
export class MapaDireccionComponent implements AfterViewInit, OnDestroy {
  @Input() lat: number | null | undefined = null;
  @Input() lng: number | null | undefined = null;
  @Input() soloLectura = false;
  @Output() puntoChange = new EventEmitter<Punto>();
  /** Direccion propuesta (busqueda o reverse); el padre la pone en su campo editable. */
  @Output() direccion = new EventEmitter<string>();

  @ViewChild('mapa') private mapaRef!: ElementRef<HTMLDivElement>;

  sugerencias: Sugerencia[] = [];

  private readonly zone = inject(NgZone);
  private L?: typeof import('leaflet');
  private mapa?: MapaLeaflet;
  private pin?: Marker;
  private limites?: LatLngBounds;
  private destruido = false;
  private timerBusqueda?: ReturnType<typeof setTimeout>;
  private abortBusqueda?: AbortController;
  private timerReverse?: ReturnType<typeof setTimeout>;
  private ultimoReverse = 0;
  private puntoActual?: Punto;

  async ngAfterViewInit(): Promise<void> {
    // Import dinamico: Leaflet (~150 KB) baja solo cuando se abre un mapa, no en el bundle inicial.
    const L = await import('leaflet');
    if (this.destruido) return;
    this.L = L;
    // Fuera de la zona: Leaflet escucha mousemove/scroll y cada evento dispararia change detection.
    this.zone.runOutsideAngular(() => {
      const inicial = this.lat != null && this.lng != null ? { lat: this.lat, lng: this.lng } : undefined;
      this.limites = L.latLngBounds([COMUNA.sur, COMUNA.oeste], [COMUNA.norte, COMUNA.este]);
      this.mapa = L.map(this.mapaRef.nativeElement, {
        center: inicial ?? CENTRO,
        zoom: inicial ? 17 : 14,
        minZoom: 12,
        maxBounds: this.limites,
        maxBoundsViscosity: 1,
        scrollWheelZoom: !this.soloLectura,
      });
      // Atribucion obligatoria por la licencia ODbL de OpenStreetMap.
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      }).addTo(this.mapa);
      if (inicial) this.ponerPin(inicial);
      if (!this.soloLectura) this.mapa.on('click', (e) => this.marcar(e.latlng));
    });
  }

  ngOnDestroy(): void {
    this.destruido = true;
    clearTimeout(this.timerBusqueda);
    clearTimeout(this.timerReverse);
    this.abortBusqueda?.abort();
    this.mapa?.remove();
  }

  /** Autocompletar con Photon (OSM): debounce de 300 ms y solo dentro de la comuna. */
  buscar(texto: string): void {
    clearTimeout(this.timerBusqueda);
    this.abortBusqueda?.abort();
    const q = texto.trim();
    if (q.length < 3) {
      this.sugerencias = [];
      return;
    }
    this.timerBusqueda = setTimeout(async () => {
      const ctrl = (this.abortBusqueda = new AbortController());
      try {
        const r = await fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&bbox=${BBOX}&limit=5`,
          { signal: ctrl.signal },
        );
        const geo = await r.json();
        // OSM parte una calle en varios tramos: "Templeman, Cerro Concepción" salia repetida.
        const vistas = new Set<string>();
        this.sugerencias = (geo.features ?? [])
          .map((f: PhotonFeature) => ({
            texto: textoPhoton(f.properties),
            lng: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
          }))
          .filter((s: Sugerencia) => !vistas.has(s.texto) && vistas.add(s.texto));
      } catch {
        // Buscar es una ayuda: si Photon no responde, igual se puede tocar el mapa.
        if (!ctrl.signal.aborted) this.sugerencias = [];
      }
    }, 300);
  }

  elegir(s: Sugerencia): void {
    this.sugerencias = [];
    this.mapa?.setView([s.lat, s.lng], 18);
    // El resultado ya trae su texto: no hace falta gastar un reverse en Nominatim.
    this.marcar(s, s.texto);
  }

  private marcar(ll: LatLng | Punto, texto?: string): void {
    if (!this.limites?.contains([ll.lat, ll.lng])) return; // el backend lo rechazaria con 400
    const p = { lat: redondear(ll.lat), lng: redondear(ll.lng) };
    this.puntoActual = p;
    this.ponerPin(p);
    this.zone.run(() => {
      this.puntoChange.emit(p);
      if (texto) this.direccion.emit(texto);
    });
    if (!texto) this.programarReverse(p);
  }

  private ponerPin(p: Punto): void {
    const L = this.L!;
    if (this.pin) {
      this.pin.setLatLng(p);
      return;
    }
    this.pin = L.marker(p, {
      draggable: !this.soloLectura,
      title: 'Ubicación del trámite',
      icon: L.divIcon({ className: '', html: '<div class="mapa-pin"></div>', iconSize: [26, 26], iconAnchor: [13, 31] }),
    }).addTo(this.mapa!);
    if (!this.soloLectura) this.pin.on('dragend', () => this.marcar(this.pin!.getLatLng()));
  }

  /**
   * Politica de Nominatim: maximo 1 peticion por segundo y nada de autocompletar con el.
   * Se espera lo que falte para el segundo y, si el vecino sigue moviendo el pin, gana el ultimo punto.
   */
  private programarReverse(p: Punto): void {
    clearTimeout(this.timerReverse);
    const espera = Math.max(0, this.ultimoReverse + 1000 - Date.now());
    this.timerReverse = setTimeout(async () => {
      this.ultimoReverse = Date.now();
      try {
        const r = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${p.lat}&lon=${p.lng}&zoom=18&accept-language=es`,
        );
        const texto = textoNominatim(await r.json());
        if (texto && p === this.puntoActual && !this.destruido) this.zone.run(() => this.direccion.emit(texto));
      } catch {
        // Sin direccion propuesta el punto igual queda marcado; el vecino la escribe.
      }
    }, espera);
  }
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | undefined>;
}

/** "Templeman, Cerro Alegre, Valparaíso"; en Valparaiso conviene avisar cuando es una escalera. */
function textoPhoton(p: Record<string, string | undefined>): string {
  const calle = p['street'] ? [p['street'], p['housenumber']].filter(Boolean).join(' ') : '';
  const nombre = (p['name'] ?? '') + (p['osm_value'] === 'steps' ? ' (escalera)' : '');
  return [...new Set([nombre, calle, p['locality'] ?? p['district'], p['city']])].filter(Boolean).join(', ');
}

/** "Templeman 252, Cerro Concepción, Valparaíso" a partir del address de Nominatim. */
function textoNominatim(r: { address?: Record<string, string>; display_name?: string }): string {
  const a = r.address ?? {};
  const calle = [a['road'] ?? a['pedestrian'] ?? a['footway'] ?? a['steps'], a['house_number']].filter(Boolean).join(' ');
  const texto = [calle, a['neighbourhood'] ?? a['suburb'], a['city'] ?? a['town'] ?? a['village']].filter(Boolean).join(', ');
  return texto || r.display_name || '';
}

/** 6 decimales (~0,1 m): la escala de NUMBER(9,6) en la base. */
function redondear(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}
