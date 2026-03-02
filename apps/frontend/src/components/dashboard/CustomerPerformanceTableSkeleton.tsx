'use client';

export default function CustomerPerformanceTableSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
      {/* Header skeleton */}
      <div className="flex items-center justify-between mb-4">
        <div className="h-6 w-48 bg-slate-200 rounded animate-pulse" />
        <div className="h-9 w-28 bg-slate-200 rounded animate-pulse" />
      </div>
      {/* Controls skeleton */}
      <div className="flex items-center gap-4 mb-4">
        <div className="h-9 w-48 bg-slate-200 rounded animate-pulse" />
        <div className="h-9 w-40 bg-slate-200 rounded animate-pulse" />
      </div>
      {/* Table skeleton */}
      <table className="w-full">
        <thead>
          <tr className="border-b-2 border-slate-100">
            {['25%', '15%', '15%', '15%', '15%', '15%'].map((w, i) => (
              <th key={i} style={{ width: w }} className="py-3 px-4">
                <div className="h-4 bg-slate-200 rounded animate-pulse" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 5 }).map((_, i) => (
            <tr key={i} className="border-b border-slate-100">
              {Array.from({ length: 6 }).map((_, j) => (
                <td key={j} className="py-4 px-4">
                  <div className="h-4 bg-slate-200 rounded animate-pulse" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
