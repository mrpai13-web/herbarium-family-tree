import { motion } from 'framer-motion';
import { Eye, EyeOff, Pencil, Plus, Star, Trash2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { GROUP_COLORS, groupList } from '../core/groups';
import { fullName } from '../core/dates';
import { useStore } from '../data/store';
import { EditableText } from './bits';
import { Hint } from './Hint';

/**
 * Family groups, opened from the title. Each group can be shown (a box is drawn around
 * its members), edited (click cards to add or remove them), made the main family (its
 * name becomes the title), renamed, recoloured or deleted.
 */
export function GroupsPanel({ onClose }: { onClose(): void }) {
  const graph = useStore((s) => s.graph);
  const shownGroupId = useStore((s) => s.shownGroupId);
  const groupEditing = useStore((s) => s.groupEditing);
  const selectedId = useStore((s) => s.selectedId);
  const s = useStore.getState;
  const groups = groupList(graph);
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!box.current?.contains(t) && !t.closest?.('[data-groups-toggle]')) close.current();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !useStore.getState().asking && close.current();
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, []);

  const selected = selectedId ? graph.people[selectedId] : undefined;
  const iconBtn = 'grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors hover:bg-mist';

  return (
    <motion.div
      ref={box}
      initial={{ opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.15 }}
      className="absolute left-0 top-[calc(100%+8px)] z-30 w-[min(360px,calc(100vw-24px))] origin-top-left rounded-leaf-md border border-rule bg-card p-3 shadow-lift"
      role="dialog"
      aria-label="Family groups"
    >
      <div className="flex items-center justify-between px-1 pb-2">
        <p className="label-caps">Family groups</p>
        <button type="button" className={iconBtn} onClick={onClose} aria-label="Close family groups">
          <X size={14} />
        </button>
      </div>

      {groups.length === 0 && (
        <p className="px-1 pb-3 text-[13px] leading-relaxed text-ink-soft">
          Groups gather people into named families, like “The Ashby Family” or “Mum’s side”. Make one the main family and its name
          becomes the title. Showing a group draws a box around its members on the tree.
        </p>
      )}

      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {groups.map((gr) => {
          const shown = shownGroupId === gr.id;
          const names = gr.memberIds.map((m) => graph.people[m]?.givenName).filter(Boolean);
          return (
            <li key={gr.id} className={`rounded-leaf-sm border p-2 transition-colors ${shown ? 'border-moss/40 bg-mist' : 'border-transparent'}`}>
              <div className="flex items-center gap-1.5">
                <Hint text="Change colour">
                  <button
                    type="button"
                    className="grid h-8 w-6 shrink-0 place-items-center"
                    aria-label={`Change colour of ${gr.name}`}
                    onClick={() => {
                      const i = GROUP_COLORS.indexOf(gr.color);
                      void s().updateGroup(gr.id, { color: GROUP_COLORS[(i + 1) % GROUP_COLORS.length] });
                    }}
                  >
                    <span className="block h-3.5 w-3.5 rounded-full ring-2 ring-card" style={{ background: gr.color }} />
                  </button>
                </Hint>
                <div className="min-w-0 flex-1">
                  <EditableText
                    id={`group-name-${gr.id}`}
                    label="Group name"
                    value={gr.name}
                    placeholder="Group name"
                    hint="Rename the group. If it’s the main family, this is the title."
                    className="!px-1 !py-0.5 font-display text-[15px] text-ink"
                    onCommit={(v) => v && void s().updateGroup(gr.id, { name: v })}
                  />
                </div>
              </div>
              <div className="flex items-center gap-0.5 pl-7">
                <p className="min-w-0 flex-1 truncate font-label text-[11px] text-ink-muted">
                  {gr.memberIds.length} {gr.memberIds.length === 1 ? 'person' : 'people'}
                  {names.length ? ` · ${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''}` : ' · empty'}
                </p>
                <Hint text={gr.core ? 'This is the main family: its name is the title' : 'Make this the main family (its name becomes the title)'}>
                  <button
                    type="button"
                    className={`${iconBtn} ${gr.core ? 'text-[#B08A2E]' : 'text-ink-muted'}`}
                    aria-pressed={!!gr.core}
                    aria-label={`Main family: ${gr.name}`}
                    onClick={() => void s().setCoreGroup(gr.core ? null : gr.id)}
                  >
                    <Star size={15} fill={gr.core ? 'currentColor' : 'none'} />
                  </button>
                </Hint>
                <Hint text={shown ? 'Hide the box' : 'Show a box around this group on the tree'}>
                  <button
                    type="button"
                    className={`${iconBtn} ${shown ? 'text-moss-deep' : 'text-ink-muted'}`}
                    aria-pressed={shown}
                    aria-label={`Show ${gr.name} on the tree`}
                    onClick={() => s().showGroup(shown ? null : gr.id)}
                  >
                    {shown ? <Eye size={15} /> : <EyeOff size={15} />}
                  </button>
                </Hint>
                <Hint text="Add or remove people by clicking their cards">
                  <button
                    type="button"
                    className={`${iconBtn} ${shown && groupEditing ? 'bg-moss text-card hover:bg-moss-deep' : 'text-ink-muted'}`}
                    aria-pressed={shown && groupEditing}
                    aria-label={`Edit members of ${gr.name}`}
                    onClick={() => {
                      s().showGroup(gr.id);
                      s().setGroupEditing(!(shown && groupEditing));
                      onClose();
                    }}
                  >
                    <Pencil size={14} />
                  </button>
                </Hint>
                <Hint text="Delete this group (the people stay)">
                  <button
                    type="button"
                    className={`${iconBtn} text-ink-muted hover:!text-petal`}
                    aria-label={`Delete group ${gr.name}`}
                    onClick={async () => {
                      const ok = await s().ask({
                        title: `Delete the group “${gr.name}”?`,
                        body: 'Only the group goes; everyone in it stays on the tree. You can undo this with Ctrl+Z.',
                        confirmLabel: 'Delete group',
                        danger: true,
                      });
                      if (ok) void s().deleteGroup(gr.id);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </Hint>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-2 flex flex-col gap-1.5 border-t border-rule pt-2.5">
        <button
          type="button"
          className="btn justify-center !py-1.5 !text-[13px]"
          onClick={async () => {
            await s().createGroup(selected ? [selected.id] : []);
            onClose();
          }}
        >
          <Plus size={14} /> New group{selected ? ` starting with ${fullName(selected)}` : ''}
        </button>
        <p className="px-1 text-[11px] leading-snug text-ink-muted">
          A new group opens for editing: click cards on the tree to add or remove people, then press Done.
        </p>
      </div>
    </motion.div>
  );
}
