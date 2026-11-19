import { motion } from 'framer-motion';
import { Camera, Trash2, X } from 'lucide-react';
import { useEffect, useRef, type RefObject } from 'react';
import { useSync } from '../sync/engine';
import { fullName } from '../core/dates';
import type { Person, Sex } from '../core/types';
import { ACCEPT_IMAGE } from '../data/media';
import { useStore } from '../data/store';
import { DropZone, EditableArea, EditableText } from '../ui/bits';
import { confirmDeletePerson } from '../data/deletes';
import { DateInput } from '../ui/DateInput';
import { Hint } from '../ui/Hint';
import { Portrait } from '../ui/Portrait';
import { AudioMemories } from './Audio';
import { Gallery } from './Gallery';
import { Relationships } from './Relationships';
import { PersonGroups } from './PersonGroups';

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="label-caps flex items-center gap-2">
        {title}
        {count !== undefined && <span className="font-normal opacity-70">{count}</span>}
        <span className="h-px flex-1 bg-current opacity-20" />
      </h3>
      {children}
    </section>
  );
}

function DateField({
  id,
  label,
  value,
  hint,
  placeholder,
  onCommit,
}: {
  id: string;
  label: string;
  value?: string;
  hint: string;
  placeholder?: string;
  onCommit(v?: string): void;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={id} className="px-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
        {label}
      </label>
      <DateInput
        id={id}
        label={label}
        value={value}
        hint={hint}
        placeholder={placeholder}
        wrapClassName="w-full pr-1"
        className="flex-1 font-label text-[13px] text-ink-soft"
        onCommit={onCommit}
      />
    </div>
  );
}

