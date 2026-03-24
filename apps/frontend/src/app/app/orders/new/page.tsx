'use client';

import { useEffect, useState } from 'react';
import { Loader2, ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { createSPAClient } from '@/lib/supabase/client';
import ManualOrderForm from '@/components/orders/ManualOrderForm';
import { PageShell } from '@/components/PageShell';

const ALLOWED_ROLES = ['admin', 'operations_manager'];

export default function NewOrderPage() {
  const [roleCheck, setRoleCheck] = useState<'loading' | 'allowed' | 'denied'>('loading');

  useEffect(() => {
    const supabase = createSPAClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      const role = session?.user?.app_metadata?.claims?.role;
      setRoleCheck(ALLOWED_ROLES.includes(role) ? 'allowed' : 'denied');
    });
  }, []);

  if (roleCheck === 'loading') {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (roleCheck === 'denied') {
    return (
      <div className="p-6">
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription>
            You don&apos;t have permission to create orders. This feature requires the admin or operations manager role.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <PageShell
      title="Nuevo Pedido"
      breadcrumbs={[
        { label: 'Dashboard', href: '/app/dashboard' },
        { label: 'Nuevo Pedido' },
      ]}
    >
      <Card>
        <CardHeader>
          <CardTitle>New Order</CardTitle>
          <CardDescription>
            Manually enter a single order. Use this when email or CSV import is not available.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ManualOrderForm />
        </CardContent>
      </Card>
    </PageShell>
  );
}
