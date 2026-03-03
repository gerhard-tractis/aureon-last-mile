'use client';

import Image from 'next/image';
import { useState } from 'react';

export function AuthLogo({ productName }: { productName: string }) {
    const [hasError, setHasError] = useState(false);

    if (hasError) {
        // Fallback: slate rounded square with gold T-symbol
        return (
            <div className="w-10 h-10 rounded-xl bg-[#5e6b7b] flex items-center justify-center flex-shrink-0">
                <svg width="22" height="22" viewBox="0 0 110 104" fill="#e6c15c">
                    <polygon points="0 41.766 30.817 57.54 30.817 93.694 51 104 51 67.846 51 45.08 0 19"/>
                    <polygon points="59 45.08 59 67.846 59 104 79.183 93.694 79.183 57.54 110 41.766 110 19"/>
                    <polygon points="105 11.955 85.674 0 54.017 14.451 22.326 0 3 11.955 54.017 38"/>
                </svg>
            </div>
        );
    }

    return (
        <Image
            src="/icon.svg"
            alt={productName}
            width={40}
            height={40}
            className="w-10 h-10 rounded-xl flex-shrink-0"
            priority
            onError={() => setHasError(true)}
        />
    );
}
