const KEY = 'whatsapp_service_enabled';
const DESCRIPTION = 'Enable the local WhatsApp service connection and QR/session handling';

function asBool(value) {
    if (value === true) return true;
    if (value === 'true' || value === '"true"') return true;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value) === true;
        } catch {
            return false;
        }
    }
    return false;
}

export async function loadWhatsAppServiceEnabled({ getDB, defaultValue = false }) {
    const client = await getDB();
    try {
        const result = await client.query('SELECT value FROM app_settings WHERE key = $1', [KEY]);
        if (result.rows.length === 0) return defaultValue;
        return asBool(result.rows[0].value);
    } finally {
        client.release();
    }
}

export async function saveWhatsAppServiceEnabled({ getDB, enabled }) {
    const client = await getDB();
    try {
        await client.query(
            `INSERT INTO app_settings (key, value, description)
             VALUES ($1, $2::jsonb, '${DESCRIPTION}')
             ON CONFLICT (key) DO UPDATE
             SET value = EXCLUDED.value,
                 description = EXCLUDED.description,
                 updated_at = CURRENT_TIMESTAMP`,
            [KEY, JSON.stringify(Boolean(enabled))]
        );
    } finally {
        client.release();
    }
}
