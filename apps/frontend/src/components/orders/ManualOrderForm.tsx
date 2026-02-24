'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { createSPAClient } from '@/lib/supabase/client';
import { manualOrderSchema, RETAILER_OPTIONS, type ManualOrderFormData } from '@/lib/validation/manualOrderSchema';
import { ALL_COMUNAS } from '@/lib/data/chileanLocations';
import { useCreateManualOrder, checkOrderNumberDuplicate } from '@/hooks/useOrders';

// Form input type (before Zod transforms)
interface ManualOrderFormInput {
  order_number: string;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  comuna: string;
  delivery_date: string;
  delivery_window_start: string;
  delivery_window_end: string;
  retailer_name: string;
  notes: string;
}

export default function ManualOrderForm() {
  const [orderNumberError, setOrderNumberError] = useState<string | null>(null);
  const [dateWarning, setDateWarning] = useState<string | null>(null);
  const [operatorId, setOperatorId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [showAddAnother, setShowAddAnother] = useState(false);

  const { mutate: createOrder, isPending } = useCreateManualOrder();

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    reset,
    watch,
    setFocus,
  } = useForm<ManualOrderFormInput>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(manualOrderSchema) as any,
    mode: 'onBlur',
    reValidateMode: 'onBlur',
  });

  // Load session data
  useEffect(() => {
    const supabase = createSPAClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id ?? null);
      setOperatorId(session?.user?.app_metadata?.claims?.operator_id ?? null);
    });
  }, []);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Debounced order number duplicate check
  const orderNumberValue = watch('order_number');
  useEffect(() => {
    if (!orderNumberValue || orderNumberValue.length < 2 || !operatorId) {
      setOrderNumberError(null);
      return;
    }
    const timeoutId = setTimeout(async () => {
      try {
        const isDuplicate = await checkOrderNumberDuplicate(operatorId, orderNumberValue);
        if (isDuplicate) {
          setOrderNumberError(`Order #${orderNumberValue} already exists for this operator`);
        } else {
          setOrderNumberError(null);
        }
      } catch {
        // Fail silently on network error — retry on submit
        setOrderNumberError(null);
      }
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [orderNumberValue, operatorId]);

  // Delivery date >30 day warning
  const deliveryDateValue = watch('delivery_date');
  useEffect(() => {
    if (!deliveryDateValue) {
      setDateWarning(null);
      return;
    }
    const diff = (new Date(deliveryDateValue).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24);
    if (diff > 30) {
      setDateWarning('Delivery date is more than 30 days away. Confirm?');
    } else {
      setDateWarning(null);
    }
  }, [deliveryDateValue, today]);

  const onSubmit = (data: ManualOrderFormInput) => {
    if (orderNumberError || !operatorId || !userId) return;

    // Zod transforms have already run via the resolver
    const formData = data as unknown as ManualOrderFormData;
    createOrder(
      { formData, operatorId, userId },
      {
        onSuccess: () => {
          toast.success(`Order #${data.order_number} created successfully`);
          setShowAddAnother(true);
          reset();
          setOrderNumberError(null);
          setDateWarning(null);
        },
        onError: (error) => {
          // Handle duplicate constraint violation
          if (error.message?.includes('duplicate') || error.message?.includes('unique')) {
            setOrderNumberError(`Order #${data.order_number} already exists for this operator`);
          }
          toast.error('Failed to save order. Please try again.');
        },
      }
    );
  };

  const handleInvalidSubmit = () => {
    // Focus first invalid field
    const fieldOrder: (keyof ManualOrderFormInput)[] = [
      'order_number', 'customer_name', 'customer_phone',
      'delivery_address', 'comuna', 'delivery_date',
    ];
    for (const field of fieldOrder) {
      if (errors[field]) {
        setFocus(field);
        break;
      }
    }
  };

  const handleAddAnother = () => {
    setShowAddAnother(false);
    reset();
    setOrderNumberError(null);
    setDateWarning(null);
  };

  const inputClassName = 'w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#e6c15c] focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <form onSubmit={handleSubmit(onSubmit, handleInvalidSubmit)} className="space-y-4 max-w-2xl">
      {/* Order Number */}
      <div>
        <label htmlFor="order_number" className="block text-sm font-medium text-gray-700 mb-1">
          Order Number *
        </label>
        <input
          id="order_number"
          type="text"
          {...register('order_number')}
          disabled={isPending}
          className={inputClassName}
          aria-describedby={errors.order_number ? 'order_number-error' : orderNumberError ? 'order_number-dup-error' : undefined}
          aria-invalid={!!(errors.order_number || orderNumberError)}
        />
        {errors.order_number && (
          <p id="order_number-error" className="mt-1 text-sm text-red-600" role="alert">
            {errors.order_number.message}
          </p>
        )}
        {orderNumberError && (
          <p id="order_number-dup-error" className="mt-1 text-sm text-red-600" role="alert">
            {orderNumberError}
          </p>
        )}
      </div>

      {/* Customer Name */}
      <div>
        <label htmlFor="customer_name" className="block text-sm font-medium text-gray-700 mb-1">
          Customer Name *
        </label>
        <input
          id="customer_name"
          type="text"
          {...register('customer_name')}
          disabled={isPending}
          className={inputClassName}
          aria-describedby={errors.customer_name ? 'customer_name-error' : undefined}
          aria-invalid={!!errors.customer_name}
        />
        {errors.customer_name && (
          <p id="customer_name-error" className="mt-1 text-sm text-red-600" role="alert">
            {errors.customer_name.message}
          </p>
        )}
      </div>

      {/* Customer Phone */}
      <div>
        <label htmlFor="customer_phone" className="block text-sm font-medium text-gray-700 mb-1">
          Customer Phone *
        </label>
        <input
          id="customer_phone"
          type="text"
          placeholder="+56912345678 or 912345678"
          {...register('customer_phone')}
          disabled={isPending}
          className={inputClassName}
          aria-describedby={errors.customer_phone ? 'customer_phone-error' : undefined}
          aria-invalid={!!errors.customer_phone}
        />
        {errors.customer_phone && (
          <p id="customer_phone-error" className="mt-1 text-sm text-red-600" role="alert">
            {errors.customer_phone.message}
          </p>
        )}
      </div>

      {/* Delivery Address */}
      <div>
        <label htmlFor="delivery_address" className="block text-sm font-medium text-gray-700 mb-1">
          Delivery Address *
        </label>
        <textarea
          id="delivery_address"
          {...register('delivery_address')}
          disabled={isPending}
          rows={2}
          className={inputClassName}
          aria-describedby={errors.delivery_address ? 'delivery_address-error' : undefined}
          aria-invalid={!!errors.delivery_address}
        />
        {errors.delivery_address && (
          <p id="delivery_address-error" className="mt-1 text-sm text-red-600" role="alert">
            {errors.delivery_address.message}
          </p>
        )}
      </div>

      {/* Comuna */}
      <div>
        <label htmlFor="comuna" className="block text-sm font-medium text-gray-700 mb-1">
          Comuna *
        </label>
        <input
          id="comuna"
          type="text"
          list="comunas-list"
          {...register('comuna')}
          disabled={isPending}
          className={inputClassName}
          aria-describedby={errors.comuna ? 'comuna-error' : undefined}
          aria-invalid={!!errors.comuna}
        />
        <datalist id="comunas-list">
          {ALL_COMUNAS.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        {errors.comuna && (
          <p id="comuna-error" className="mt-1 text-sm text-red-600" role="alert">
            {errors.comuna.message}
          </p>
        )}
      </div>

      {/* Delivery Date */}
      <div>
        <label htmlFor="delivery_date" className="block text-sm font-medium text-gray-700 mb-1">
          Delivery Date *
        </label>
        <input
          id="delivery_date"
          type="date"
          min={today}
          {...register('delivery_date')}
          disabled={isPending}
          className={inputClassName}
          aria-describedby={errors.delivery_date ? 'delivery_date-error' : undefined}
          aria-invalid={!!errors.delivery_date}
        />
        {errors.delivery_date && (
          <p id="delivery_date-error" className="mt-1 text-sm text-red-600" role="alert">
            {errors.delivery_date.message}
          </p>
        )}
        {dateWarning && (
          <p className="mt-1 text-sm text-yellow-600" role="status">
            {dateWarning}
          </p>
        )}
      </div>

      {/* Delivery Window Start / End */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="delivery_window_start" className="block text-sm font-medium text-gray-700 mb-1">
            Delivery Window Start
          </label>
          <input
            id="delivery_window_start"
            type="time"
            {...register('delivery_window_start')}
            disabled={isPending}
            className={inputClassName}
          />
        </div>
        <div>
          <label htmlFor="delivery_window_end" className="block text-sm font-medium text-gray-700 mb-1">
            Delivery Window End
          </label>
          <input
            id="delivery_window_end"
            type="time"
            {...register('delivery_window_end')}
            disabled={isPending}
            className={inputClassName}
            aria-describedby={errors.delivery_window_end ? 'delivery_window_end-error' : undefined}
            aria-invalid={!!errors.delivery_window_end}
          />
          {errors.delivery_window_end && (
            <p id="delivery_window_end-error" className="mt-1 text-sm text-red-600" role="alert">
              {errors.delivery_window_end.message}
            </p>
          )}
        </div>
      </div>

      {/* Retailer Name */}
      <div>
        <label htmlFor="retailer_name" className="block text-sm font-medium text-gray-700 mb-1">
          Retailer Name
        </label>
        <select
          id="retailer_name"
          {...register('retailer_name')}
          disabled={isPending}
          className={inputClassName}
        >
          <option value="">Select retailer (optional)</option>
          {RETAILER_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {/* Notes */}
      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">
          Notes
        </label>
        <textarea
          id="notes"
          {...register('notes')}
          disabled={isPending}
          rows={2}
          className={inputClassName}
        />
      </div>

      {/* Submit / Add Another */}
      <div className="flex items-center gap-3 pt-4">
        <button
          type="submit"
          disabled={!isValid || isPending || !!orderNumberError}
          className="px-4 py-2 bg-[#e6c15c] text-gray-900 rounded-md hover:bg-[#d4b04a] font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {isPending && (
            <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          )}
          {isPending ? 'Saving...' : 'Save Order'}
        </button>

        {showAddAnother && (
          <button
            type="button"
            onClick={handleAddAnother}
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
          >
            Add Another Order
          </button>
        )}
      </div>
    </form>
  );
}
