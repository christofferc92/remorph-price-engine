import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = process.env.SUPABASE_BUCKET || 'ai-offert-images';
const TTL = parseInt(process.env.SUPABASE_SIGNED_URL_TTL_SECONDS || '3600', 10);

// Initialize client only if credentials exist, otherwise methods will fail
const supabase = SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;

export async function uploadPngAndSign({
    bytes,
    mimeType,
}: {
    bytes: Buffer | Uint8Array;
    mimeType: string;
}): Promise<{ path: string; signedUrl: string }> {
    if (!supabase) {
        throw new Error('Supabase credentials (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) are missing');
    }

    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const uuid = crypto.randomUUID();
    const path = `ai-offert/after-images/${date}/${uuid}.png`;

    const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, bytes, {
            contentType: mimeType,
            upsert: false,
        });

    if (uploadError) {
        throw new Error(`Supabase upload failed: ${uploadError.message}`);
    }

    const { data, error: signError } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, TTL);

    if (signError || !data) {
        throw new Error(`Supabase createSignedUrl failed: ${signError?.message}`);
    }

    return { path, signedUrl: data.signedUrl };
}
