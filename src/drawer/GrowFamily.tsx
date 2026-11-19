import { Link2, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { fullName, lifespan } from '../core/dates';
import { connectProblem, type ConnectAs } from '../core/relations';
import type { AddDirection, FamilyGraph, Person } from '../core/types';
import { useStore } from '../data/store';
import { Hint } from '../ui/Hint';

const ADD: { dir: AddDirection; label: string; hint: string }[] = [
  { dir: 'parent', label: 'Parent', hint: 'Adds a new parent above them. A second parent is joined to the first as a couple.' },
  { dir: 'partner', label: 'Partner', hint: 'Adds a husband, wife or partner beside them.' },
  { dir: 'child', label: 'Child', hint: 'Adds a child below them (and their current partner, if they have exactly one).' },
  { dir: 'sibling', label: 'Sibling', hint: 'Adds a brother or sister who shares their parents.' },
];

/** Buttons to add a new relative, plus a way to connect someone already in the tree. */
export function GrowFamily({ graph, person, connected }: { graph: FamilyGraph; person: Person; connected: boolean }) {
  const sprout = useStore((s) => s.sprout);
  const connectPeople = useStore((s) => s.connectPeople);
  const toast = useStore((s) => s.toast);
  const others = useMemo(
    () =>
      Object.values(graph.people)
        .filter((p) => p.id !== person.id)
        .sort((a, b) => fullName(a).localeCompare(fullName(b))),
    [graph.people, person.id],
  );
  // Someone with no relatives yet most likely needs connecting, so open the form for them.
  const [open, setOpen] = useState(!connected && others.length > 0);
  const [otherId, setOtherId] = useState('');
  const [as, setAs] = useState<ConnectAs>('parent');
  const problem = otherId ? connectProblem(graph, person.id, otherId, as) : null;
  const me = person.givenName || 'them';

  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <p className="mb-1.5 text-[12px] font-semibold text-ink-soft">Add a new relative</p>
        <div className="grid grid-cols-4 gap-1.5">
          {ADD.map((a) => (
            <Hint key={a.dir} text={a.hint}>
              <button
                type="button"
                className="btn justify-center !gap-1 !px-1 !py-1.5 !text-[12.5px]"
                onClick={() => void sprout(person.id, a.dir)}
                aria-label={`Add a ${a.label.toLowerCase()} for ${fullName(person)}`}
              >
                <Plus size={13} /> {a.label}
              </button>
            </Hint>
          ))}
        </div>
      </div>

      {others.length > 0 &&
        (open ? (
          <form
            className="flex flex-col gap-2 rounded-leaf-md border border-rule bg-card/70 p-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!otherId || problem) return;
              const other = graph.people[otherId];
              if (await connectPeople(person.id, otherId, as)) {
                toast(`${fullName(other)} is now ${me}’s ${as}.`);
                setOtherId('');
              }
            }}
          >
            <p className="text-[12px] font-semibold text-ink-soft">Connect someone already in the tree</p>
            <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-ink-soft">
              <Hint text="Pick the person to connect. Everyone in the tree is listed, including people not yet connected.">
                <select
                  className="select min-w-0 flex-1 !text-[12px]"
                  aria-label="Person to connect"
                  value={otherId}
                  onChange={(e) => setOtherId(e.target.value)}
                >
                  <option value="">Choose a person…</option>
                  {others.map((p) => (
                    <option key={p.id} value={p.id}>
                      {fullName(p)}
                      {lifespan(p) ? ` (${lifespan(p)})` : ''}
                    </option>
                  ))}
                </select>
              </Hint>
              <span>is {me}’s</span>
              <Hint text="How that person is related to this one. You can change the kind (birth, adoptive, step…) afterwards below.">
                <select className="select !text-[12px]" aria-label="Relationship" value={as} onChange={(e) => setAs(e.target.value as ConnectAs)}>
                  <option value="parent">parent</option>
                  <option value="partner">partner</option>
                  <option value="child">child</option>
                  <option value="sibling">sibling</option>
                </select>
              </Hint>
            </div>
            {problem && (
              <p className="text-[12px] text-petal" role="alert">
                {problem}
              </p>
            )}
            <div className="flex justify-end gap-2">
              {connected && (
                <button type="button" className="btn !py-1 !text-[12px]" onClick={() => setOpen(false)}>
                  Cancel
                </button>
              )}
              <button type="submit" className="btn-solid !py-1 !text-[12px]" disabled={!otherId || !!problem}>
                <Link2 size={13} /> Connect
              </button>
            </div>
          </form>
        ) : (
          <Hint text="Link this person to someone who is already on the tree, instead of creating a new card.">
            <button type="button" className="flex items-center gap-1.5 self-start text-[12.5px] font-semibold text-moss-deep hover:underline" onClick={() => setOpen(true)}>
              <Link2 size={13} /> Connect someone already in the tree
            </button>
          </Hint>
        ))}
    </div>
  );
}
