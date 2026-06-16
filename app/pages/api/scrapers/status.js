import { withDB } from '../../../utils/withDB';

export default withDB(async (req, res, client) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const minimal = req.query.minimal === 'true';

  const settingsResult = await client.query(
    `SELECT key, value FROM app_settings WHERE key IN ('sync_enabled', 'sync_hour', 'sync_days_back')`
  );

  const settings = {};
  for (const row of settingsResult.rows) {
    settings[row.key] = row.value;
  }

  const accountsResult = await client.query(
    `SELECT COUNT(*) as count FROM vendor_credentials WHERE is_active = true`
  );
  const activeAccounts = parseInt(accountsResult.rows[0].count, 10);

  const latestScrapeResult = await client.query(`
    SELECT
      id,
      triggered_by,
      vendor,
      start_date,
      status,
      message,
      CASE
        WHEN created_at IS NOT NULL
        THEN to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        ELSE NULL
      END as created_at,
      duration_seconds
    FROM scrape_events
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const latestScrape = latestScrapeResult.rows[0] || null;

  const lastSyncedResult = await client.query(`
    SELECT
      id,
      nickname,
      vendor,
      CASE
        WHEN last_synced_at IS NOT NULL
        THEN to_char(last_synced_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        ELSE NULL
      END as last_synced_at
    FROM vendor_credentials
    WHERE is_active = true
    ORDER BY last_synced_at DESC NULLS LAST
  `);
  const accountSyncStatus = lastSyncedResult.rows;

  const now = new Date();
  const intervalHours = 24;
  let syncHealth = 'unknown';

  if (latestScrape && latestScrape.created_at) {
    const lastSyncTime = new Date(latestScrape.created_at);
    const hoursSinceSync = (now.getTime() - lastSyncTime.getTime()) / (1000 * 60 * 60);

    if (latestScrape.status === 'completed' || latestScrape.status === 'success') {
      if (hoursSinceSync < intervalHours) {
        syncHealth = 'healthy';
      } else if (hoursSinceSync < intervalHours * 2) {
        syncHealth = 'stale';
      } else {
        syncHealth = 'outdated';
      }
    } else if (latestScrape.status === 'started') {
      if (hoursSinceSync > 0.33) {
        syncHealth = 'error';
        latestScrape.message = 'Sync timed out or process crashed';
      } else {
        syncHealth = 'syncing';
      }
    } else if (latestScrape.status === 'failed' || latestScrape.status === 'error') {
      syncHealth = 'error';
    } else if (latestScrape.status === 'cancelled') {
      syncHealth = 'healthy';
    }
  } else if (activeAccounts === 0) {
    syncHealth = 'no_accounts';
  } else {
    syncHealth = 'never_synced';
  }

  const response = {
    syncHealth,
    settings: {
      enabled: settings.sync_enabled === true || settings.sync_enabled === 'true',
      syncHour: parseInt(settings.sync_hour, 10) || 3,
      daysBack: parseInt(settings.sync_days_back, 10) || 30
    },
    activeAccounts,
    latestScrape,
    summary: {
      oldest_sync_at: accountSyncStatus.length > 0 ? accountSyncStatus[accountSyncStatus.length - 1].last_synced_at : null,
      has_never_synced: accountSyncStatus.some(a => !a.last_synced_at)
    }
  };

  if (minimal) {
    return res.status(200).json(response);
  }

  const historyResult = await client.query(`
    SELECT
      id,
      triggered_by,
      vendor,
      start_date,
      status,
      message,
      CASE
        WHEN created_at IS NOT NULL
        THEN to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
        ELSE NULL
      END as created_at,
      duration_seconds
    FROM scrape_events
    ORDER BY created_at DESC
    LIMIT 10
  `);

  res.status(200).json({
    ...response,
    history: historyResult.rows,
    accountSyncStatus
  });
});
