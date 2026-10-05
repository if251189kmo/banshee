// Розділ «Довідка» (.claude/logic/09-ui.md, «Довідка»): список тем і тема з посиланнями «Відкрити: …»,
// що ведуть просто на потрібний розділ чи налаштування.
import type { ReactNode } from 'react';
import type { Section } from '../../shared/ui.ts';
import { parseTopic, resolveLink, topicId, type HelpTopic, type Inline } from './help-model.ts';

const files = import.meta.glob<string>('../../../help/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export const TOPICS: readonly HelpTopic[] = Object.entries(files)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([file, text]) => parseTopic(topicId(file), text));
const IDS = TOPICS.map((topic) => topic.id);

function Text({ parts }: { parts: readonly Inline[] }): ReactNode {
  return parts.map((part, index) =>
    part.kind === 'bold' ? (
      <b key={index}>{part.text}</b>
    ) : part.kind === 'code' ? (
      <code key={index}>{part.text}</code>
    ) : (
      part.text
    ),
  );
}

export function Help(props: {
  topic: string | undefined;
  onTopic: (topic: string) => void;
  onNavigate: (section: Section, anchor?: string) => void;
}) {
  const current = TOPICS.find((topic) => topic.id === props.topic) ?? TOPICS[0];
  return (
    <div className="help">
      <nav className="help-topics" aria-label="Теми довідки">
        {TOPICS.map((topic) => (
          <button
            key={topic.id}
            type="button"
            className={topic.id === current?.id ? 'current' : 'secondary'}
            aria-current={topic.id === current?.id ? 'page' : undefined}
            onClick={() => {
              props.onTopic(topic.id);
            }}
          >
            {topic.title}
          </button>
        ))}
      </nav>
      {current ? (
        <article className="card help-topic" aria-labelledby="help-title">
          <h2 id="help-title">{current.title}</h2>
          {current.blocks.map((block, index) => {
            switch (block.kind) {
              case 'paragraph':
                return (
                  <p key={index}>
                    <Text parts={block.inlines} />
                  </p>
                );
              case 'list':
                return (
                  <ul key={index}>
                    {block.items.map((item, itemIndex) => (
                      <li key={itemIndex}>
                        <Text parts={item} />
                      </li>
                    ))}
                  </ul>
                );
              case 'table':
                return (
                  <table key={index}>
                    <thead>
                      <tr>
                        {block.header.map((cell, cellIndex) => (
                          <th key={cellIndex} scope="col">
                            <Text parts={cell} />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {block.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {row.map((cell, cellIndex) => (
                            <td key={cellIndex}>
                              <Text parts={cell} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                );
              case 'link': {
                const target = resolveLink(block.target, IDS);
                if (!target) return null;
                return (
                  <p key={index}>
                    <button
                      type="button"
                      className="link"
                      onClick={() => {
                        if (target.section === 'help') props.onTopic(target.anchor ?? IDS[0] ?? '');
                        else props.onNavigate(target.section, target.anchor);
                      }}
                    >
                      {block.text}
                    </button>
                  </p>
                );
              }
            }
          })}
        </article>
      ) : null}
    </div>
  );
}
