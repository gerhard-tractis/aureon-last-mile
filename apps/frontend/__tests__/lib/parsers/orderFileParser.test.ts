import { describe, it, expect } from 'vitest';
import { parseCSV, parseExcel, parseOrdersFile, validateFileType } from '@/lib/parsers/orderFileParser';

function createCSVFile(content: string, name = 'test.csv'): File {
  return new File([content], name, { type: 'text/csv' });
}

function createExcelFile(): File {
  // Create a minimal XLSX file using SheetJS
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['order_number', 'customer_name', 'customer_phone', 'delivery_address', 'comuna', 'delivery_date'],
    ['ORD001', 'John Doe', '912345678', 'Av. Libertador 123', 'Santiago', '2026-02-20'],
    ['ORD002', 'Jane Smith', '987654321', 'Calle Moneda 456', 'Providencia', '2026-02-21'],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return new File([buffer], 'test.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

describe('parseCSV', () => {
  it('should parse valid CSV file', async () => {
    const csv = 'order_number,customer_name,customer_phone,delivery_address,comuna,delivery_date\nORD001,John Doe,912345678,Av. Libertador 123,Santiago,2026-02-20';
    const file = createCSVFile(csv);

    const result = await parseCSV(file);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].order_number).toBe('ORD001');
    expect(result.data[0].customer_name).toBe('John Doe');
    expect(result.errors).toHaveLength(0);
    expect(result.meta.fields).toContain('order_number');
    expect(result.meta.rowCount).toBe(1);
  });

  it('should normalize headers to lowercase snake_case', async () => {
    const csv = 'Order Number,Customer Name\nORD001,John';
    const file = createCSVFile(csv);

    const result = await parseCSV(file);

    expect(result.meta.fields).toContain('order_number');
    expect(result.meta.fields).toContain('customer_name');
    expect(result.data[0].order_number).toBe('ORD001');
  });

  it('should skip empty lines', async () => {
    const csv = 'order_number,customer_name\nORD001,John\n\nORD002,Jane';
    const file = createCSVFile(csv);

    const result = await parseCSV(file);

    expect(result.data).toHaveLength(2);
  });

  it('should sanitize formula injection characters', async () => {
    const csv = 'order_number,customer_name\n=cmd|calc,+John\n-ORD002,@Jane';
    const file = createCSVFile(csv);

    const result = await parseCSV(file);

    expect(result.data[0].order_number).toBe("'=cmd|calc");
    expect(result.data[0].customer_name).toBe("'+John");
    expect(result.data[1].order_number).toBe("'-ORD002");
    expect(result.data[1].customer_name).toBe("'@Jane");
  });

  it('should handle multiple rows', async () => {
    const csv = 'order_number,customer_name\nORD001,John\nORD002,Jane\nORD003,Bob';
    const file = createCSVFile(csv);

    const result = await parseCSV(file);

    expect(result.data).toHaveLength(3);
    expect(result.meta.rowCount).toBe(3);
  });
});

describe('parseExcel', () => {
  it('should parse valid Excel file', async () => {
    const file = createExcelFile();

    const result = await parseExcel(file);

    expect(result.data).toHaveLength(2);
    expect(result.data[0].order_number).toBe('ORD001');
    expect(result.data[0].customer_name).toBe('John Doe');
    expect(result.meta.fields).toContain('order_number');
    expect(result.meta.rowCount).toBe(2);
  });

  it('should normalize headers to lowercase snake_case', async () => {
    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['Order Number', 'Customer Name'],
      ['ORD001', 'John'],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const file = new File([buffer], 'test.xlsx');

    const result = await parseExcel(file);

    expect(result.meta.fields).toContain('order_number');
    expect(result.meta.fields).toContain('customer_name');
  });
});

describe('parseOrdersFile', () => {
  it('should reject file > 10MB', async () => {
    const largeContent = 'x'.repeat(11 * 1024 * 1024);
    const file = new File([largeContent], 'large.csv', { type: 'text/csv' });

    await expect(parseOrdersFile(file)).rejects.toThrow('File too large');
  });

  it('should reject empty file', async () => {
    const file = new File([], 'empty.csv', { type: 'text/csv' });

    await expect(parseOrdersFile(file)).rejects.toThrow('File is empty');
  });

  it('should parse CSV file by content detection', async () => {
    const csv = 'order_number,customer_name\nORD001,John';
    const file = createCSVFile(csv);

    const result = await parseOrdersFile(file);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].order_number).toBe('ORD001');
  });

  it('should parse Excel file by content detection', async () => {
    const file = createExcelFile();

    const result = await parseOrdersFile(file);

    expect(result.data).toHaveLength(2);
  });

  it('should reject non-CSV/Excel files', async () => {
    // A PNG file header
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const file = new File([pngHeader], 'image.png', { type: 'image/png' });

    await expect(parseOrdersFile(file)).rejects.toThrow('Invalid file format');
  });
});

describe('validateFileType', () => {
  it('should detect CSV files', async () => {
    const file = createCSVFile('a,b,c\n1,2,3');
    const type = await validateFileType(file);
    expect(type).toBe('csv');
  });

  it('should detect XLSX files', async () => {
    const file = createExcelFile();
    const type = await validateFileType(file);
    expect(type).toBe('xlsx');
  });

  it('should reject binary files', async () => {
    const binary = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    const file = new File([binary], 'file.bin');

    await expect(validateFileType(file)).rejects.toThrow('Invalid file format');
  });
});
