"use client";
import React, { useState } from 'react';
import Link from 'next/link';
import {usePathname, useRouter} from 'next/navigation';
import {
    User,
    Menu,
    X,
    ChevronDown,
    LogOut,
    Key,
    BarChart3,
} from 'lucide-react';
import { useGlobal } from "@/lib/context/GlobalContext";
import { createSPAClient, createSPASassClient } from "@/lib/supabase/client";
import { useBranding } from "@/providers/BrandingProvider";
import ThemeToggle from '@/components/ThemeToggle';

export default function AppLayout({ children }: { children: React.ReactNode }) {
    const [isSidebarOpen, setSidebarOpen] = useState(false);
    const [isUserDropdownOpen, setUserDropdownOpen] = useState(false);
    const pathname = usePathname();
    const router = useRouter();


    const { user } = useGlobal();
    const { logoUrl, companyName } = useBranding();
    const [logoError, setLogoError] = useState(false);
    const [userRole, setUserRole] = useState<string | null>(null);

    React.useEffect(() => {
        const supabase = createSPAClient();
        supabase.auth.getSession().then(({ data: { session } }) => {
            setUserRole(session?.user?.app_metadata?.claims?.role ?? null);
        });
    }, []);

    const handleLogout = async () => {
        try {
            const client = await createSPASassClient();
            await client.logout();
        } catch (error) {
            console.error('Error logging out:', error);
        }
    };
    const handleChangePassword = async () => {
        router.push('/app/user-settings')
    };

    const getInitials = (email: string) => {
        const parts = email.split('@')[0].split(/[._-]/);
        return parts.length > 1
            ? (parts[0][0] + parts[1][0]).toUpperCase()
            : parts[0].slice(0, 2).toUpperCase();
    };

    const productName = process.env.NEXT_PUBLIC_PRODUCTNAME;

    const dashboardAllowed = userRole === 'operations_manager' || userRole === 'admin';

    const navigation = [
        ...(dashboardAllowed
            ? [{ name: 'Dashboard', href: '/app/dashboard', icon: BarChart3 }]
            : []),
        { name: 'User Settings', href: '/app/user-settings', icon: User },
    ];

    const toggleSidebar = () => setSidebarOpen(!isSidebarOpen);

    return (
        <div className="min-h-screen bg-gray-100">
            {isSidebarOpen && (
                <div
                    className="fixed inset-0 bg-gray-600 bg-opacity-75 z-20 lg:hidden"
                    onClick={toggleSidebar}
                />
            )}

            {/* Sidebar */}
            <div className={`fixed inset-y-0 left-0 w-64 bg-white shadow-lg transform transition-transform duration-200 ease-in-out z-30 
                ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}>

                <div className="h-16 flex items-center justify-between px-4 border-b">
                    {logoUrl && !logoError ? (
                        <img
                            src={logoUrl}
                            alt={companyName || productName || 'Logo'}
                            className="max-h-10 max-w-40 object-contain"
                            onError={() => setLogoError(true)}
                        />
                    ) : (
                        <span className="text-xl font-semibold text-primary-600">
                            {companyName || productName}
                        </span>
                    )}
                    <button
                        onClick={toggleSidebar}
                        className="lg:hidden text-gray-500 hover:text-gray-700"
                    >
                        <X className="h-6 w-6" />
                    </button>
                </div>

                {/* Navigation */}
                <nav className="mt-4 px-2 space-y-1">
                    {navigation.map((item) => {
                        const isActive = pathname === item.href;
                        return (
                            <Link
                                key={item.name}
                                href={item.href}
                                className={`group flex items-center px-2 py-2 text-sm font-medium rounded-md ${
                                    isActive
                                        ? 'bg-primary-50 text-primary-600'
                                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                                }`}
                            >
                                <item.icon
                                    className={`mr-3 h-5 w-5 ${
                                        isActive ? 'text-primary-500' : 'text-gray-400 group-hover:text-gray-500'
                                    }`}
                                />
                                {item.name}
                            </Link>
                        );
                    })}
                </nav>

            </div>

            <div className="lg:pl-64">
                <div className="sticky top-0 z-10 flex items-center justify-between h-16 bg-white dark:bg-gray-900 shadow-sm dark:shadow-gray-800 px-4">
                    <button
                        onClick={toggleSidebar}
                        className="lg:hidden text-gray-500 hover:text-gray-700"
                    >
                        <Menu className="h-6 w-6"/>
                    </button>

                    <div className="flex items-center gap-2 ml-auto">
                        <ThemeToggle />
                        <div className="relative">
                            <button
                                onClick={() => setUserDropdownOpen(!isUserDropdownOpen)}
                                className="flex items-center space-x-2 text-sm text-gray-700 hover:text-gray-900"
                            >
                                <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
                                    <span className="text-primary-700 font-medium">
                                        {user ? getInitials(user.email) : '??'}
                                    </span>
                                </div>
                                <span>{user?.email || 'Loading...'}</span>
                                <ChevronDown className="h-4 w-4"/>
                            </button>

                            {isUserDropdownOpen && (
                                <div className="absolute right-0 mt-2 w-64 bg-white rounded-md shadow-lg border">
                                    <div className="p-2 border-b border-gray-100">
                                        <p className="text-xs text-gray-500">Signed in as</p>
                                        <p className="text-sm font-medium text-gray-900 truncate">
                                            {user?.email}
                                        </p>
                                    </div>
                                    <div className="py-1">
                                        <button
                                            onClick={() => {
                                                setUserDropdownOpen(false);
                                                handleChangePassword()
                                            }}
                                            className="w-full flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                                        >
                                            <Key className="mr-3 h-4 w-4 text-gray-400"/>
                                            Change Password
                                        </button>
                                        <button
                                            onClick={() => {
                                                handleLogout();
                                                setUserDropdownOpen(false);
                                            }}
                                            className="w-full flex items-center px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                                        >
                                            <LogOut className="mr-3 h-4 w-4 text-red-400"/>
                                            Sign Out
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <main className="p-4">
                    {children}
                </main>
            </div>
        </div>
    );
}