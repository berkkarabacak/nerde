// Footer — minimal: about line + required attributions (OSM + Nominatim).
import { strings } from '@/lib/strings';

export default function Footer() {
  return (
    <footer className="border-t border-neutral-200 bg-white px-4 py-6 text-xs text-neutral-500">
      <div className="mx-auto flex max-w-5xl flex-col gap-2">
        <p>
          <span className="font-semibold text-neutral-900">Nerde</span> — specialized maps for
          highly specific places: calisthenics parks, vanlife spots, public showers and more.
          Community-editable, free, built on open data.
        </p>
        <p>
          Map data{' '}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 hover:underline"
          >
            {strings.map.attribution}
          </a>
          {' · '}
          Search by{' '}
          <a
            href="https://nominatim.openstreetmap.org/"
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 hover:underline"
          >
            OpenStreetMap Nominatim
          </a>
        </p>
      </div>
    </footer>
  );
}