export function ProfileDrawer({ person, onClose }: { person: Person; onClose(): void }) {
  const graph = useStore((s) => s.graph);
  const media = useStore((s) => s.media);
  const focusNameOf = useStore((s) => s.focusNameOf);
  const update = useStore((s) => s.updatePerson);
  const addImages = useStore((s) => s.addImages);
  const portraitInput = useRef<HTMLInputElement>(null);
  const toast = useStore((s) => s.toast);
  const set = (patch: Partial<Person>) => update(person.id, patch);
  // Saved either way (the user may be mid-correction), but flag an impossible order.
  const checkOrder = (born?: string, died?: string) => {
    // Compare only as much as both dates know: "1941" isn't before "1941-03-14".
    const n = Math.min(born?.length ?? 0, died?.length ?? 0);
    if (born && died && died.slice(0, n) < born.slice(0, n)) toast('The death date is before the birth date. Check both dates.', 'error');
  };

  const photos = person.galleryIds.map((id) => media[id]).filter(Boolean);
  const memories = person.audioIds.map((id) => media[id]).filter(Boolean);
  const isFreshName = focusNameOf === person.id;
  const canEdit = useSync((s) => s.canEdit);
  const body = useRef<HTMLDivElement>(null);
  useReadOnlyFields(body, !canEdit);

  return (
    <motion.aside
      key="drawer"
      initial={{ x: '100%', opacity: 0.6 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0.6 }}
      transition={{ type: 'spring', stiffness: 320, damping: 34 }}
      className="absolute bottom-0 right-0 top-0 z-30 flex w-full flex-col border-l border-rule bg-paper shadow-[-24px_0_48px_-30px_rgba(40,60,30,.5)] sm:w-[440px]"
      aria-label={`Profile of ${fullName(person)}`}
      data-no-pan
    >
      <div className="flex items-center justify-between px-5 pb-1 pt-4">
        <span className="label-caps">Specimen · {person.placeholder ? 'unknown' : 'profile'}{canEdit ? '' : ' · view only'}</span>
        <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full text-moss-deep hover:bg-sheet" aria-label="Close profile">
          <X size={17} />
        </button>
      </div>

      <div ref={body} key={person.id} className="flex flex-1 flex-col gap-7 overflow-y-auto px-5 pb-10 pt-2">
        {/* Identity */}
        <div className="flex gap-4">
          <DropZone onFiles={(f) => addImages(person.id, f, true)} accept={(f) => f.type.startsWith('image/')} className="shrink-0 rounded-[40px_40px_12px_12px]">
            <button
              type="button"
              onClick={() => portraitInput.current?.click()}
              className="group relative block"
              aria-label={person.photoId ? 'Change portrait' : 'Add a portrait'}
              title="Click or drop a photo"
            >
              <Portrait person={person} size={84} which="blob" />
              <span className="absolute inset-0 grid place-items-center rounded-[42px_42px_12px_12px] bg-ink/40 text-card opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <Camera size={20} />
              </span>
            </button>
            <input
              ref={portraitInput}
              type="file"
              accept={ACCEPT_IMAGE}
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void addImages(person.id, [f], true);
              }}
            />
          </DropZone>
          <div className="flex min-w-0 flex-1 flex-col">
            <EditableText
              id="given-name"
              label="Given name"
              value={person.givenName}
              placeholder="Given name"
              autoFocusSelect={isFreshName}
              hint="First name, as the family wrote it. Saves when you press Enter or click away."
              className="font-display text-[25px] leading-tight text-ink"
              onCommit={(v) => set({ givenName: v })}
            />
            <EditableText
              id="middle-name"
              label="Middle names"
              value={person.middleName ?? ''}
              placeholder="Middle name(s)"
              hint="Any middle names, separated by spaces. Shown in their full name and found by search."
              className="text-[14px] text-ink-soft"
              onCommit={(v) => set({ middleName: v.replace(/\s+/g, ' ') || undefined })}
            />
            <EditableText
              id="surname"
              label="Surname"
              value={person.surname}
              placeholder="Surname"
              hint="The family name they're known by, e.g. a married name. Put a maiden name under Birth surname."
              className="text-[12px] font-semibold uppercase tracking-[0.15em] text-ink-muted"
              onCommit={(v) => set({ surname: v })}
            />
            <div className="mt-1 grid grid-cols-2 gap-x-1">
              <EditableText
                id="nickname"
                label="Nickname"
                value={person.nickname ?? ''}
                placeholder="Nickname"
                hint="What family called them, like Nana or Bud. Shown on their card in quotes."
                className="font-label text-[12px] italic text-[#7A5C3E]"
                onCommit={(v) => set({ nickname: v || undefined })}
              />
              <EditableText
                id="birth-surname"
                label="Surname at birth"
                value={person.birthSurname ? `née ${person.birthSurname}` : ''}
                placeholder="Birth surname"
                hint="Surname at birth, if it later changed (e.g. a maiden name). Shown as “née …”."
                className="font-label text-[12px] italic text-[#7A5C3E]"
                onCommit={(v) => set({ birthSurname: v.replace(/^n[ée]e\s+/i, '') || undefined })}
              />
            </div>
          </div>
        </div>

        <div className="-mt-3 grid grid-cols-2 gap-x-2 gap-y-2 rounded-leaf-md border border-rule bg-card/70 p-2">
          <DateField
            id="born"
            label="Born"
            value={person.birthDate}
            hint="Type 1938, Nov 1938 or 2 Nov 1938, or use the calendar. Just the year is fine if that's all you know."
            onCommit={(v) => {
              set({ birthDate: v });
              checkOrder(v, person.deathDate);
            }} />
          <DateField
            id="died"
            label="Died"
            value={person.deathDate}
            hint="Leave empty if they're still living. Partial dates like 2019 or Mar 2019 are fine."
            placeholder="Living, or a date"
            onCommit={(v) => {
              set({ deathDate: v });
              checkOrder(person.birthDate, v);
            }} />
          <label className="flex flex-col gap-0.5" htmlFor="birthplace">
            <span className="px-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Birthplace</span>
            <EditableText
              id="birthplace"
              label="Birthplace"
              value={person.birthplace ?? ''}
              placeholder="Town, country"
              hint="Where they were born, e.g. Whitby, England. The search box at the top also matches places."
              className="text-[13px]"
              onCommit={(v) => set({ birthplace: v || undefined })}
            />
          </label>
          <label className="flex flex-col gap-0.5 px-2" htmlFor="sex">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Shown as</span>
            <Hint text="Only changes the wording used for them, such as mother or father, son or daughter.">
              <select id="sex" className="select mt-0.5 !text-[12px]" value={person.sex} onChange={(e) => set({ sex: e.target.value as Sex })}>
                <option value="female">Mother / daughter</option>
                <option value="male">Father / son</option>
                <option value="unknown">Parent / child</option>
              </select>
            </Hint>
          </label>
          <label className="flex flex-col gap-0.5" htmlFor="phone">
            <span className="px-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Phone</span>
            <EditableText
              id="phone"
              type="tel"
              label="Phone"
              value={person.phone ?? ''}
              placeholder={person.deathDate ? '' : 'Phone number'}
              hint="A phone number, e.g. (808) 555-0142. Several? Separate them with commas. Used by a family group's contact list."
              className="text-[13px]"
              onCommit={(v) => set({ phone: v || undefined })}
            />
          </label>
          <label className="flex flex-col gap-0.5" htmlFor="email">
            <span className="px-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-muted">Email</span>
            <EditableText
              id="email"
              type="email"
              label="Email"
              value={person.email ?? ''}
              placeholder={person.deathDate ? '' : 'name@example.com'}
              hint="An email address. Several? Separate them with commas. Used by a family group's contact list."
              className="text-[13px]"
              onCommit={(v) => {
                set({ email: v || undefined });
                if (v && v.split(/\s*[,;]\s*/).some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))
                  useStore.getState().toast('That email looks incomplete. It’s saved as typed; check it has an @ and a domain.');
              }}
            />
          </label>
        </div>

        <Section title="Family">
          <Relationships graph={graph} person={person} />
        </Section>

        <Section title="Groups">
          <PersonGroups graph={graph} person={person} />
        </Section>

        <Section title="Story">
          <EditableArea
            id="bio"
            label="Biography"
            hint="Their story in your own words. Saves when you click away."
            value={person.bio ?? ''}
            placeholder={`What should the family remember about ${person.givenName || 'them'}? Where they worked, what they loved, the stories people still tell.`}
            onCommit={(v) => set({ bio: v || undefined })}
          />
        </Section>

        <Section title="Voice memories" count={memories.length}>
          <AudioMemories person={person} memories={memories} />
        </Section>

        <Section title="Photos" count={photos.length}>
          <Gallery person={person} photos={photos} />
        </Section>

        <div className="border-t border-rule pt-4">
          <Hint text="Asks before deleting. You can also press the Delete key while a card is selected.">
            <button type="button" className="btn !text-petal" aria-keyshortcuts="Delete" onClick={() => void confirmDeletePerson(person.id)}>
              <Trash2 size={14} /> Remove from tree
            </button>
          </Hint>
        </div>
      </div>
    </motion.aside>
  );
}

/**
 * View-only shared tree: text fields become read-only and pickers disabled, so nobody
 * types into a field that can't be saved. Photos and voice memories still open and play.
 */
function useReadOnlyFields(ref: RefObject<HTMLDivElement>, readOnly: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !readOnly) return;
    const apply = () => {
      el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input:not([type=file]), textarea').forEach((f) => (f.readOnly = true));
      el.querySelectorAll<HTMLSelectElement | HTMLInputElement>('select, input[type=file]').forEach((f) => (f.disabled = true));
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [ref, readOnly]);
}
