import { Check, Plus } from 'lucide-react';
import { groupList } from '../core/groups';
import type { FamilyGraph, Person } from '../core/types';
import { useStore } from '../data/store';
import { Hint } from '../ui/Hint';

/** Which family groups this person is in: click a chip to add or remove them. */
export function PersonGroups({ graph, person }: { graph: FamilyGraph; person: Person }) {
  const toggle = useStore((s) => s.toggleGroupMember);
  const createGroup = useStore((s) => s.createGroup);
  const groups = groupList(graph);
  const first = person.givenName || 'them';
  return (
    <div className="flex flex-wrap gap-1.5">
      {groups.map((gr) => {
        const on = gr.memberIds.includes(person.id);
        return (
          <Hint key={gr.id} text={on ? `Remove ${first} from ${gr.name}` : `Add ${first} to ${gr.name}`}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => void toggle(gr.id, person.id)}
              className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] font-semibold transition-colors"
              style={on ? { background: gr.color, borderColor: gr.color, color: '#F7F6EE' } : { borderColor: gr.color, color: gr.color }}
            >
              {on ? <Check size={13} /> : <Plus size={13} />}
              {gr.name}
              {gr.core && <span className="font-normal opacity-80">· main</span>}
            </button>
          </Hint>
        );
      })}
      <Hint text={`Start a new family group with ${first} in it, then click other cards to add them`}>
        <button
          type="button"
          onClick={() => void createGroup([person.id])}
          className="flex items-center gap-1 rounded-full border border-dashed border-rule px-2.5 py-1 text-[12.5px] font-semibold text-ink-muted hover:border-moss hover:text-moss-deep"
        >
          <Plus size={13} /> New group
        </button>
      </Hint>
    </div>
  );
}
