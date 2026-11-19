import { X } from 'lucide-react';
import { fullName, yearOf } from '../core/dates';
import { HEART_BROKEN_L, HEART_BROKEN_R, HEART_D } from '../core/paths';
import { childLinksOf, parentLinksOf, partnerIn, siblingsOf, sortedUnions, type SiblingKind } from '../core/relations';
import type { FamilyGraph, Id, ParentKind, Person, UnionStatus } from '../core/types';
import { useStore } from '../data/store';
import { ConfirmButton } from '../ui/bits';
import { DateInput } from '../ui/DateInput';
import { Hint } from '../ui/Hint';
import { Portrait } from '../ui/Portrait';
import { GrowFamily } from './GrowFamily';

/** Tiny swatch of the line style used on the canvas for this relationship. */
function Swatch({ kind }: { kind: ParentKind | 'partner' | 'former' | SiblingKind }) {
  const bark = '#8A6A4A';
  return (
    <svg viewBox="0 0 30 12" className="h-3 w-[30px] shrink-0 overflow-visible" aria-hidden="true">
      {kind === 'biological' || kind === 'full' || kind === 'half' ? (
        <>
          <path d="M1 10C10 10 18 2 29 2" fill="none" stroke="#7FA36B" strokeOpacity=".3" strokeWidth="6" strokeLinecap="round" />
          <path d="M1 10C10 10 18 2 29 2" fill="none" stroke="#3E6B48" strokeWidth="2" strokeLinecap="round" />
        </>
      ) : kind === 'partner' ? (
        <>
          <line x1="0" y1="6" x2="30" y2="6" stroke="#3E6B48" strokeWidth="1.3" />
          <path d={HEART_D} transform="translate(15 6.5) scale(.75)" fill="#A9566B" stroke="#E4E9DC" strokeWidth="1.6" paintOrder="stroke" />
        </>
      ) : kind === 'former' ? (
        <>
          <path d="M0 6H10M20 6H30" stroke="#6E7A66" strokeOpacity=".6" strokeWidth="1.2" />
          <g opacity=".65" transform="translate(15 6.5) scale(.7)">
            <path d={HEART_BROKEN_L} fill="#C9A0AB" transform="translate(-1 0) rotate(-8)" />
            <path d={HEART_BROKEN_R} fill="#C9A0AB" transform="translate(.6 .6) rotate(8)" />
          </g>
        </>
      ) : (
        <path
          d="M1 10C10 10 18 2 29 2"
          fill="none"
          stroke={bark}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeDasharray={kind === 'adoptive' ? '8 3 2 3' : kind === 'foster' ? '1 5' : '6 5'}
        />
      )}
    </svg>
  );
}

const PARENT_KINDS: { v: ParentKind; label: string }[] = [
  { v: 'biological', label: 'Birth' },
  { v: 'adoptive', label: 'Adoptive' },
  { v: 'step', label: 'Step' },
  { v: 'foster', label: 'Foster' },
];
const STATUSES: { v: UnionStatus; label: string }[] = [
  { v: 'current', label: 'Together' },
  { v: 'widowed', label: 'Widowed' },
  { v: 'separated', label: 'Separated' },
  { v: 'divorced', label: 'Divorced' },
];

function role(p: Person, m: string, f: string, n: string) {
  return p.sex === 'male' ? m : p.sex === 'female' ? f : n;
}

