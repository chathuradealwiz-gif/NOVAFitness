"use client";

interface Point {
  day: string;
  entries: number;
  exits: number;
}

/**
 * Inline SVG bar chart. No charting library: the dashboard is on Vercel's free
 * tier and this keeps the bundle small (spec "Vercel Free Hosting").
 */
export function AttendanceTrend({ data }: { data: Point[] }) {
  if (data.length === 0) {
    return <p className="py-10 text-center text-sm text-nova-muted">No attendance yet.</p>;
  }

  const max = Math.max(1, ...data.map((point) => Number(point.entries) + Number(point.exits)));
  const width = 100;
  const height = 40;
  const gap = 0.6;
  const barWidth = width / data.length - gap;

  return (
    <figure>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-40 w-full"
        role="img"
        aria-label={`Attendance over the last ${data.length} days`}
      >
        {data.map((point, index) => {
          const entries = Number(point.entries);
          const exits = Number(point.exits);
          const x = index * (barWidth + gap);
          const entryHeight = (entries / max) * height;
          const exitHeight = (exits / max) * height;

          return (
            <g key={point.day}>
              <rect
                x={x}
                y={height - entryHeight}
                width={barWidth}
                height={entryHeight}
                fill="#E11D2E"
                rx="0.4"
              />
              <rect
                x={x}
                y={height - entryHeight - exitHeight}
                width={barWidth}
                height={exitHeight}
                fill="#4B4B55"
                rx="0.4"
              />
            </g>
          );
        })}
      </svg>

      <figcaption className="mt-3 flex items-center justify-between text-xs text-nova-muted">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-nova-red" /> Entries
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-[#4B4B55]" /> Exits
          </span>
        </span>
        <span>
          {new Date(data[0].day).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} –{" "}
          {new Date(data[data.length - 1].day).toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
          })}
        </span>
      </figcaption>
    </figure>
  );
}
