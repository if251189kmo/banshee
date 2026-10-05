// Графіки «Активності» (.claude/logic/09-ui.md, «Активність»): SVG без бібліотек. Серії розрізняються
// не лише кольором, а й візерунком і підписом; у кожного графіка — «Показати таблицею».
import { useId, useState, type ReactNode } from 'react';

export interface TableData {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export function ChartCard(props: { title: string; table: TableData; children: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="card chart">
      <header>
        <h3>{props.title}</h3>
        <button
          type="button"
          className="link"
          aria-pressed={asTable}
          onClick={() => {
            setAsTable(!asTable);
          }}
        >
          {asTable ? 'Показати графіком' : 'Показати таблицею'}
        </button>
      </header>
      {asTable ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {props.table.headers.map((header) => (
                  <th key={header} scope="col">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {props.table.rows.map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, index) => (
                    <td key={index}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        props.children
      )}
    </section>
  );
}

export interface BarSeries {
  readonly label: string;
  readonly values: readonly number[];
  /** Клас кольору; візерунок — для другої серії, щоб розрізняти без кольору. */
  readonly className: string;
  readonly hatched?: boolean;
}

const WIDTH = 640;
const HEIGHT = 180;
const PAD = { top: 10, right: 8, bottom: 22, left: 36 };

function axisLabels(labels: readonly string[]): { index: number; text: string }[] {
  const step = Math.max(1, Math.ceil(labels.length / 8));
  const last = labels.length - 1;
  const lastRegular = last - (last % step);
  // Останній день підписуємо, лише якщо він не налазить на попередній підпис.
  return labels.flatMap((text, index) =>
    index % step === 0 || (index === last && last - lastRegular >= step / 2)
      ? [{ index, text }]
      : [],
  );
}

/** Стовпчики за днями, серії одна над одною; limit — горизонтальна лінія (денний ліміт). */
export function StackedBars(props: {
  labels: readonly string[];
  series: readonly BarSeries[];
  limit?: { value: number; label: string };
  format: (value: number) => string;
}) {
  const hatch = useId();
  const totals = props.labels.map((_, index) =>
    props.series.reduce((sum, series) => sum + (series.values[index] ?? 0), 0),
  );
  const max = Math.max(props.limit?.value ?? 0, ...totals, 1e-9);
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const step = plotW / Math.max(1, props.labels.length);
  const barW = Math.max(1, step * 0.7);
  const y = (value: number) => PAD.top + plotH - (value / max) * plotH;
  return (
    <figure className="figure">
      <svg viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`} role="img" aria-hidden="true">
        <defs>
          <pattern
            id={hatch}
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" className="hatch-bg" />
            <line x1="0" y1="0" x2="0" y2="6" className="hatch-line" />
          </pattern>
        </defs>
        <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(0)} y2={y(0)} className="axis" />
        <text x={PAD.left - 4} y={y(max) + 4} className="tick" textAnchor="end">
          {props.format(max)}
        </text>
        {props.labels.map((_, index) => {
          let base = 0;
          return props.series.map((series) => {
            const value = series.values[index] ?? 0;
            const top = y(base + value);
            const rect = (
              <rect
                key={`${series.label}-${String(index)}`}
                x={PAD.left + index * step + (step - barW) / 2}
                y={top}
                width={barW}
                height={Math.max(0, y(base) - top)}
                className={series.className}
                {...(series.hatched ? { fill: `url(#${hatch})` } : {})}
              />
            );
            base += value;
            return rect;
          });
        })}
        {props.limit ? (
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={y(props.limit.value)}
            y2={y(props.limit.value)}
            className="limit"
          />
        ) : null}
        {axisLabels(props.labels).map(({ index, text }) => (
          <text
            key={index}
            x={PAD.left + index * step + step / 2}
            y={HEIGHT - 6}
            className="tick"
            textAnchor="middle"
          >
            {text}
          </text>
        ))}
      </svg>
      <figcaption className="legend">
        {props.series.map((series) => (
          <span key={series.label}>
            <i className={`swatch ${series.className}${series.hatched ? ' hatched' : ''}`} />
            {series.label}
          </span>
        ))}
        {props.limit ? (
          <span>
            <i className="swatch limit-swatch" />
            {props.limit.label}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

/** Лінія частки 0…1 з пунктиром цілі; дні без ходів — розриви. */
export function ShareLine(props: {
  labels: readonly string[];
  values: readonly (number | null)[];
  target?: { value: number; label: string };
  label: string;
}) {
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const step = plotW / Math.max(1, props.labels.length - 1);
  const x = (index: number) => PAD.left + index * step;
  const y = (value: number) => PAD.top + plotH - value * plotH;
  let path = '';
  props.values.forEach((value, index) => {
    if (value === null) return;
    const previous = index > 0 ? props.values[index - 1] : null;
    path += `${previous === null || previous === undefined ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)} `;
  });
  return (
    <figure className="figure">
      <svg viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`} role="img" aria-hidden="true">
        <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(0)} y2={y(0)} className="axis" />
        <text x={PAD.left - 4} y={y(1) + 4} className="tick" textAnchor="end">
          100 %
        </text>
        {props.target ? (
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={y(props.target.value)}
            y2={y(props.target.value)}
            className="target"
          />
        ) : null}
        <path d={path} className="share-line" />
        {props.values.map((value, index) =>
          value === null ? null : (
            <circle key={index} cx={x(index)} cy={y(value)} r="2.5" className="share-dot" />
          ),
        )}
        {axisLabels(props.labels).map(({ index, text }) => (
          <text key={index} x={x(index)} y={HEIGHT - 6} className="tick" textAnchor="middle">
            {text}
          </text>
        ))}
      </svg>
      <figcaption className="legend">
        <span>
          <i className="swatch share-swatch" />
          {props.label}
        </span>
        {props.target ? (
          <span>
            <i className="swatch target-swatch" />
            {props.target.label}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
