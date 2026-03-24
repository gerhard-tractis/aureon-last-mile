import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const skip = !SERVICE_KEY || !SUPABASE_URL;

describe.skipIf(skip)('comunas normalization (integration)', () => {
  let supabase: ReturnType<typeof createClient>;

  beforeAll(() => {
    supabase = createClient(SUPABASE_URL!, SERVICE_KEY!);
  });

  it('normalize_comuna_id returns UUID for exact canonical name', async () => {
    const { data } = await supabase.rpc('normalize_comuna_id', { raw_name: 'Las Condes' });
    expect(data).toBeTruthy();
    expect(typeof data).toBe('string');
  });

  it('normalize_comuna_id is case-insensitive for canonical name', async () => {
    const { data: d1 } = await supabase.rpc('normalize_comuna_id', { raw_name: 'Las Condes' });
    const { data: d2 } = await supabase.rpc('normalize_comuna_id', { raw_name: 'las condes' });
    expect(d1).toBe(d2);
  });

  it('normalize_comuna_id resolves uppercase alias', async () => {
    const { data: canonical } = await supabase.rpc('normalize_comuna_id', { raw_name: 'Las Condes' });
    const { data: alias }    = await supabase.rpc('normalize_comuna_id', { raw_name: 'LAS CONDES' });
    expect(alias).toBe(canonical);
  });

  it('normalize_comuna_id resolves accentless alias NUNOA → Ñuñoa', async () => {
    const { data: canonical } = await supabase.rpc('normalize_comuna_id', { raw_name: 'Ñuñoa' });
    const { data: alias }    = await supabase.rpc('normalize_comuna_id', { raw_name: 'NUNOA' });
    expect(alias).toBe(canonical);
    expect(canonical).toBeTruthy();
  });

  it('normalize_comuna_id returns null for unknown commune', async () => {
    const { data } = await supabase.rpc('normalize_comuna_id', { raw_name: 'Antartica Chilena XYZ' });
    expect(data).toBeNull();
  });

  it('normalize_comuna_id returns null for empty string', async () => {
    const { data } = await supabase.rpc('normalize_comuna_id', { raw_name: '' });
    expect(data).toBeNull();
  });
});
