import type { Person } from '../core/types';
import { initials } from '../core/dates';
import { useMediaUrl } from './useMediaUrl';

function hueOf(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  // Keep to greens, ochres and dusty pinks so placeholders sit well on the sheet.
  const bands = [80, 100, 120, 40, 30, 340, 160];
  return bands[h % bands.length];
}

/** Arched specimen-window portrait. Falls back to a tinted silhouette with initials. */
export function Portrait({
  person,
  size = 64,
  which = 'thumb',
  className = '',
}: {
  person: Person;
  size?: number;
  which?: 'thumb' | 'blob';
  className?: string;
}) {
  const url = useMediaUrl(person.photoId, which);
  const h = hueOf(person.id);
  const w = size;
  const hgt = Math.round(size * 1.12);
  return (
    <div
      className={`relative shrink-0 overflow-hidden ${className}`}
      style={{
        width: w,
        height: hgt,
        borderRadius: `${w / 2}px ${w / 2}px ${w / 7}px ${w / 7}px`,
        background: `linear-gradient(170deg, hsl(${h} 26% 82%), hsl(${h} 18% 58%))`,
        boxShadow: 'inset 0 0 0 1px rgba(36,48,31,.12)',
      }}
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" style={{ filter: 'sepia(.18) saturate(.88)' }} draggable={false} />
      ) : (
        <>
          <svg viewBox="0 0 64 72" className="absolute inset-0 h-full w-full" aria-hidden="true">
            <circle cx="32" cy="29" r="12" fill="rgba(36,48,31,.32)" />
            <path d="M9 72c0-16 10-25 23-25s23 9 23 25z" fill="rgba(36,48,31,.32)" />
          </svg>
          {person.placeholder ? (
            <span className="absolute inset-0 grid place-items-center font-display text-ink/70" style={{ fontSize: size * 0.42 }}>
              ?
            </span>
          ) : (
            <span
              className="absolute bottom-[6%] left-0 right-0 text-center font-label font-bold tracking-widest text-card/90"
              style={{ fontSize: Math.max(9, size * 0.16) }}
            >
              {initials(person)}
            </span>
          )}
        </>
      )}
    </div>
  );
}
