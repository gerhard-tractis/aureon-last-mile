'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, CheckCircle, Download, Loader2, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { createSPAClient } from '@/lib/supabase/client';
import FileUploadForm from '@/components/orders/FileUploadForm';
import ValidationErrorDisplay, { exportFailedRowsAsCSV } from '@/components/orders/ValidationErrorDisplay';
import { parseOrdersFile, ParseResult } from '@/lib/parsers/orderFileParser';
import {
  validateColumns,
  validateAllRows,
  findDuplicates,
  ValidationError,
} from '@/lib/validation/orderImportValidation';

interface ImportState {
  originalFile: File | null;
  parseResult: ParseResult | null;
  errors: ValidationError[];
  validCount: number;
  errorCount: number;
  isImporting: boolean;
  importComplete: boolean;
  importedCount: number;
  skippedCount: number;
}

const initialState: ImportState = {
  originalFile: null,
  parseResult: null,
  errors: [],
  validCount: 0,
  errorCount: 0,
  isImporting: false,
  importComplete: false,
  importedCount: 0,
  skippedCount: 0,
};

const ALLOWED_ROLES = ['admin', 'operations_manager'];

export default function ImportOrdersPage() {
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | undefined>();
  const [state, setState] = useState<ImportState>(initialState);
  const [roleCheck, setRoleCheck] = useState<'loading' | 'allowed' | 'denied'>('loading');

  useEffect(() => {
    const supabase = createSPAClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      const role = session?.user?.app_metadata?.claims?.role;
      setRoleCheck(ALLOWED_ROLES.includes(role) ? 'allowed' : 'denied');
    });
  }, []);

  const handleFileSelected = useCallback(async (file: File) => {
    setIsParsing(true);
    setParseError(undefined);
    setState(initialState);

    try {
      const result = await parseOrdersFile(file);

      // Column validation
      const missingColumns = validateColumns(result.meta.fields);
      if (missingColumns.length > 0) {
        setParseError(`Missing required column: ${missingColumns.join(', ')}`);
        setIsParsing(false);
        return;
      }

      // Row + duplicate validation
      const rowErrors = validateAllRows(result.data);
      const duplicates = findDuplicates(result.data);
      const allErrors = [...rowErrors, ...duplicates];

      const errorRows = new Set(allErrors.map((e) => e.row));
      const validCount = result.data.filter((_, i) => !errorRows.has(i + 2)).length;

      setState({
        ...initialState,
        originalFile: file,
        parseResult: result,
        errors: allErrors,
        validCount,
        errorCount: result.data.length - validCount,
      });
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse file');
    } finally {
      setIsParsing(false);
    }
  }, []);

  const handleImport = useCallback(async () => {
    if (!state.originalFile || !state.parseResult || state.validCount === 0) return;

    setState((prev) => ({ ...prev, isImporting: true }));

    try {
      // Send original file for server-side re-validation (preserves raw data integrity)
      const formData = new FormData();
      formData.append('file', state.originalFile);

      const response = await fetch('/api/orders/bulk-import', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok && response.status !== 201) {
        throw new Error(data.message || 'Import failed');
      }

      setState((prev) => ({
        ...prev,
        isImporting: false,
        importComplete: true,
        importedCount: data.imported || 0,
        skippedCount: data.errors || 0,
      }));

      if (data.imported > 0) {
        toast.success(`Imported ${data.imported} orders successfully. ${data.errors || 0} errors skipped.`);
      } else {
        toast.warning('No orders were imported.');
      }
    } catch (err) {
      setState((prev) => ({ ...prev, isImporting: false }));
      toast.error(err instanceof Error ? err.message : 'Import failed');
    }
  }, [state.originalFile, state.parseResult, state.validCount]);

  const handleExportErrors = useCallback(() => {
    if (state.parseResult && state.errors.length > 0) {
      exportFailedRowsAsCSV(state.parseResult.data, state.errors);
      toast.success('Failed rows exported as CSV');
    }
  }, [state.parseResult, state.errors]);

  if (roleCheck === 'loading') {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (roleCheck === 'denied') {
    return (
      <div className="p-6">
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription>
            You don&apos;t have permission to import orders. This feature requires the admin or operations manager role.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Import Orders</CardTitle>
          <CardDescription>
            Upload a CSV or Excel file to bulk import orders. The file will be validated before import.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* File Upload */}
          <FileUploadForm
            onFileSelected={handleFileSelected}
            isLoading={isParsing}
            error={parseError}
          />

          {/* Validation Results */}
          {state.parseResult && (
            <>
              <ValidationErrorDisplay
                data={state.parseResult.data}
                errors={state.errors}
              />

              {/* Action Buttons */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleImport}
                  disabled={state.validCount === 0 || state.isImporting || state.importComplete}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {state.isImporting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    `Import ${state.validCount} Valid Orders`
                  )}
                </button>

                {state.errors.length > 0 && (
                  <button
                    onClick={handleExportErrors}
                    className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Export Failed Rows
                  </button>
                )}
              </div>
            </>
          )}

          {/* Import Complete */}
          {state.importComplete && (
            <Alert>
              <CheckCircle className="h-4 w-4 text-green-500" />
              <AlertDescription>
                Imported {state.importedCount} orders successfully.{' '}
                {state.skippedCount > 0 && `${state.skippedCount} errors skipped.`}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
