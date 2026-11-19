import { AnimatePresence, motion } from 'framer-motion';
import { Copy, Download, Mail, Printer, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { contactCsv, contactList, contactText, type ContactList as List } from '../core/contacts';
import { useStore } from '../data/store';

/**
 * A family group's contact list, from everyone's Phone and Email: copy it, download it as a
 * spreadsheet (CSV), print it, or email everyone. People without contact details are listed
 * too, with a button that opens their profile to add them.
 */
export function ContactList() {
  const groupId = useStore((s) => s.contactListGroupId);
  const group = useStore((s) => (s.contactListGroupId ? s.graph.groups?.[s.contactListGroupId] : undefined));
  const graph = useStore((s) => s.graph);
  const close = () => useStore.getState().openContactList(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!groupId) return;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
      if (e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [groupId]);

  const list = group ? contactList(graph, group) : null;
  const title = group ? `${group.name}: contacts` : '';
  const withContact = list?.rows.filter((r) => r.phones.length || r.emails.length).length ?? 0;
  const emails = list ? [...new Set(list.rows.flatMap((r) => r.emails))] : [];

  return (
    <AnimatePresence>
      {group && list && (
        <motion.div
          key="contacts"
          className="fixed inset-0 z-[70] grid place-items-center bg-ink/40 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onPointerDown={(e) => e.target === e.currentTarget && close()}
          data-no-pan
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="contacts-title"
            initial={{ scale: 0.96, y: 8 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0 }}
            className="flex max-h-[min(720px,calc(100vh-32px))] w-full max-w-2xl flex-col rounded-leaf border border-rule bg-card shadow-lift"
          >
            <div className="flex items-start justify-between gap-3 border-b border-rule px-5 pb-3 pt-5">
              <div className="min-w-0">
                <p className="label-caps flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: group.color }} />
                  Contact list
                </p>
                <h2 id="contacts-title" className="mt-1 font-display text-[22px] leading-snug">
                  {group.name}
                </h2>
                <p className="mt-0.5 text-[12.5px] text-ink-muted">
                  {withContact} of {list.rows.length} {list.rows.length === 1 ? 'person has' : 'people have'} contact details
                  {list.deceased ? ` · ${list.deceased} who ${list.deceased === 1 ? 'has' : 'have'} died not listed` : ''}
                </p>
              </div>
              <button ref={closeBtn} type="button" className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-mist" onClick={close} aria-label="Close contact list">
                <X size={16} />
              </button>
            </div>

            <ul className="m-0 min-h-0 flex-1 list-none overflow-y-auto px-3 py-2">
              {list.rows.length === 0 && (
                <li className="px-2 py-6 text-center text-[13px] text-ink-soft">Nobody living is in this group yet.</li>
              )}
              {list.rows.length > 0 && (
                <li className="hidden grid-cols-[1.1fr_1fr_1.3fr] gap-3 px-2 pb-1 pt-1 sm:grid" aria-hidden="true">
                  <span className="label-caps">Name</span>
                  <span className="label-caps">Phone</span>
                  <span className="label-caps">Email</span>
                </li>
              )}
              {list.rows.map((r) => (
                <li key={r.person.id} className="grid grid-cols-1 gap-x-3 gap-y-0.5 rounded-leaf-sm px-2 py-2 odd:bg-mist/50 sm:grid-cols-[1.1fr_1fr_1.3fr] sm:items-baseline">
                  <span className="truncate font-display text-[15px]">{r.name}</span>
                  {r.phones.length || r.emails.length ? (
                    <>
                      <Links items={r.phones} href={(t) => `tel:${t.replace(/[^\d+]/g, '')}`} />
                      <Links items={r.emails} href={(t) => `mailto:${t}`} />
                    </>
                  ) : (
                    <span className="sm:col-span-2">
                      <button
                        type="button"
                        className="font-label text-[12px] italic text-ink-muted underline decoration-dotted underline-offset-2 hover:text-moss-deep"
                        onClick={() => {
                          close();
                          useStore.getState().select(r.person.id);
                        }}
                      >
                        No phone or email yet. Add one
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-rule px-5 py-3">
              {emails.length > 0 && (
                <a className="btn !py-1.5 !text-[13px]" href={`mailto:?bcc=${emails.map(encodeURIComponent).join(',')}`}>
                  <Mail size={14} /> Email everyone
                </a>
              )}
              <button type="button" className="btn !py-1.5 !text-[13px]" onClick={() => void copy(title, list)}>
                <Copy size={14} /> Copy
              </button>
              <button type="button" className="btn !py-1.5 !text-[13px]" onClick={() => download(group.name, list)}>
                <Download size={14} /> Spreadsheet
              </button>
              <button type="button" className="btn-solid !py-1.5 !text-[13px]" onClick={() => print(group.name, list)}>
                <Printer size={14} /> Print
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Links({ items, href }: { items: string[]; href(t: string): string }) {
  if (!items.length) return <span className="text-[13px] text-ink-muted/60">—</span>;
  return (
    <span className="min-w-0 break-words text-[13px]">
      {items.map((t, i) => (
        <span key={i}>
          {i > 0 && ', '}
          <a className="text-moss-deep underline decoration-moss/30 underline-offset-2 hover:decoration-moss" href={href(t)}>
            {t}
          </a>
        </span>
      ))}
    </span>
  );
}

async function copy(title: string, list: List) {
  try {
    await navigator.clipboard.writeText(contactText(title, list));
    useStore.getState().toast('Contact list copied');
  } catch {
    useStore.getState().toast('Couldn’t copy. Try Print or Spreadsheet instead.', 'error');
  }
}

function download(name: string, list: List) {
  // A BOM so Excel reads accented names correctly.
  const blob = new Blob(['﻿' + contactCsv(list)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'Family'} contacts.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function print(name: string, list: List) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const cell = (xs: string[]) => (xs.length ? xs.map(esc).join('<br>') : '<span class="none">—</span>');
  const rows = list.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${cell(r.phones)}</td><td>${cell(r.emails)}</td></tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)}: contacts</title><style>
    body{font:14px/1.5 Georgia,serif;color:#2a2a24;margin:32px}h1{font-size:24px;margin:0 0 4px}p{color:#777;margin:0 0 18px;font-size:12px}
    table{border-collapse:collapse;width:100%}td{padding:7px 10px;border-bottom:1px solid #ddd;vertical-align:top}th{text-align:left;font:600 11px sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#777;padding:6px 10px;border-bottom:2px solid #ccc}td:first-child{width:34%;font-weight:600}.none{color:#aaa}
  </style></head><body><h1>${esc(name)}</h1><p>Contact list · ${new Date().toLocaleDateString()}</p><table><tr><th>Name</th><th>Phone</th><th>Email</th></tr>${rows}</table></body></html>`;
  const w = window.open('', '_blank');
  if (!w) {
    useStore.getState().toast('Your browser blocked the print window. Allow pop-ups for this page and try again.', 'error');
    return;
  }
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}
