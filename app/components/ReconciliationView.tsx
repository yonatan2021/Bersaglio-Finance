import React, { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Paper from '@mui/material/Paper';
import Tooltip from '@mui/material/Tooltip';
import { useTheme, alpha } from '@mui/material/styles';

import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';

import PageHeader from './PageHeader';
import AccountDisplay from './AccountDisplay';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../context/LocaleContext';

interface TransactionDetail {
  identifier: string;
  vendor: string;
  date: string;
  name: string;
  price: number;
  account_number: string | null;
  category?: string | null;
}

interface MatchCandidate {
  id: number;
  confidence: number;
  status: string;
  bankTransaction: TransactionDetail;
  ccTransaction: TransactionDetail;
}

const ReconciliationView: React.FC = () => {
  const { t } = useTranslation('views');
  const { locale } = useLocale();
  const dateLocale = locale === 'he' ? 'he-IL' : 'en-US';
  const isRtl = locale === 'he';
  const theme = useTheme();

  const [activeTab, setActiveTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({
    open: false,
    message: '',
    severity: 'success'
  });
  const [scanning, setScanning] = useState(false);

  const handleScan = async () => {
    setScanning(true);
    try {
      const res = await fetch('/api/reconciliation/scan', {
        method: 'POST'
      });
      if (!res.ok) throw new Error('Scan failed');
      const data = await res.json();
      
      const message = locale === 'he'
        ? `סריקה הושלמה! נמצאו ${data.candidatesFound} התאמות חדשות.`
        : `Scan complete! Found ${data.candidatesFound} new matches.`;
        
      setSnackbar({ open: true, message, severity: 'success' });
      fetchMatches(activeTab);
    } catch (err) {
      console.error('Failed to run manual reconciliation scan:', err);
      setSnackbar({
        open: true,
        message: locale === 'he' ? 'הסריקה נכשלה. אנא נסה שנית.' : 'Scan failed. Please try again.',
        severity: 'error'
      });
    } finally {
      setScanning(false);
    }
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(dateLocale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const fetchMatches = async (statusTab: number) => {
    setLoading(true);
    try {
      const statusParam = statusTab === 0 ? 'pending' : 'approved';
      const res = await fetch(`/api/reconciliation/candidates?status=${statusParam}`);
      if (!res.ok) throw new Error('Failed to fetch matches');
      const data = await res.json();
      setCandidates(data);
    } catch (err) {
      console.error('Failed to load reconciliation candidates:', err);
      setSnackbar({
        open: true,
        message: locale === 'he' ? 'שגיאה בטעינת הנתונים' : 'Failed to load data',
        severity: 'error'
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMatches(activeTab);
  }, [activeTab]);

  const handleAction = async (id: number, actionStatus: 'approved' | 'rejected' | 'pending', name: string) => {
    try {
      const res = await fetch('/api/reconciliation/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: actionStatus })
      });
      if (!res.ok) throw new Error('Action failed');

      let successMessage = '';
      if (actionStatus === 'approved') {
        successMessage = locale === 'he' ? `ההתאמה עבור "${name}" אושרה בהצלחה` : `Match approved for "${name}"`;
      } else if (actionStatus === 'rejected') {
        successMessage = locale === 'he' ? 'ההתאמה נדחתה והוסרה מהרשימה' : 'Match rejected';
      } else {
        successMessage = locale === 'he' ? 'ההתאמה בוטלה והעסקאות הופרדו' : 'Match unlinked successfully';
      }

      setSnackbar({ open: true, message: successMessage, severity: actionStatus === 'rejected' ? 'info' : 'success' });
      
      // Dispatch refresh event so other tabs/components update their cache
      window.dispatchEvent(new CustomEvent('dataRefresh'));

      // Reload list
      fetchMatches(activeTab);
    } catch (err) {
      console.error('Reconciliation action failed:', err);
      setSnackbar({
        open: true,
        message: locale === 'he' ? 'הפעולה נכשלה. אנא נסה שנית.' : 'Action failed. Please try again.',
        severity: 'error'
      });
    }
  };

  const getConfidenceChip = (score: number) => {
    if (score >= 0.9) {
      return <Chip label={locale === 'he' ? 'אמינות גבוהה' : 'High Confidence'} color="success" size="small" variant="outlined" sx={{ fontWeight: 600 }} />;
    } else if (score >= 0.7) {
      return <Chip label={locale === 'he' ? 'אמינות בינונית' : 'Medium Confidence'} color="warning" size="small" variant="outlined" sx={{ fontWeight: 600 }} />;
    } else {
      return <Chip label={locale === 'he' ? 'אמינות נמוכה' : 'Low Confidence'} color="default" size="small" variant="outlined" sx={{ fontWeight: 600 }} />;
    }
  };

  return (
    <Box sx={{ width: '100%', pb: 4 }}>
      <PageHeader
        title={locale === 'he' ? 'התאמת עסקאות' : 'Transaction Reconciliation'}
        description={
          locale === 'he' 
            ? 'אישור והתאמה בין חיובי בנק גנריים (כגון חיובי דביט) לעסקאות אשראי מפורטות כדי למנוע כפל ספירה ולהציג שמות בתי עסק מדויקים.'
            : 'Match and approve generic bank charges with credit card details to prevent double counting and show correct merchant names.'
        }
        icon={<LinkIcon sx={{ color: '#ffffff' }} />}
        actions={
          <Button
            variant="contained"
            color="primary"
            startIcon={scanning ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />}
            onClick={handleScan}
            disabled={scanning}
            sx={{
              fontFamily: 'Inter, Outfit, sans-serif',
              fontWeight: 600,
              borderRadius: '12px',
              textTransform: 'none',
              boxShadow: '0 4px 12px rgba(99, 102, 241, 0.2)'
            }}
          >
            {scanning 
              ? (locale === 'he' ? 'סורק...' : 'Scanning...') 
              : (locale === 'he' ? 'סריקת התאמות' : 'Scan Matches')
            }
          </Button>
        }
      />

      <Box sx={{ borderBottom: 1, borderColor: 'var(--n-border)', mb: 3 }}>
        <Tabs 
          value={activeTab} 
          onChange={(_, val) => setActiveTab(val)}
          textColor="primary"
          indicatorColor="primary"
          sx={{
            '& .MuiTab-root': {
              fontFamily: 'Inter, Outfit, sans-serif',
              fontWeight: 600,
              fontSize: '0.95rem',
              color: 'var(--n-text-secondary)',
              '&.Mui-selected': {
                color: 'var(--n-primary)'
              }
            }
          }}
        >
          <Tab label={locale === 'he' ? 'עסקאות לאישור' : 'Pending Review'} />
          <Tab label={locale === 'he' ? 'היסטוריית התאמות' : 'Approved Matches'} />
        </Tabs>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '250px' }}>
          <CircularProgress color="primary" />
        </Box>
      ) : candidates.length === 0 ? (
        <Paper
          sx={{
            p: 5,
            textAlign: 'center',
            background: 'var(--n-glass-bg)',
            backdropFilter: 'blur(12px)',
            border: '1px solid var(--n-border)',
            borderRadius: '16px',
            boxShadow: 'none'
          }}
        >
          <InfoOutlinedIcon sx={{ fontSize: '48px', color: 'var(--n-text-muted)', mb: 2 }} />
          <Typography variant="h6" sx={{ color: 'var(--n-text-primary)', mb: 1, fontWeight: 600 }}>
            {activeTab === 0
              ? (locale === 'he' ? 'אין עסקאות הממתינות לאישור' : 'No matches pending review')
              : (locale === 'he' ? 'טרם אושרו התאמות עסקאות' : 'No approved matches yet')
            }
          </Typography>
          <Typography variant="body2" sx={{ color: 'var(--n-text-secondary)', maxWidth: '500px', mx: 'auto' }}>
            {activeTab === 0
              ? (locale === 'he' ? 'המערכת סורקת עסקאות חדשות אוטומטית לאחר כל סנכרון. כשיימצאו חיובי דביט תואמים באשראי, הם יופיעו כאן.' : 'The system automatically scans for matches after syncs. When matching bank and credit card debits are found, they will appear here.')
              : (locale === 'he' ? 'התאמות שתאשר יופיעו כאן. תמיד תוכל לבטל התאמה כדי להפריד את העסקאות בחזרה.' : 'Matches you approve will appear here. You can unlink them at any time to separate them back.')
            }
          </Typography>
        </Paper>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {candidates.map((candidate) => {
            const bank = candidate.bankTransaction;
            const cc = candidate.ccTransaction;
            
            return (
              <Paper
                key={candidate.id}
                sx={{
                  p: 3,
                  background: 'var(--n-glass-bg)',
                  backdropFilter: 'blur(12px)',
                  border: '1px solid var(--n-border)',
                  borderRadius: '16px',
                  boxShadow: 'none',
                  transition: 'all 0.2s ease-in-out',
                  '&:hover': {
                    borderColor: alpha(theme.palette.primary.main, 0.4),
                    transform: 'translateY(-2px)'
                  }
                }}
              >
                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <LinkIcon color="primary" />
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'var(--n-text-primary)' }}>
                      {locale === 'he' ? 'הצעת התאמת דביט' : 'Proposed Debit Match'}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    {getConfidenceChip(candidate.confidence)}
                  </Box>
                </Box>

                <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: 'center', gap: 3 }}>
                  {/* Left Side: Bank Transaction */}
                  <Box 
                    sx={{ 
                      flex: 1, 
                      width: '100%',
                      p: 2, 
                      borderRadius: '12px', 
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.05)'
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                      <AccountBalanceIcon fontSize="small" sx={{ color: 'var(--n-primary)' }} />
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, color: 'var(--n-primary)' }}>
                        {locale === 'he' ? 'תנועת בנק (מקור החיוב)' : 'Bank Transaction (Debit)'}
                      </Typography>
                    </Box>
                    <Typography variant="h6" sx={{ fontWeight: 700, color: 'var(--n-text-primary)', mb: 1 }}>
                      {bank.name}
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'var(--n-text-secondary)', mb: 1 }}>
                      {formatDate(bank.date)}
                    </Typography>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <AccountDisplay 
                        transaction={{
                          vendor: bank.vendor,
                          account_number: bank.account_number,
                          transaction_type: 'bank'
                        }}
                      />
                      <Typography variant="h6" sx={{ fontWeight: 800, color: '#f44336' }}>
                        {Math.abs(bank.price).toFixed(2)} ₪
                      </Typography>
                    </Box>
                  </Box>

                  {/* Middle Arrow Icon */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <Box 
                      sx={{ 
                        p: 1.5, 
                        borderRadius: '50%', 
                        background: alpha(theme.palette.primary.main, 0.1), 
                        border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
                        color: 'var(--n-primary)'
                      }}
                    >
                      <SwapHorizIcon sx={{ fontSize: '28px' }} />
                    </Box>
                  </Box>

                  {/* Right Side: Credit Card Transaction */}
                  <Box 
                    sx={{ 
                      flex: 1, 
                      width: '100%',
                      p: 2, 
                      borderRadius: '12px', 
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.05)'
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                      <CreditCardIcon fontSize="small" sx={{ color: '#2196f3' }} />
                      <Typography variant="subtitle2" sx={{ fontWeight: 600, color: '#2196f3' }}>
                        {locale === 'he' ? 'עסקת כרטיס אשראי (פירוט העסק)' : 'Credit Card Transaction (Details)'}
                      </Typography>
                    </Box>
                    <Typography variant="h6" sx={{ fontWeight: 700, color: 'var(--n-text-primary)', mb: 1 }}>
                      {cc.name}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                      <Typography variant="body2" sx={{ color: 'var(--n-text-secondary)' }}>
                        {formatDate(cc.date)}
                      </Typography>
                      {cc.category && (
                        <Chip label={cc.category} size="small" sx={{ height: '20px', fontSize: '0.75rem', background: 'rgba(255, 255, 255, 0.08)' }} />
                      )}
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <AccountDisplay 
                        transaction={{
                          vendor: cc.vendor,
                          account_number: cc.account_number,
                          transaction_type: 'credit_card'
                        }}
                      />
                      <Typography variant="h6" sx={{ fontWeight: 800, color: '#f44336' }}>
                        {Math.abs(cc.price).toFixed(2)} ₪
                      </Typography>
                    </Box>
                  </Box>
                </Box>

                {/* Actions Panel */}
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5, mt: 3, borderTop: '1px solid rgba(255, 255, 255, 0.06)', pt: 2 }}>
                  {activeTab === 0 ? (
                    <>
                      <Button
                        variant="outlined"
                        color="error"
                        startIcon={<CloseIcon />}
                        onClick={() => handleAction(candidate.id, 'rejected', cc.name)}
                        sx={{ 
                          fontFamily: 'Inter, Outfit, sans-serif',
                          fontWeight: 600,
                          borderRadius: '8px',
                          textTransform: 'none'
                        }}
                      >
                        {locale === 'he' ? 'דחה התאמה' : 'Reject'}
                      </Button>
                      <Button
                        variant="contained"
                        color="primary"
                        startIcon={<CheckIcon />}
                        onClick={() => handleAction(candidate.id, 'approved', cc.name)}
                        sx={{ 
                          fontFamily: 'Inter, Outfit, sans-serif',
                          fontWeight: 600,
                          borderRadius: '8px',
                          textTransform: 'none',
                          boxShadow: 'none',
                          '&:hover': {
                            boxShadow: 'none'
                          }
                        }}
                      >
                        {locale === 'he' ? 'אשר התאמה' : 'Approve Match'}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outlined"
                      color="warning"
                      startIcon={<LinkOffIcon />}
                      onClick={() => handleAction(candidate.id, 'pending', cc.name)}
                      sx={{ 
                        fontFamily: 'Inter, Outfit, sans-serif',
                        fontWeight: 600,
                        borderRadius: '8px',
                        textTransform: 'none'
                      }}
                    >
                      {locale === 'he' ? 'בטל התאמה' : 'Unlink Match'}
                    </Button>
                  )}
                </Box>
              </Paper>
            );
          })}
        </Box>
      )}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          severity={snackbar.severity === 'info' ? 'info' : (snackbar.severity === 'error' ? 'error' : 'success')} 
          variant="filled"
          sx={{ width: '100%', fontFamily: 'Inter, Outfit, sans-serif', fontWeight: 500 }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default ReconciliationView;
