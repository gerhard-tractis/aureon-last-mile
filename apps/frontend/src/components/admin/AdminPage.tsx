'use client';

import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UserManagement } from './UserManagement';
import { ClientManagement } from './ClientManagement';
import { PickupPointManagement } from './PickupPointManagement';
import { useClientStore } from '@/lib/stores/clientStore';
import { usePickupPointStore } from '@/lib/stores/pickupPointStore';
import { useAdminStore } from '@/lib/stores/adminStore';

interface AdminPageProps {
  userRole: string;
}

export const AdminPage = ({ userRole }: AdminPageProps) => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tab = searchParams.get('tab') || 'users';

  const clientStore = useClientStore();
  const pickupPointStore = usePickupPointStore();
  const adminStore = useAdminStore();

  const handleTabChange = (value: string) => {
    adminStore.setCreateFormOpen(false);
    adminStore.setEditFormOpen(false);
    adminStore.setDeleteConfirmOpen(false);
    clientStore.resetAll();
    pickupPointStore.resetAll();
    router.replace(`/admin?tab=${value}`);
  };

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold text-foreground mb-6">Administración</h1>

        <Tabs value={tab} onValueChange={handleTabChange}>
          <TabsList>
            <TabsTrigger value="users">Usuarios</TabsTrigger>
            <TabsTrigger value="clients">Clientes</TabsTrigger>
            <TabsTrigger value="pickup-points">Puntos de Retiro</TabsTrigger>
            {userRole === 'super_admin' && (
              <Link
                href="/admin/modules"
                data-testid="modules-tab-link"
                className="inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-sm font-medium transition-all hover:bg-background/50"
              >
                Módulos
              </Link>
            )}
          </TabsList>

          <TabsContent value="users" className="mt-6">
            <UserManagement userRole={userRole} />
          </TabsContent>

          <TabsContent value="clients" className="mt-6">
            <ClientManagement userRole={userRole} />
          </TabsContent>

          <TabsContent value="pickup-points" className="mt-6">
            <PickupPointManagement userRole={userRole} />
          </TabsContent>
        </Tabs>

        {/*
          spec-67: the internal diagnostic tools used to sit on unlinked /app
          routes. They belong here, not in an operator's sidebar — a test
          bench in the primary nav reads as product.

          Rendered for `admin` only. `operations_manager` and `super_admin`
          also reach /admin (see app/admin/page.tsx), but both tool pages are
          admin-gated, so showing them the links would offer destinations that
          bounce them straight back out.
        */}
        {userRole === 'admin' && (
          <section className="mt-10 border-t border-border pt-6" data-testid="admin-tools">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Herramientas
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Bancos de prueba internos. No forman parte de la operación diaria.
            </p>
            <ul className="mt-4 flex flex-col gap-2">
              <li>
                <Link
                  href="/admin/tools/ocr"
                  data-testid="tools-ocr-link"
                  className="text-sm font-medium text-primary hover:underline"
                >
                  OCR de manifiestos
                </Link>
              </li>
              <li>
                <Link
                  href="/admin/tools/wismo"
                  data-testid="tools-wismo-link"
                  className="text-sm font-medium text-primary hover:underline"
                >
                  Simulador WISMO
                </Link>
              </li>
            </ul>
          </section>
        )}
      </div>
    </div>
  );
};
