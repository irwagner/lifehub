import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { searchAllModules, type GlobalSearchHit } from '../repositories/searchRepo';
import { Modal } from './Modal';

export const GlobalSearchModal: React.FC<{
  open: boolean;
  onClose: () => void;
}> = ({ open, onClose }) => {
  const { db, setActiveSection } = useApp();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<GlobalSearchHit[]>([]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setHits([]);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!db || !open) return;
    let active = true;
    const handle = window.setTimeout(async () => {
      const res = await searchAllModules(db, query);
      if (active) setHits(res);
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(handle);
    };
  }, [db, open, query]);

  return (
    <Modal
      open={open}
      title="Busca Global (Ctrl+K)"
      subtitle="Pesquisa instantânea local em transações, tarefas, agenda, ideias, portfólio e vagas."
      onClose={onClose}
      maxWidthClass="max-w-xl"
    >
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Digite ao menos 2 caracteres..."
            className="lh-input pl-9"
          />
        </div>

        {query.trim().length < 2 ? (
          <p className="py-4 text-center text-xs text-slate-500">
            Exemplos: &ldquo;mercado&rdquo;, &ldquo;redes&rdquo;, &ldquo;entrevista&rdquo;, &ldquo;moto&rdquo;.
          </p>
        ) : hits.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-500">
            Nenhum registro encontrado para &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <ul className="max-h-80 space-y-1.5 overflow-y-auto">
            {hits.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  onClick={() => {
                    setActiveSection(hit.section);
                    onClose();
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 px-3.5 py-2.5 text-left text-xs transition hover:border-brand-500 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{hit.title}</p>
                    <p className="truncate text-slate-500">{hit.subtitle}</p>
                  </div>
                  <span className="shrink-0 rounded-md bg-brand-500/15 px-2 py-0.5 text-[10px] font-semibold text-brand-500">
                    {hit.sectionLabel}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
};
