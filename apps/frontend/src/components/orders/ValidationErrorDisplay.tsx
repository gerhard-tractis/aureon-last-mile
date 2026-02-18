'use client';

import React from 'react';
import { CheckCircle, XCircle } from 'lucide-react';
import { ValidationError } from '@/lib/validation/orderImportValidation';

interface ValidationErrorDisplayProps {
  data: Record<string, string>[];
  errors: ValidationError[];
  previewLimit?: number;
}

export default function ValidationErrorDisplay({
  data,
  errors,
  previewLimit = 10,
}: ValidationErrorDisplayProps) {
  // Build error map: rowIndex -> errors[]
  const errorsByRow = new Map<number, ValidationError[]>();
  errors.forEach((err) => {
    const existing = errorsByRow.get(err.row) || [];
    existing.push(err);
    errorsByRow.set(err.row, existing);
  });

  const validCount = data.filter((_, i) => !errorsByRow.has(i + 2)).length;
  const errorCount = data.filter((_, i) => errorsByRow.has(i + 2)).length;

  const previewData = data.slice(0, previewLimit);
  const columns = data.length > 0 ? Object.keys(data[0]) : [];

  return (
    <div className="space-y-4">
      {/* Preview Table */}
      <div className="overflow-x-auto border rounded-lg">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                Status
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                Row
              </th>
              {columns.map((col) => (
                <th
                  key={col}
                  className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {previewData.map((row, index) => {
              const rowNum = index + 2; // row 1 = header
              const rowErrors = errorsByRow.get(rowNum) || [];
              const hasError = rowErrors.length > 0;
              const errorFields = new Set(rowErrors.map((e) => e.field));

              return (
                <React.Fragment key={index}>
                  <tr className={hasError ? 'bg-red-50' : ''}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {hasError ? (
                        <XCircle className="w-4 h-4 text-red-500" />
                      ) : (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-gray-500">
                      {rowNum}
                    </td>
                    {columns.map((col) => (
                      <td
                        key={col}
                        className={`px-3 py-2 whitespace-nowrap ${
                          errorFields.has(col) ? 'text-red-700 font-medium' : 'text-gray-700'
                        }`}
                      >
                        {row[col] || ''}
                      </td>
                    ))}
                  </tr>
                  {hasError && (
                    <tr className="bg-red-50">
                      <td colSpan={columns.length + 2} className="px-3 py-1">
                        <div className="flex flex-wrap gap-2">
                          {rowErrors.map((err, ei) => (
                            <span
                              key={ei}
                              className="text-xs text-red-600 bg-red-100 px-2 py-0.5 rounded"
                            >
                              {err.field}: {err.message}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {data.length > previewLimit && (
        <p className="text-xs text-gray-500 text-center">
          Showing first {previewLimit} of {data.length} rows
        </p>
      )}

      {/* Summary */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-lg border">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1 text-sm">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <strong>{validCount}</strong> valid rows
          </span>
          {errorCount > 0 && (
            <span className="flex items-center gap-1 text-sm">
              <XCircle className="w-4 h-4 text-red-500" />
              <strong>{errorCount}</strong> errors
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Export failed rows as CSV with error column.
 */
export function exportFailedRowsAsCSV(
  data: Record<string, string>[],
  errors: ValidationError[]
): void {
  const errorsByRow = new Map<number, string[]>();
  errors.forEach((e) => {
    const messages = errorsByRow.get(e.row) || [];
    messages.push(`${e.field}: ${e.message}`);
    errorsByRow.set(e.row, messages);
  });

  const failedRows = data
    .map((row, index) => {
      const rowErrors = errorsByRow.get(index + 2);
      return rowErrors ? { ...row, errors: rowErrors.join('; ') } : null;
    })
    .filter(Boolean) as Record<string, string>[];

  if (failedRows.length === 0) return;

  // Build CSV manually — union all keys across rows to handle optional fields
  const headerSet = new Set<string>();
  failedRows.forEach((row) => Object.keys(row).forEach((k) => headerSet.add(k)));
  const headers = Array.from(headerSet);
  const csvRows = [
    headers.join(','),
    ...failedRows.map((row) =>
      headers.map((h) => `"${(row[h] || '').replace(/"/g, '""')}"`).join(',')
    ),
  ];
  const csvContent = csvRows.join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `failed_orders_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
