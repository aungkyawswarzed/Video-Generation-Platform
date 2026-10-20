'use client';
import { useId, useRef, useState } from 'react';
import type { Project, Shot } from '@/lib/types';
import { activeMentions, mentionOptions, type MentionOption } from '@/lib/mentions';
import { Users, Box, MapPin, Clapperboard, AtSign } from 'lucide-react';

export default function MentionEditor({
  project,
  shot,
  value,
  onChange,
  label = 'Video prompt',
  placeholder,
}: {
  project: Project;
  shot: Shot;
  value: string;
  onChange: (value: string, mentions: Shot['mentions'], assetIds: string[]) => void;
  label?: string;
  placeholder?: string;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const fieldId = useId();
  const [query, setQuery] = useState<{ start: number; end: number; text: string } | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const options = mentionOptions(project)
    .filter(
      (option) =>
        !query?.text ||
        `${option.name} ${option.kind}`.toLowerCase().includes(query.text.toLowerCase()),
    )
    .slice(0, 12);
  function findQuery(text: string, position: number) {
    const before = text.slice(0, position);
    const match = /(?:^|\s)@([^@\[\]\n]{0,64})$/.exec(before);
    if (!match) {
      setQuery(null);
      return;
    }
    setQuery({ start: position - match[1].length - 1, end: position, text: match[1] });
    setHighlighted(0);
  }
  function update(text: string) {
    const kept = activeMentions(shot, text);
    const removed = (shot.mentions || [])
      .filter((binding) => !kept.includes(binding) && binding.kind !== 'scene')
      .map((binding) => binding.id);
    onChange(
      text,
      kept,
      shot.assetIds.filter((assetId) => !removed.includes(assetId)),
    );
  }
  function choose(option: MentionOption) {
    if (!query) return;
    const duplicates =
      mentionOptions(project).filter((item) => item.name === option.name).length > 1;
    const token = `@[${option.name.replace(/[\[\]\n]/g, ' ').slice(0, 180)}${duplicates ? ` · ${option.kind} ${option.id.slice(0, 6)}` : ''}]`;
    const text = value.slice(0, query.start) + token + ' ' + value.slice(query.end);
    const bindings = [
      ...(shot.mentions || []).filter(
        (binding) => binding.token !== token && text.includes(binding.token),
      ),
      { id: option.id, kind: option.kind, token },
    ];
    onChange(
      text,
      bindings,
      option.kind === 'scene' ? shot.assetIds : [...new Set([...shot.assetIds, option.id])],
    );
    const position = query.start + token.length + 1;
    setQuery(null);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(position, position);
    });
  }
  return (
    <div className="mention-editor">
      <label htmlFor={fieldId}>{label}</label>
      <div className="mention-textarea-wrap">
        <textarea
          ref={textarea}
          id={fieldId}
          rows={5}
          maxLength={12000}
          value={value}
          placeholder={
            placeholder || 'Describe your video. Type @ to choose a character, scene, or prop…'
          }
          aria-controls={query ? listId : undefined}
          aria-expanded={!!query}
          aria-autocomplete="list"
          aria-activedescendant={
            query && options.length ? `${listId}-option-${highlighted}` : undefined
          }
          onChange={(event) => {
            update(event.target.value);
            findQuery(event.target.value, event.target.selectionStart);
          }}
          onClick={(event) => findQuery(value, event.currentTarget.selectionStart)}
          onKeyDown={(event) => {
            if (!query) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              setQuery(null);
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setHighlighted((index) =>
                options.length
                  ? (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
                  : 0,
              );
            } else if (
              (event.key === 'Enter' || event.key === 'Tab') &&
              !event.shiftKey &&
              options.length
            ) {
              event.preventDefault();
              choose(options[highlighted] || options[0]);
            }
          }}
          onBlur={() => setQuery(null)}
        />
        {query && (
          <div className="mention-menu" id={listId} role="listbox" aria-label="Mention suggestions">
            <div className="mention-menu-title">
              <AtSign size={15} /> Add story context <small>↑ ↓ choose · Enter to insert</small>
            </div>
            {options.map((option, index) => (
              <button
                key={`${option.kind}-${option.id}`}
                id={`${listId}-option-${index}`}
                role="option"
                aria-selected={highlighted === index}
                className={highlighted === index ? 'highlighted' : ''}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
              >
                {option.kind === 'character' ? (
                  <Users size={17} />
                ) : option.kind === 'prop' ? (
                  <Box size={17} />
                ) : option.kind === 'scene' ? (
                  <Clapperboard size={17} />
                ) : (
                  <MapPin size={17} />
                )}
                <span>
                  <strong>{option.name}</strong>
                  <small>{option.kind}</small>
                </span>
                <span className="mention-description">
                  {option.description.slice(0, 65) || 'No description yet'}
                </span>
              </button>
            ))}
            {!options.length && (
              <p>No matches. Add characters, locations, or props in the Library, or add a scene.</p>
            )}
          </div>
        )}
      </div>
      <div className="mention-hint">
        <AtSign size={14} /> Choose characters, scenes, locations, and props. Mentions add
        descriptions—not photos.
      </div>
      {!!activeMentions(shot, value).length && (
        <div className="mention-chips">
          {activeMentions(shot, value).map((binding) => {
            const target = mentionOptions(project).find(
              (o) => o.id === binding.id && o.kind === binding.kind,
            );
            return (
              <span key={binding.token} className={target ? '' : 'missing'}>
                @{target?.name || 'Deleted item'} <small>{binding.kind}</small>
                <button
                  type="button"
                  aria-label={`Remove mention ${target?.name || binding.token}`}
                  onClick={() => update(value.split(binding.token).join(target?.name || ''))}
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
