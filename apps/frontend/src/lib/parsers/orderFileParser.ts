import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export interface ParseResult {
  data: Record<string, string>[];
  errors: ParseError[];
  meta: {
    fields: string[];
    rowCount: number;
  };
}

export interface ParseError {
  row: number;
  message: string;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Magic number signatures for file type validation
const CSV_TEXT_PATTERN = /^[\x20-\x7E\r\n\t,;"']+$/;
const XLSX_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK.. (ZIP format)
const XLS_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]; // OLE2 compound document

/**
 * Sanitize cell value to prevent formula injection.
 * Escapes cells starting with =, +, -, @ which could be interpreted as formulas.
 */
function sanitizeValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value).trim();
  // Remove control characters except \t, \n, \r
  const cleaned = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Escape formula injection characters
  if (/^[=+\-@]/.test(cleaned)) {
    return "'" + cleaned;
  }
  return cleaned;
}

function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  // Use arrayBuffer() if available, fallback to FileReader for jsdom compatibility
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

async function readFileHeader(file: File, bytes: number): Promise<Uint8Array> {
  const slice = file.slice(0, bytes);
  const buffer = await readBlobAsArrayBuffer(slice);
  return new Uint8Array(buffer);
}

function matchesMagic(header: Uint8Array, magic: number[]): boolean {
  return magic.every((byte, i) => header[i] === byte);
}

export async function validateFileType(file: File): Promise<'csv' | 'xlsx' | 'xls'> {
  const header = await readFileHeader(file, 8);

  if (matchesMagic(header, XLSX_MAGIC)) {
    return 'xlsx';
  }
  if (matchesMagic(header, XLS_MAGIC)) {
    return 'xls';
  }

  // For CSV, check first chunk is valid text
  const headerBuffer = await readBlobAsArrayBuffer(file.slice(0, 1024));
  const textChunk = new TextDecoder().decode(headerBuffer);
  if (CSV_TEXT_PATTERN.test(textChunk)) {
    return 'csv';
  }

  throw new Error('Invalid file format. Please upload .csv, .xlsx, or .xls');
}

export function parseCSV(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim().toLowerCase().replace(/\s+/g, '_'),
      dynamicTyping: false,
      complete: (results) => {
        const data = (results.data as Record<string, string>[]).map((row) => {
          const sanitized: Record<string, string> = {};
          for (const [key, value] of Object.entries(row)) {
            sanitized[key] = sanitizeValue(value);
          }
          return sanitized;
        });

        resolve({
          data,
          errors: results.errors.map((err) => ({
            row: err.row ?? 0,
            message: err.message,
          })),
          meta: {
            fields: results.meta.fields?.map((f) => f.trim().toLowerCase().replace(/\s+/g, '_')) || [],
            rowCount: data.length,
          },
        });
      },
      error: (error: Error) => {
        reject(new Error(`CSV parse error: ${error.message}`));
      },
    });
  });
}

export async function parseExcel(file: File): Promise<ParseResult> {
  const buffer = await readBlobAsArrayBuffer(file);

  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: true,
    cellText: false,
  });

  if (workbook.SheetNames.length === 0) {
    throw new Error('Excel file contains no sheets');
  }

  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawData = XLSX.utils.sheet_to_json<string[]>(worksheet, {
    header: 1,
    defval: '',
    blankrows: false,
  });

  if (rawData.length === 0) {
    return { data: [], errors: [], meta: { fields: [], rowCount: 0 } };
  }

  const headers = (rawData[0] as string[]).map((h) =>
    String(h).trim().toLowerCase().replace(/\s+/g, '_')
  );
  const rows = rawData.slice(1);

  const data = rows.map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((header, index) => {
      const cellValue = (row as string[])[index];
      // Handle Date objects from cellDates: true
      if (cellValue instanceof Date) {
        obj[header] = cellValue.toISOString().split('T')[0]; // YYYY-MM-DD
      } else {
        obj[header] = sanitizeValue(cellValue);
      }
    });
    return obj;
  });

  return {
    data,
    errors: [],
    meta: {
      fields: headers,
      rowCount: data.length,
    },
  };
}

export async function parseOrdersFile(file: File): Promise<ParseResult> {
  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File too large. Maximum 10MB.');
  }

  if (file.size === 0) {
    throw new Error('File is empty.');
  }

  // Validate file type by content (magic numbers)
  const detectedType = await validateFileType(file);

  switch (detectedType) {
    case 'csv':
      return parseCSV(file);
    case 'xlsx':
    case 'xls':
      return parseExcel(file);
  }
}
