import logger from '../../../utils/logger.js';
import { withDB } from '../../../utils/withDB';
import { stopAllScrapers } from '../utils/scraperUtils';

export default withDB(async (req, res, client) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method not allowed' });
    }

    try {
        await stopAllScrapers(client);
        res.status(200).json({
            success: true,
            message: 'All scrapers have been stopped and browser processes killed.'
        });
    } catch (error) {
        logger.error({ error: error.message, stack: error.stack }, 'Error in /api/stop_scrapers');
        res.status(500).json({
            success: false,
            message: 'Failed to stop scrapers.'
        });
    }
});
