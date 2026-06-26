-- Migration: WhatsApp service-level toggle.
--
-- `whatsapp_enabled` controls daily summaries. This setting controls whether
-- the local Baileys service is allowed to connect, restore sessions, and
-- generate QR codes at all.

INSERT INTO app_settings (key, value, description)
SELECT
    'whatsapp_service_enabled',
    CASE
        WHEN EXISTS (
            SELECT 1
            FROM app_settings
            WHERE key IN ('whatsapp_enabled', 'whatsapp_notify_on_restart')
              AND value = 'true'::jsonb
        )
        THEN 'true'::jsonb
        ELSE 'false'::jsonb
    END,
    'Enable the local WhatsApp service connection and QR/session handling'
ON CONFLICT (key) DO NOTHING;
