"use client";
import React from 'react';
import dynamic from 'next/dynamic';
import { useGlobal } from '@/lib/context/GlobalContext';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { CalendarDays, Settings, ExternalLink } from 'lucide-react';

const TabletRedirect = dynamic(() => import('./TabletRedirect'), { ssr: false });
import Link from 'next/link';

export default function DashboardContent() {
    const { loading, user } = useGlobal();

    const getDaysSinceRegistration = () => {
        if (!user?.registered_at) return 0;
        const today = new Date();
        const diffTime = Math.abs(today.getTime() - user.registered_at.getTime());
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
            </div>
        );
    }

    const daysSinceRegistration = getDaysSinceRegistration();

    return (
        <>
        <TabletRedirect />
        <div className="space-y-6 p-6">
            <Card>
                <CardHeader>
                    <CardTitle>Welcome, {user?.email?.split('@')[0]}! 👋</CardTitle>
                    <CardDescription className="flex items-center gap-2">
                        <CalendarDays className="h-4 w-4" />
                        Member for {daysSinceRegistration} days
                    </CardDescription>
                </CardHeader>
            </Card>

            {/* Quick Actions */}
            <Card>
                <CardHeader>
                    <CardTitle>Quick Actions</CardTitle>
                    <CardDescription>Frequently used features</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-4 md:grid-cols-2">
                        <Link
                            href="/app/user-settings"
                            className="flex items-center gap-3 p-4 border rounded-lg hover:bg-muted transition-colors"
                        >
                            <div className="p-2 bg-[var(--color-surface-raised)] rounded-full">
                                <Settings className="h-4 w-4 text-accent" />
                            </div>
                            <div>
                                <h3 className="font-medium">User Settings</h3>
                                <p className="text-sm text-muted-foreground">Manage your account preferences</p>
                            </div>
                        </Link>

                        <Link
                            href="/app/table"
                            className="flex items-center gap-3 p-4 border rounded-lg hover:bg-muted transition-colors"
                        >
                            <div className="p-2 bg-[var(--color-surface-raised)] rounded-full">
                                <ExternalLink className="h-4 w-4 text-accent" />
                            </div>
                            <div>
                                <h3 className="font-medium">Example Page</h3>
                                <p className="text-sm text-muted-foreground">Check out example features</p>
                            </div>
                        </Link>
                    </div>
                </CardContent>
            </Card>
        </div>
        </>
    );
}