// Налаштування (.claude/logic/10-settings.md): розділи й пошук; у кожного пункту опис, типове значення
// й «Скинути». Безпекові й грошові змінюються лише вручну, з підтвердженням кліком. Кожна зміна —
// у журнал дій (робить core).
import { SETTINGS, type SettingKey, type Settings } from '@banshee/shared';
import { useEffect, useState } from 'react';
import { AiStateCard } from '../components/AiStateCard.tsx';
import { DeviceSelect } from '../components/AudioDevices.tsx';
import { VoiceCard } from '../components/VoiceCard.tsx';
import { SECTION_TOPIC } from '../help/help-model.ts';
import { core, onCoreMessage } from '../core-client.ts';
import {
  controlForKey,
  formatValue,
  SETTING_SECTIONS,
  visibleKeys,
  type Control,
  type SectionId,
} from './settings-model.ts';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function Editor(props: {
  id: string;
  control: Control;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { control, value, onChange, id } = props;
  switch (control.kind) {
    case 'toggle':
      return (
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={value === true}
          onChange={(event) => {
            onChange(event.target.checked);
          }}
        />
      );
    case 'choice':
      return (
        <select
          id={id}
          value={String(value)}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          {control.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
    case 'number':
      return (
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={control.min ?? undefined}
          max={control.max ?? undefined}
          step={control.integer ? 1 : 'any'}
          value={typeof value === 'number' ? String(value) : ''}
          placeholder={control.nullable ? 'не задано' : undefined}
          onChange={(event) => {
            const raw = event.target.value.replace(',', '.');
            onChange(raw === '' && control.nullable ? null : Number(raw));
          }}
        />
      );
    case 'text':
      return (
        <input
          id={id}
          type="text"
          value={typeof value === 'string' ? value : ''}
          placeholder={control.nullable ? 'не задано' : undefined}
          onChange={(event) => {
            onChange(event.target.value === '' && control.nullable ? null : event.target.value);
          }}
        />
      );
    case 'lines':
      return (
        <textarea
          id={id}
          rows={6}
          value={Array.isArray(value) ? value.join('\n') : ''}
          onChange={(event) => {
            onChange(
              event.target.value
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean),
            );
          }}
        />
      );
    case 'checks':
      return (
        <fieldset id={id} className="checks">
          {control.options.map((option) => {
            const list = Array.isArray(value) ? (value as string[]) : [];
            return (
              <label key={option.value}>
                <input
                  type="checkbox"
                  checked={list.includes(option.value)}
                  onChange={(event) => {
                    onChange(
                      event.target.checked
                        ? [...list, option.value]
                        : list.filter((item) => item !== option.value),
                    );
                  }}
                />
                {option.label}
              </label>
            );
          })}
        </fieldset>
      );
    case 'group': {
      const record = (value ?? {}) as Record<string, unknown>;
      return (
        <fieldset id={id} className="group">
          {control.fields.map((field) => (
            <label key={field.name}>
              <span>{field.label}</span>
              <Editor
                id={`${id}-${field.name}`}
                control={field.control}
                value={record[field.name]}
                onChange={(next) => {
                  onChange({ ...record, [field.name]: next });
                }}
              />
            </label>
          ))}
        </fieldset>
      );
    }
    case 'device':
      return <DeviceSelect id={id} direction={control.direction} value={value} onChange={onChange} />;
    case 'json':
      return <JsonEditor id={id} value={value} onChange={onChange} />;
  }
}

function JsonEditor(props: { id: string; value: unknown; onChange: (value: unknown) => void }) {
  const [draft, setDraft] = useState(() => JSON.stringify(props.value, null, 2));
  const [error, setError] = useState(false);
  return (
    <>
      <textarea
        id={props.id}
        rows={8}
        className="code"
        value={draft}
        aria-invalid={error}
        onChange={(event) => {
          setDraft(event.target.value);
          try {
            props.onChange(JSON.parse(event.target.value));
            setError(false);
          } catch {
            setError(true);
          }
        }}
      />
      {error ? <span className="error">Не JSON</span> : null}
    </>
  );
}

/** Одразу зберігаємо перемикачі й вибір; решту — кнопкою «Зберегти». */
const instant = (control: Control): boolean =>
  control.kind === 'toggle' ||
  control.kind === 'choice' ||
  control.kind === 'checks' ||
  control.kind === 'device';

function SettingRow({ settingKey, value }: { settingKey: SettingKey; value: unknown }) {
  const def = SETTINGS[settingKey];
  const control = controlForKey(settingKey);
  const [draft, setDraft] = useState<unknown>(value);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<unknown>(undefined);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const save = (next: unknown) => {
    setError(null);
    setSaved(false);
    core.setSetting(settingKey, next).then(
      () => {
        setSaved(true);
      },
      (failure: unknown) => {
        setError(failure instanceof Error ? failure.message : String(failure));
        setDraft(value);
      },
    );
  };
  /** Безпекове чи грошове — лише з підтвердженням кліком (10-settings.md). */
  const request = (next: unknown) => {
    if (def.manualOnly) setConfirm(next);
    else save(next);
  };

  const id = `setting-${settingKey}`;
  const dirty = !same(draft, value);
  return (
    <div className="setting" id={id + '-row'}>
      <div className="setting-head">
        <label htmlFor={id}>{def.label}</label>
        {def.manualOnly ? <span className="chip warn">лише вручну</span> : null}
        {def.restart ? <span className="chip">після перезапуску</span> : null}
      </div>
      <p className="muted">{def.description}</p>
      <div className="setting-control">
        <Editor
          id={id}
          control={control}
          value={draft}
          onChange={(next) => {
            setDraft(next);
            if (instant(control)) request(next);
          }}
        />
        {!instant(control) ? (
          <button
            type="button"
            disabled={!dirty}
            onClick={() => {
              request(draft);
            }}
          >
            Зберегти
          </button>
        ) : null}
        <button
          type="button"
          className="secondary"
          disabled={same(value, def.defaultValue)}
          title={`Типово: ${formatValue(control, def.defaultValue)}`}
          onClick={() => {
            setDraft(def.defaultValue);
            request(def.defaultValue);
          }}
        >
          Скинути
        </button>
      </div>
      <p className="muted small">Типово: {formatValue(control, def.defaultValue)}</p>
      {confirm !== undefined ? (
        <div className="inline-confirm" role="alertdialog" aria-label="Підтвердження зміни">
          <p>
            Змінити «{def.label}» на {formatValue(control, confirm)}? Це безпекове чи грошове
            налаштування: голос і самонавчання його не змінюють.
          </p>
          <button
            type="button"
            onClick={() => {
              save(confirm);
              setConfirm(undefined);
            }}
          >
            Так, змінити
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setConfirm(undefined);
              setDraft(value);
            }}
          >
            Скасувати
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {saved && !error ? (
        <p className="ok small" role="status">
          Збережено, зміна — в журналі дій.
        </p>
      ) : null}
    </div>
  );
}

export function SettingsPage({
  anchor,
  onSectionChange,
  onHelp,
}: {
  anchor?: string | undefined;
  onSectionChange?: (section: SectionId) => void;
  onHelp?: (topic: string) => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [section, setSection] = useState<SectionId>('general');

  useEffect(() => {
    onSectionChange?.(section);
  }, [section, onSectionChange]);
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    core.settings().then(setSettings, () => undefined);
    return onCoreMessage((message) => {
      if (message.type === 'settings.changed') {
        setSettings((current) =>
          current ? { ...current, [message.key]: message.value } : current,
        );
      }
    });
  }, []);

  useEffect(() => {
    if (!anchor) return;
    const target = SETTING_SECTIONS.find(
      (item) => item.id === anchor || ('anchor' in item && item.anchor === anchor),
    );
    if (target) setSection(target.id);
    else if (anchor.includes('.')) setSection(anchor.split('.')[0] as SectionId);
    requestAnimationFrame(() => {
      document.getElementById(`setting-${anchor}-row`)?.scrollIntoView({ block: 'center' });
    });
  }, [anchor]);

  const keys = visibleKeys(query ? null : section, query, hidden);
  return (
    <div className="settings">
      <div className="settings-bar">
        <label className="visually-hidden" htmlFor="settings-search">
          Пошук налаштувань
        </label>
        <input
          id="settings-search"
          type="search"
          placeholder="Пошук налаштувань"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
        <label className="small">
          <input
            type="checkbox"
            checked={hidden}
            onChange={(event) => {
              setHidden(event.target.checked);
            }}
          />
          Додаткові
        </label>
      </div>
      {!query ? (
        <nav className="subnav" aria-label="Розділи налаштувань">
          {SETTING_SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === section ? 'current' : 'secondary'}
              aria-current={item.id === section ? 'page' : undefined}
              onClick={() => {
                setSection(item.id);
              }}
            >
              {item.title}
            </button>
          ))}
        </nav>
      ) : null}
      {!query && onHelp ? (
        <p>
          <button
            type="button"
            className="link"
            onClick={() => {
              onHelp(SECTION_TOPIC[`settings/${section}`] ?? 'start');
            }}
          >
            ? Довідка до розділу (F1)
          </button>
        </p>
      ) : null}
      {!query && section === 'ai' ? <AiStateCard withKey /> : null}
      {!query && section === 'voice' ? <VoiceCard /> : null}
      {settings ? (
        keys.map((key) => <SettingRow key={key} settingKey={key} value={settings[key]} />)
      ) : (
        <p>Завантажую налаштування…</p>
      )}
      {query && keys.length === 0 ? <p className="muted">Нічого не знайдено.</p> : null}
    </div>
  );
}
