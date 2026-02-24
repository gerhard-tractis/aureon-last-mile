import { z } from 'zod';
import { isValidComuna } from '@/lib/data/chileanLocations';

const todayISO = new Date().toISOString().slice(0, 10);

export const RETAILER_OPTIONS = [
  'Falabella',
  'Shopee',
  'Mercado Libre',
  'Ripley',
  'Paris',
  'Other',
] as const;

const baseSchema = z.object({
  order_number: z.string().min(1, 'Order number is required'),
  customer_name: z.string().min(1, 'Customer name is required'),
  customer_phone: z
    .string()
    .regex(/^(\+569|9)\d{8}$/, 'Phone must be 9 digits'),
  delivery_address: z.string().min(1, 'Delivery address is required'),
  comuna: z
    .string()
    .min(1, 'Comuna is required')
    .refine((val) => isValidComuna(val), {
      message: 'Please select a valid Chilean comuna',
    }),
  delivery_date: z
    .string()
    .min(1, 'Delivery date is required')
    .refine((val) => val >= todayISO, {
      message: 'Delivery date cannot be in the past',
    }),
  delivery_window_start: z
    .string()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val === '' ? undefined : val)),
  delivery_window_end: z
    .string()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val === '' ? undefined : val)),
  retailer_name: z
    .string()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val === '' ? undefined : val))
    .pipe(z.enum(RETAILER_OPTIONS).optional()),
  notes: z
    .string()
    .optional()
    .transform((val) => (val === '' ? undefined : val)),
});

export const manualOrderSchema = baseSchema.superRefine((data, ctx) => {
  if (data.delivery_window_start && data.delivery_window_end) {
    if (data.delivery_window_end <= data.delivery_window_start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Window end must be after window start',
        path: ['delivery_window_end'],
      });
    }
  }
});

export type ManualOrderFormData = z.infer<typeof manualOrderSchema>;
