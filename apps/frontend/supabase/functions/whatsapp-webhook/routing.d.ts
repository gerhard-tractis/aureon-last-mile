export interface RouteInput {
    phone: string;
    isDriver: boolean;
    hasActiveOrder: boolean;
    messageType: string;
    messageText: string;
}
export interface RouteResult {
    queue: string;
    type: string;
    flag?: string;
}
/**
 * Normalize a phone number to E.164 format (+569XXXXXXXX for Chilean numbers).
 * WhatsApp sends numbers without the leading '+'.
 */
export declare function normalizePhone(raw: string): string;
/**
 * Route an inbound WhatsApp message to the correct BullMQ queue.
 *
 * Routing priority:
 * 1. Known driver phone → coord.lifecycle { type: 'driver_message' }
 * 2. Known customer phone with active order → wismo.client { type: 'client_message' }
 * 3. Photo/document + intake hint in text → intake.ingest { type: 'photo_parse' }
 * 4. Default → wismo.client { type: 'client_message', flag: 'unknown' }
 */
export declare function routeMessage(input: RouteInput): RouteResult;
/**
 * Verify WhatsApp X-Hub-Signature-256 HMAC signature.
 * Uses Web Crypto API — compatible with both Deno and Node.js 18+.
 */
export declare function verifyHmacSignature(body: string, secret: string, signature: string): Promise<boolean>;
//# sourceMappingURL=routing.d.ts.map