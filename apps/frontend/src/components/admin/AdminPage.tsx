'use client';

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
      </div>
    </div>
  );
};