function Row({ who, kind, sub, onOpen, children }: { who: Person; kind: Parameters<typeof Swatch>[0]['kind']; sub: string; onOpen(id: Id): void; children?: React.ReactNode }) {
  return (
    <li className="flex flex-col gap-1.5 border-b border-[#DDE2D2] py-2 last:border-0">
      <div className="flex items-center gap-2.5">
        <Swatch kind={kind} />
        <button type="button" onClick={() => onOpen(who.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-moss-deep">
          <Portrait person={who} size={24} />
          <span className="min-w-0 flex-1 truncate font-display text-[14.5px]">{fullName(who)}</span>
        </button>
        <span className="shrink-0 font-label text-[11px] text-ink-muted">{sub}</span>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2 pl-[40px]">{children}</div>}
    </li>
  );
}

function RemoveLink({ onConfirm, what }: { onConfirm(): void; what: string }) {
  return (
    <ConfirmButton
      className="ml-auto flex items-center gap-1 rounded-leaf-sm border border-transparent px-1.5 py-0.5 text-[11px] text-ink-muted hover:border-rule"
      confirmLabel="Remove link?"
      ariaLabel={`Remove ${what} link`}
      onConfirm={onConfirm}
    >
      <X size={12} /> Unlink
    </ConfirmButton>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="label-caps mb-1 !text-[10px]">{title}</p>
      <ul className="m-0 list-none p-0">{children}</ul>
    </div>
  );
}

export function Relationships({ graph, person }: { graph: FamilyGraph; person: Person }) {
  const select = useStore((s) => s.select);
  const updateParentLink = useStore((s) => s.updateParentLink);
  const removeParentLink = useStore((s) => s.removeParentLink);
  const updateUnion = useStore((s) => s.updateUnion);
  const removeUnion = useStore((s) => s.removeUnion);
  const P = graph.people;

  const parents = parentLinksOf(graph, person.id).filter((l) => P[l.parentId]);
  const unions = sortedUnions(graph, person.id).filter((u) => P[partnerIn(u, person.id)]);
  const children = childLinksOf(graph, person.id)
    .filter((l) => P[l.childId])
    .sort((a, b) => (P[a.childId].birthDate ?? '9').localeCompare(P[b.childId].birthDate ?? '9'));
  const siblings = siblingsOf(graph, person.id).filter((s) => P[s.id]);

  const kindSelect = (id: Id, value: ParentKind, label: string) => (
    <Hint text="Birth, adoptive, step or foster. Each has its own line style on the tree.">
    <select
      className="select"
      aria-label={label}
      value={value}
      onChange={(e) => updateParentLink(id, { kind: e.target.value as ParentKind })}
    >
      {PARENT_KINDS.map((k) => (
        <option key={k.v} value={k.v}>
          {k.label}
        </option>
      ))}
    </select>
    </Hint>
  );

  const empty = !parents.length && !unions.length && !children.length && !siblings.length;
  if (empty)
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-ink-muted">Not connected to anyone yet.</p>
        <GrowFamily graph={graph} person={person} connected={false} />
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <GrowFamily graph={graph} person={person} connected />
      {parents.length > 0 && (
        <Group title="Parents">
          {parents.map((l) => {
            const p = P[l.parentId];
            const word =
              l.kind === 'biological'
                ? role(p, 'Father', 'Mother', 'Parent')
                : `${PARENT_KINDS.find((k) => k.v === l.kind)!.label} ${role(p, 'father', 'mother', 'parent')}`;
            return (
              <Row key={l.id} who={p} kind={l.kind} sub={word} onOpen={select}>
                {kindSelect(l.id, l.kind, `Kind of parent: ${fullName(p)}`)}
                {l.kind !== 'biological' && (
                  <span className="flex items-center gap-1 font-label text-[11px] text-ink-muted">
                    since
                    <DateInput
                      id={`since-${l.id}`}
                      label="Since"
                      value={l.since}
                      placeholder="year"
                      hint={`When the ${l.kind} relationship began, e.g. the year of adoption.`}
                      className="!w-[92px] !px-1 !py-0 font-label text-[11px]"
                      onCommit={(v) => updateParentLink(l.id, { since: v })}
                    />
                  </span>
                )}
                <RemoveLink what="parent" onConfirm={() => removeParentLink(l.id)} />
              </Row>
            );
          })}
        </Group>
      )}

      {unions.length > 0 && (
        <Group title="Partners">
          {unions.map((u) => {
            const o = P[partnerIn(u, person.id)];
            const former = u.status === 'divorced' || u.status === 'separated';
            const word = former
              ? role(o, 'Former husband', 'Former wife', 'Former partner')
              : u.kind === 'married'
                ? role(o, 'Husband', 'Wife', 'Spouse')
                : 'Partner';
            const yrs = [yearOf(u.start), yearOf(u.end)].filter(Boolean).join('–');
            return (
              <Row key={u.id} who={o} kind={former ? 'former' : 'partner'} sub={word + (yrs ? ` · ${yrs}` : '')} onOpen={select}>
                <Hint text="Married, or partners without marriage. Changes the label on the tree (m. 1962).">
                <select
                  className="select"
                  aria-label={`Marriage or partnership with ${fullName(o)}`}
                  value={u.kind}
                  onChange={(e) => updateUnion(u.id, { kind: e.target.value as 'married' | 'partners' })}
                >
                  <option value="married">Married</option>
                  <option value="partners">Partners</option>
                </select>
                </Hint>
                <Hint text="Divorced and separated couples are drawn with a faded, broken line.">
                <select
                  className="select"
                  aria-label={`Status with ${fullName(o)}`}
                  value={u.status}
                  onChange={(e) => updateUnion(u.id, { status: e.target.value as UnionStatus })}
                >
                  {STATUSES.map((s) => (
                    <option key={s.v} value={s.v}>
                      {s.label}
                    </option>
                  ))}
                </select>
                </Hint>
                <span className="flex items-center gap-1 font-label text-[11px] text-ink-muted">
                  <DateInput
                    id={`ustart-${u.id}`}
                    label={u.kind === 'married' ? 'Wedding date' : 'Got together'}
                    value={u.start}
                    placeholder="from"
                    hint={u.kind === 'married' ? 'Date of the wedding. A year is enough.' : 'When they got together. A year is enough.'}
                    className="!w-[92px] !px-1 !py-0 font-label text-[11px]"
                    onCommit={(v) => updateUnion(u.id, { start: v })}
                  />
                  –
                  <DateInput
                    id={`uend-${u.id}`}
                    label="End date"
                    value={u.end}
                    placeholder="to"
                    hint="When it ended (divorce, separation or a partner's death). Leave empty if it's ongoing."
                    className="!w-[92px] !px-1 !py-0 font-label text-[11px]"
                    onCommit={(v) => updateUnion(u.id, { end: v })}
                  />
                </span>
                <RemoveLink what="partner" onConfirm={() => removeUnion(u.id)} />
              </Row>
            );
          })}
        </Group>
      )}

      {children.length > 0 && (
        <Group title="Children">
          {children.map((l) => {
            const c = P[l.childId];
            const base = role(c, 'Son', 'Daughter', 'Child');
            const word = l.kind === 'biological' ? base : `${PARENT_KINDS.find((k) => k.v === l.kind)!.label} ${base.toLowerCase()}`;
            return (
              <Row key={l.id} who={c} kind={l.kind} sub={word} onOpen={select}>
                {kindSelect(l.id, l.kind, `Kind of child: ${fullName(c)}`)}
                <RemoveLink what="child" onConfirm={() => removeParentLink(l.id)} />
              </Row>
            );
          })}
        </Group>
      )}

      {siblings.length > 0 && (
        <Group title="Siblings">
          {siblings.map((s) => {
            const p = P[s.id];
            const base = role(p, 'brother', 'sister', 'sibling');
            const word = s.kind === 'full' ? base[0].toUpperCase() + base.slice(1) : `${s.kind[0].toUpperCase() + s.kind.slice(1)}-${base}`;
            return <Row key={s.id} who={p} kind={s.kind} sub={word} onOpen={select} />;
          })}
        </Group>
      )}
    </div>
  );
}
