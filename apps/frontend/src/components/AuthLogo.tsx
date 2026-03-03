'use client';

import Image from 'next/image';
import { useState } from 'react';

export function AuthLogo({ productName }: { productName: string }) {
    const [hasError, setHasError] = useState(false);

    if (hasError) {
        return null;
    }

    return (
        <Image
            src="/icon.svg"
            alt={productName}
            width={80}
            height={80}
            className="w-16 h-16 sm:w-20 sm:h-20"
            priority
            onError={() => setHasError(true)}
        />
    );
}
