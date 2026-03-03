'use client';

import Image from 'next/image';
import { useState } from 'react';

export function AuthLogo({ productName }: { productName: string }) {
    const [hasError, setHasError] = useState(false);

    if (hasError) {
        // Fallback: gold circle with A
        return (
            <div className="w-10 h-10 rounded-full bg-amber-400 flex items-center justify-center flex-shrink-0">
                <span className="text-stone-800 font-bold text-lg" style={{ fontFamily: 'Georgia, serif' }}>A</span>
            </div>
        );
    }

    return (
        <Image
            src="/icon.svg"
            alt={productName}
            width={40}
            height={40}
            className="w-10 h-10 rounded-full flex-shrink-0"
            priority
            onError={() => setHasError(true)}
        />
    );
}
