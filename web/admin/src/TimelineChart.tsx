import type { TimelineBucket } from './api'

// TimelineChart: a small hand-rolled SVG line chart for request-volume
// trend lines. No charting library is added for this — a single-series
// (plus an error overlay) line over at most 168 points doesn't warrant
// pulling in a dependency; a viewBox-scaled SVG polyline is simpler to
// reason about and has zero bundle cost.
//
// Renders two overlaid lines: total request count (accent color) and
// error count (red), both scaled to the same y-axis (max of either
// series) so the error line's proportion to total volume is visible at a
// glance. Buckets are truncated to a fixed granularity by the backend
// (see store.TimelineBucket — RequestStatsTab passes 'hour', matching the
// backend's inbound RequestStatsTimeline; GeoAPIStatsTab passes 'minute',
// matching the backend's outbound GeoAPICallStatsTimeline) — gaps (empty
// buckets) are NOT interpolated as zero; the backend only emits buckets
// that have data, so a real gap in traffic shows as a visual gap in the
// line rather than a misleading flat zero segment.
export function TimelineChart({
  buckets,
  granularity,
}: {
  buckets: TimelineBucket[]
  // Controls x-axis label formatting only (the backend has already done
  // the actual bucketing at this granularity) — 'hour' labels omit
  // minutes since every bucket falls on the hour anyway, 'minute' labels
  // include minutes so buckets within the same hour are distinguishable.
  granularity: 'hour' | 'minute'
}) {
  const width = 640
  const height = 160
  const padding = { top: 8, right: 8, bottom: 20, left: 32 }
  const plotW = width - padding.left - padding.right
  const plotH = height - padding.top - padding.bottom

  // Defensive: if the backend response is momentarily missing this field
  // (e.g. an old server binary from before the timeline field was added,
  // or a network hiccup leaving state stale), fail soft into the empty
  // state rather than throwing and taking down the whole tab — there's no
  // error boundary wrapping this component.
  if (!buckets || buckets.length === 0) {
    return <div className="chart-empty muted">No data to chart in this window.</div>
  }

  const maxCount = Math.max(1, ...buckets.map((b) => b.count))
  const times = buckets.map((b) => new Date(b.bucketStart).getTime())
  const minTime = Math.min(...times)
  const maxTime = Math.max(...times)
  const timeSpan = maxTime - minTime || 1

  const x = (t: number) => padding.left + ((t - minTime) / timeSpan) * plotW
  const y = (count: number) => padding.top + plotH - (count / maxCount) * plotH

  const countPoints = buckets.map((b) => `${x(new Date(b.bucketStart).getTime())},${y(b.count)}`).join(' ')
  const errorPoints = buckets.map((b) => `${x(new Date(b.bucketStart).getTime())},${y(b.errorCount)}`).join(' ')

  // A handful of x-axis labels (first, middle, last) rather than one per
  // bucket — up to 168 buckets would make per-tick labels unreadable.
  const labelIdxs = Array.from(new Set([0, Math.floor((buckets.length - 1) / 2), buckets.length - 1]))
  const formatLabel = (iso: string) =>
    new Date(iso).toLocaleString(
      undefined,
      granularity === 'minute'
        ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
        : { month: 'numeric', day: 'numeric', hour: '2-digit' },
    )

  return (
    <svg
      className="timeline-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Request volume over time"
    >
      {/* y-axis gridlines at 0/50%/100% of max, with the max value labeled */}
      {[0, 0.5, 1].map((frac) => (
        <line
          key={frac}
          x1={padding.left}
          x2={width - padding.right}
          y1={padding.top + plotH * (1 - frac)}
          y2={padding.top + plotH * (1 - frac)}
          className="chart-gridline"
        />
      ))}
      <text x={padding.left - 6} y={padding.top + 4} textAnchor="end" className="chart-axis-label">
        {maxCount}
      </text>
      <text x={padding.left - 6} y={padding.top + plotH + 4} textAnchor="end" className="chart-axis-label">
        0
      </text>

      {labelIdxs.map((i) => (
        <text
          key={i}
          x={x(new Date(buckets[i].bucketStart).getTime())}
          y={height - 4}
          textAnchor="middle"
          className="chart-axis-label"
        >
          {formatLabel(buckets[i].bucketStart)}
        </text>
      ))}

      <polyline points={countPoints} className="chart-line-total" fill="none" />
      <polyline points={errorPoints} className="chart-line-error" fill="none" />
    </svg>
  )
}
