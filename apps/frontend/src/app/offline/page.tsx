'use client';

/**
 * Offline Fallback Page
 * Shown when user navigates while offline
 */

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-8 text-center shadow-lg">
        <div className="mb-4">
          <svg
            className="mx-auto h-16 w-16 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"
            />
          </svg>
        </div>

        <h1 className="mb-2 text-2xl font-bold text-gray-900">Sin Conexión</h1>

        <p className="mb-6 text-gray-600">
          No se pudo conectar al servidor. Verifica tu conexión a internet.
        </p>

        <div className="mb-6 rounded-md bg-blue-50 p-4">
          <p className="text-sm text-blue-800">
            <strong>Modo Offline:</strong> Puedes seguir escaneando códigos de barras.
            Los escaneos se sincronizarán automáticamente cuando se restablezca la conexión.
          </p>
        </div>

        <button
          onClick={() => window.location.reload()}
          className="w-full rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Reintentar Conexión
        </button>

        <button
          onClick={() => window.history.back()}
          className="mt-3 w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Volver
        </button>
      </div>
    </div>
  );
}
