import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createSPAClient } from '@/lib/supabase/client';
import type { ManualOrderFormData } from '@/lib/validation/manualOrderSchema';
import type { Database } from '@/lib/types';

type OrderInsert = Database['public']['Tables']['orders']['Insert'];

interface CreateManualOrderInput {
  formData: ManualOrderFormData;
  operatorId: string;
  userId: string;
}

export const useCreateManualOrder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ formData, operatorId, userId }: CreateManualOrderInput) => {
      const supabase = createSPAClient();

      const insertData: OrderInsert = {
        operator_id: operatorId,
        order_number: formData.order_number,
        customer_name: formData.customer_name,
        customer_phone: formData.customer_phone,
        delivery_address: formData.delivery_address,
        comuna: formData.comuna,
        delivery_date: formData.delivery_date,
        delivery_window_start: formData.delivery_window_start ?? null,
        delivery_window_end: formData.delivery_window_end ?? null,
        retailer_name: formData.retailer_name ?? null,
        imported_via: 'MANUAL',
        imported_at: new Date().toISOString(),
        raw_data: {
          ...formData,
          created_by: userId,
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('orders') as any).insert(insertData).select().single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
};

export async function checkOrderNumberDuplicate(
  operatorId: string,
  orderNumber: string
): Promise<boolean> {
  const supabase = createSPAClient();
  const { data } = await supabase
    .from('orders')
    .select('id')
    .eq('operator_id', operatorId)
    .eq('order_number', orderNumber)
    .maybeSingle();
  return !!data;
}
