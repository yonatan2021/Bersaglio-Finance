import React from 'react';
import { logger } from '../../../utils/client-logger';
import { useTheme, type Theme } from '@mui/material/styles';
import { Table, TableBody, TableCell, TableHead, TableRow, Paper, Box, Typography, IconButton, TextField, Tooltip, TableSortLabel, useMediaQuery, Button } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutlineOutlined';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutlineOutlined';
import { formatNumber } from '../utils/formatUtils';
import { dateUtils } from '../utils/dateUtils';
import { useCategories } from '../utils/useCategories';
import { useCardVendors } from '../utils/useCardVendors';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import NotesIcon from '@mui/icons-material/Notes';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import { CardVendorIcon } from '../../CardVendorsModal';
import { getTableHeaderCellStyle, getTableBodyCellStyle, TABLE_ROW_HOVER_STYLE, getTableRowHoverBackground } from '../utils/tableStyles';
import DeleteConfirmationDialog from '../../DeleteConfirmationDialog';
import CategoryAutocomplete from '../../CategoryAutocomplete';
import AccountDisplay from '../../AccountDisplay';
import MobileSortableTable, { SortOption } from '../../MobileSortableTable';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../../context/LocaleContext';
import { useSnackbar } from '../../hooks/useSnackbar';
import SnackbarFeedback from '../../SnackbarFeedback';

const getCurrencySymbol = (currency?: string) => {
  if (!currency) return '₪';
  if (['EUR', '€'].includes(currency)) return '€';
  if (['USD', '$'].includes(currency)) return '$';
  if (['GBP', '£'].includes(currency)) return '£';
  if (['ILS', '₪', 'NIS'].includes(currency)) return '₪';
  return currency + ' ';
};

function getPaymentInfo(transaction: Transaction): { label: string; params?: Record<string, string> } {
  if (transaction.card_type === 'direct') {
    return { label: 'dash' };
  }
  if (transaction.is_debit) {
    return { label: 'immediate' };
  }
  if (transaction.card_type === 'credit' && transaction.bank_debit_date) {
    const txDate = new Date(transaction.date);
    const bankDate = new Date(transaction.bank_debit_date);
    const daysDiff = Math.abs(txDate.getTime() - bankDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysDiff <= 3) {
      return { label: 'immediateCreditCard' };
    }
  }
  const billingDay = transaction.billing_cycle_start_day || 10;
  const txDate = new Date(transaction.date);
  const txDay = txDate.getDate();
  let billingMonth: Date;
  if (txDay >= billingDay) {
    billingMonth = new Date(txDate.getFullYear(), txDate.getMonth() + 1, billingDay);
  } else {
    billingMonth = new Date(txDate.getFullYear(), txDate.getMonth(), billingDay);
  }
  const billingDateStr = `${billingMonth.getDate().toString().padStart(2, '0')}/${(billingMonth.getMonth() + 1).toString().padStart(2, '0')}`;
  if (transaction.installments_total && transaction.installments_total > 1) {
    return {
      label: 'installmentWithBilling',
      params: {
        current: String(transaction.installments_number || 1),
        total: String(transaction.installments_total),
        date: billingDateStr
      }
    };
  }
  return { label: 'billingDate', params: { date: billingDateStr } };
}

export interface Transaction {
  name: string;
  display_name?: string;
  original_name?: string;
  price: number;
  date: string;
  category: string;
  identifier: string;
  vendor: string;
  installments_number?: number;
  installments_total?: number;
  vendor_nickname?: string;
  original_amount?: number;
  original_currency?: string;
  charged_currency?: string;
  account_number?: string;
  processed_date?: string;
  is_favorite?: boolean;
  notes?: string;
  transaction_type?: string;
  is_reconciled?: boolean;
  card_type?: 'credit' | 'debit' | 'direct';
  is_debit?: boolean;
  bank_account_name?: string;
  billing_cycle_start_day?: number;
  bank_debit_date?: string;
  is_credit?: boolean;
  cc_vendor_resolved?: string;
  cc_account_number_resolved?: string;
  category_type?: string;
}

export interface ServerSummary {
  totalCount: number;
  totalExpenses: number;
  totalIncome: number;
  creditCardTotal: number;
  debitTotal: number;
  directTotal: number;
}

export interface TransactionsTableProps {
  transactions: Transaction[];
  serverSummary?: ServerSummary | null;
  isLoading?: boolean;
  onDelete?: (transaction: Transaction) => void;
  onUpdate?: (transaction: Transaction, updates: Partial<Transaction>) => void;
  groupByDate?: boolean;
  disableWrapper?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  onSort?: (field: string) => void;
  hideActions?: boolean;
  hideInstallmentsColumn?: boolean;
  showProcessedDate?: boolean;
  isBankView?: boolean;
}

const TransactionsTable: React.FC<TransactionsTableProps> = ({
  transactions,
  serverSummary,
  isLoading,
  onDelete,
  onUpdate,
  groupByDate,
  disableWrapper,
  sortBy,
  sortOrder,
  onSort,
  hideActions,
  hideInstallmentsColumn,
  showProcessedDate = false,
  isBankView = false
}) => {
  const theme = useTheme();
  const { t } = useTranslation(['tx', 'common']);
  const { locale } = useLocale();
  const dateLocale = locale === 'he' ? 'he-IL' : 'en-US';
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [editingTransaction, setEditingTransaction] = React.useState<Transaction | null>(null);
  const [editPrice, setEditPrice] = React.useState<string>('');
  const [editCategory, setEditCategory] = React.useState<string>('');
  const [applyToAll, setApplyToAll] = React.useState<boolean>(false);
  const { categories: availableCategories } = useCategories();
  const { getCardVendor, getCardNickname } = useCardVendors();
  const { snackbar, showSnackbar, hideSnackbar } = useSnackbar<'success' | 'error' | 'info'>();
  const [confirmDeleteTransaction, setConfirmDeleteTransaction] = React.useState<Transaction | null>(null);
  const [editingNotes, setEditingNotes] = React.useState<{ identifier: string; vendor: string; content: string } | null>(null);

  const handleToggleFavorite = React.useCallback(async (transaction: Transaction) => {
    try {
      const newStatus = !transaction.is_favorite;
      onUpdate?.(transaction, { is_favorite: newStatus });
    } catch (error) {
      logger.error('Error toggling favorite', error as Error);
    }
  }, [onUpdate]);

  const handleNotesUpdate = React.useCallback(async (transaction: Transaction, notes: string) => {
    try {
      onUpdate?.(transaction, { notes });
      setEditingNotes(null);
    } catch (error) {
      logger.error('Error updating notes', error as Error);
    }
  }, [onUpdate]);

  const handleDeleteClick = React.useCallback(() => {
    if (!confirmDeleteTransaction) return;
    try {
      onDelete?.(confirmDeleteTransaction);
      showSnackbar(t('tx:snackbar.deleteSuccess'), 'success');
    } catch (error) {
      logger.error('Error deleting transaction', error as Error);
      showSnackbar(t('tx:snackbar.deleteError'), 'error');
    }
    setConfirmDeleteTransaction(null);
  }, [confirmDeleteTransaction, onDelete, showSnackbar, t]);

  const handleEditClick = React.useCallback((transaction: Transaction) => {
    setEditingTransaction(transaction);
    setEditPrice(Math.abs(transaction.price).toString());
    setEditCategory(transaction.category);
    setApplyToAll(false);
  }, []);

  const handleSaveClick = React.useCallback(async () => {
    if (editingTransaction && editPrice) {
      const newPrice = parseFloat(editPrice);
      if (!isNaN(newPrice)) {
        const sign = isBankView ? (editingTransaction.price >= 0 ? 1 : -1) : (editingTransaction.price < 0 ? -1 : 1);
        const priceWithSign = sign * newPrice;
        const categoryChanged = editCategory !== editingTransaction.category;
        const priceChanged = priceWithSign !== editingTransaction.price;

        try {
          if (categoryChanged) {
            if (applyToAll) {
              const response = await fetch('/api/categories/update-by-description', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  description: editingTransaction.name,
                  newCategory: editCategory,
                  createRule: true
                }),
              });

              if (response.ok) {
                const result = await response.json();
                showSnackbar(
                  result.transactionsUpdated > 1
                    ? t('tx:snackbar.updatedManyAndRule', { count: result.transactionsUpdated })
                    : t('tx:snackbar.categoryUpdatedAndRule'),
                  'success'
                );
                onUpdate?.(editingTransaction, { category: editCategory, price: priceWithSign });
                window.dispatchEvent(new CustomEvent('dataRefresh'));
              }
            } else {
              onUpdate?.(editingTransaction, { category: editCategory, price: priceWithSign });
            }
          } else if (priceChanged) {
            onUpdate?.(editingTransaction, { price: priceWithSign });
          }
        } catch (error) {
          logger.error('Error updating transaction', error as Error);
          showSnackbar(t('tx:snackbar.updateError'), 'error');
        }
        setEditingTransaction(null);
      }
    }
  }, [editingTransaction, editPrice, editCategory, applyToAll, onUpdate, isBankView, showSnackbar, t]);

  const handleCancelClick = React.useCallback(() => {
    setEditingTransaction(null);
  }, []);

  const handleRowClick = React.useCallback((transaction: Transaction) => {
    if (editingTransaction && (editingTransaction.identifier !== transaction.identifier || editingTransaction.vendor !== transaction.vendor)) {
      handleSaveClick();
    }
  }, [editingTransaction, handleSaveClick]);

  const _handleTableClick = React.useCallback((e: React.MouseEvent) => {
    if (editingTransaction && (e.target as HTMLElement).tagName === 'TABLE') {
      handleSaveClick();
    }
  }, [editingTransaction, handleSaveClick]);

  const groupedTransactions = React.useMemo(() => {
    if (!groupByDate) return { 'all': transactions };
    const groups: { [date: string]: Transaction[] } = {};
    transactions.forEach(transaction => {
      const d = new Date(transaction.date);
      const dateKey = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(transaction);
    });
    return groups;
  }, [transactions, groupByDate]);

  const sortedDates = React.useMemo(() => {
    if (!groupByDate) return [];
    return Object.keys(groupedTransactions).sort((a, b) => b.localeCompare(a));
  }, [groupedTransactions, groupByDate]);

  const formatDateHeader = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.getTime() === today.getTime()) return t('tx:groupHeader.today');
    if (date.getTime() === yesterday.getTime()) return t('tx:groupHeader.yesterday');
    return date.toLocaleDateString(dateLocale, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  };

  const mobileSortOptions: SortOption[] = React.useMemo(() => [
    { id: 'date', label: t('tx:table.sortByDate'), defaultDirection: 'desc' },
    { id: 'price', label: t('tx:table.sortByAmount'), defaultDirection: 'desc' },
    { id: 'name', label: t('tx:table.sortByName'), defaultDirection: 'asc' },
    { id: 'category', label: t('tx:table.sortByCategory'), defaultDirection: 'asc' },
  ], [t]);

  const handleMobileSort = React.useCallback((field: string) => {
    if (onSort) onSort(field);
  }, [onSort]);

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><Typography>{t('tx:table.loading')}</Typography></Box>;
  if (!transactions || transactions.length === 0) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><Typography>{t('tx:table.empty')}</Typography></Box>;

  const columnWidths = { description: '24%', type: '5%', category: '12%', amount: '10%', installment: '10%', card: '12%', bankAccount: '11%', date: '8%', actions: '8%' };
  const tableHeaderBaseStyle = getTableHeaderCellStyle(theme);

  const renderSortableHeader = (label: string, field: string, align: 'left' | 'right' = 'left', width?: string) => {
    const isSorted = sortBy === field;
    return (
      <TableCell align={align} style={{ ...tableHeaderBaseStyle, cursor: 'pointer', position: 'sticky', top: 0, zIndex: 10, width }} sortDirection={isSorted ? sortOrder : false}>
        {onSort ? (
          <TableSortLabel active={isSorted} direction={isSorted ? sortOrder : 'desc'} onClick={() => onSort(field)}>
            {label}
          </TableSortLabel>
        ) : label}
      </TableCell>
    );
  };

  const content = (
    <Box sx={{ width: '100%' }}>
      {transactions.length > 0 && <TransactionsSummaryBar transactions={transactions} serverSummary={serverSummary} />}
      {isMobile ? (
        <MobileSortableTable
          sortOptions={mobileSortOptions}
          rows={transactions}
          loading={isLoading}
          sortField={sortBy || 'date'}
          sortDirection={sortOrder || 'desc'}
          onSort={handleMobileSort}
          rowKey={(t) => `${t.identifier}-${t.vendor}`}
          renderCard={(t) => (
            <TransactionMobileCardContent
              transaction={t}
              theme={theme}
              onEdit={() => handleEditClick(t)}
              onDelete={() => setConfirmDeleteTransaction(t)}
              onToggleFavorite={() => handleToggleFavorite(t)}
              onNotesUpdate={(notes) => handleNotesUpdate(t, notes)}
              getCardVendor={getCardVendor}
              getCardNickname={getCardNickname}
              showDate={!groupByDate}
              isEditing={editingTransaction?.identifier === t.identifier}
              editCategory={editCategory}
              setEditCategory={setEditCategory}
              availableCategories={availableCategories}
              applyToAll={applyToAll}
              setApplyToAll={setApplyToAll}
              editPrice={editPrice}
              setEditPrice={setEditPrice}
              onSave={handleSaveClick}
              onCancel={handleCancelClick}
            />
          )}
        />
      ) : (
        <Table size={disableWrapper ? "small" : "medium"} stickyHeader>
          <TableHead>
            <TableRow>
              {renderSortableHeader(t('tx:table.columnDescription'), 'name', 'left', columnWidths.description)}
              <TableCell style={{ ...tableHeaderBaseStyle, width: columnWidths.type }}>{t('tx:table.columnType')}</TableCell>
              {renderSortableHeader(t('tx:table.columnCategory'), 'category', 'left', columnWidths.category)}
              {renderSortableHeader(t('tx:table.columnAmount'), 'price', 'right', columnWidths.amount)}
              {!hideInstallmentsColumn && <TableCell style={{ ...tableHeaderBaseStyle, width: columnWidths.installment }}>{t('tx:table.columnInstallments')}</TableCell>}
              {renderSortableHeader(t('tx:table.columnCard'), 'account_number', 'left', columnWidths.card)}
              <TableCell style={{ ...tableHeaderBaseStyle, width: columnWidths.bankAccount }}>{t('tx:table.columnBankAccount')}</TableCell>
              {!groupByDate && renderSortableHeader(t('tx:table.columnDate'), 'date', 'left', columnWidths.date)}
              {!hideActions && <TableCell align="right" style={{ ...tableHeaderBaseStyle, width: columnWidths.actions }}>{t('tx:table.columnActions')}</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {groupByDate ? sortedDates.map(date => (
              <React.Fragment key={date}>
                <TableRow sx={{ background: theme.palette.mode === 'dark' ? 'rgba(30, 41, 59, 1)' : '#f8fafc', position: 'sticky', top: 53, zIndex: 9 }}>
                  <TableCell colSpan={9} sx={{ fontWeight: 700, p: 1 }}>{formatDateHeader(date)}</TableCell>
                </TableRow>
                {groupedTransactions[date].map((t, i) => (
                  <TransactionRow
                    key={`${t.identifier}-${i}`}
                    transaction={t}
                    theme={theme}
                    editingTransaction={editingTransaction}
                    editCategory={editCategory}
                    setEditCategory={setEditCategory}
                    availableCategories={availableCategories}
                    applyToAll={applyToAll}
                    setApplyToAll={setApplyToAll}
                    handleRowClick={handleRowClick}
                    handleEditClick={handleEditClick}
                    editPrice={editPrice}
                    setEditPrice={setEditPrice}
                    handleSaveClick={handleSaveClick}
                    handleCancelClick={handleCancelClick}
                    setConfirmDeleteTransaction={setConfirmDeleteTransaction}
                    onToggleFavorite={handleToggleFavorite}
                    onNotesUpdate={handleNotesUpdate}
                    editingNotes={editingNotes}
                    setEditingNotes={setEditingNotes}
                    getCardVendor={getCardVendor}
                    getCardNickname={getCardNickname}
                    isWidget={disableWrapper}
                    hideActions={hideActions}
                    hideInstallmentsColumn={hideInstallmentsColumn}
                    showProcessedDate={showProcessedDate}
                    groupByDate={true}
                  />
                ))}
              </React.Fragment>
            )) : transactions.map((t, i) => (
              <TransactionRow
                key={i}
                transaction={t}
                theme={theme}
                editingTransaction={editingTransaction}
                editCategory={editCategory}
                setEditCategory={setEditCategory}
                availableCategories={availableCategories}
                applyToAll={applyToAll}
                setApplyToAll={setApplyToAll}
                handleRowClick={handleRowClick}
                handleEditClick={handleEditClick}
                editPrice={editPrice}
                setEditPrice={setEditPrice}
                handleSaveClick={handleSaveClick}
                handleCancelClick={handleCancelClick}
                setConfirmDeleteTransaction={setConfirmDeleteTransaction}
                onToggleFavorite={handleToggleFavorite}
                onNotesUpdate={handleNotesUpdate}
                editingNotes={editingNotes}
                setEditingNotes={setEditingNotes}
                getCardVendor={getCardVendor}
                getCardNickname={getCardNickname}
                isWidget={disableWrapper}
                hideActions={hideActions}
                hideInstallmentsColumn={hideInstallmentsColumn}
                showProcessedDate={showProcessedDate}
                isBankView={isBankView}
                groupByDate={false}
              />
            ))}
          </TableBody>
        </Table>
      )}
      <SnackbarFeedback snackbar={snackbar} onClose={hideSnackbar} />
      <DeleteConfirmationDialog
        open={!!confirmDeleteTransaction}
        onClose={() => setConfirmDeleteTransaction(null)}
        onConfirm={handleDeleteClick}
        transaction={confirmDeleteTransaction}
      />
    </Box>
  );

  return disableWrapper ? content : <Paper elevation={0} sx={{ p: 2, borderRadius: '16px' }}>{content}</Paper>;
};

interface TransactionRowProps {
  transaction: Transaction;
  theme: Theme;
  editingTransaction: Transaction | null;
  editCategory: string;
  setEditCategory: (val: string) => void;
  availableCategories: string[];
  applyToAll: boolean;
  setApplyToAll: (val: boolean) => void;
  handleRowClick: (t: Transaction) => void;
  handleEditClick: (t: Transaction) => void;
  editPrice: string;
  setEditPrice: (val: string) => void;
  handleSaveClick: () => void;
  handleCancelClick: () => void;
  setConfirmDeleteTransaction: (t: Transaction) => void;
  getCardVendor: (accountNumber: string | undefined | null) => string | null;
  getCardNickname: (accountNumber: string | undefined | null) => string | null | undefined;
  onToggleFavorite: (t: Transaction) => void;
  onNotesUpdate: (t: Transaction, notes: string) => void;
  editingNotes: { identifier: string; vendor: string; content: string } | null;
  setEditingNotes: (val: { identifier: string; vendor: string; content: string } | null) => void;
  isWidget?: boolean;
  hideActions?: boolean;
  hideInstallmentsColumn?: boolean;
  showProcessedDate?: boolean;
  isBankView?: boolean;
  groupByDate?: boolean;
}

const TransactionRow = React.memo(({
  transaction,
  theme,
  editingTransaction,
  editCategory,
  setEditCategory,
  availableCategories,
  applyToAll,
  setApplyToAll,
  handleRowClick,
  handleEditClick,
  editPrice,
  setEditPrice,
  handleSaveClick,
  handleCancelClick,
  setConfirmDeleteTransaction,
  getCardVendor: _getCardVendor,
  getCardNickname: _getCardNickname,
  onToggleFavorite,
  onNotesUpdate,
  editingNotes,
  setEditingNotes,
  isWidget,
  hideActions,
  hideInstallmentsColumn,
  showProcessedDate: _showProcessedDate,
  isBankView,
  groupByDate
}: TransactionRowProps) => {
  const { t } = useTranslation(['tx', 'common']);
  const cellStyle = { ...getTableBodyCellStyle(theme), fontSize: isWidget ? '0.75rem' : '0.875rem', p: isWidget ? '4px 12px' : '8px 16px' };

  return (
    <TableRow onClick={() => handleRowClick(transaction)} style={TABLE_ROW_HOVER_STYLE} onMouseEnter={(e) => e.currentTarget.style.background = getTableRowHoverBackground(theme)} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
      <TableCell style={{ ...cellStyle, maxWidth: '300px' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Tooltip title={transaction.is_favorite ? t('tx:tooltips.unfavorite') : t('tx:tooltips.favorite')}>
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); onToggleFavorite(transaction); }}
              sx={{
                color: transaction.is_favorite ? '#fbbf24' : theme.palette.text.disabled,
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                p: '4px',
                '&:hover': {
                  transform: 'scale(1.2) rotate(5deg)',
                  color: '#fbbf24',
                  background: 'rgba(251, 191, 36, 0.08)'
                },
                '& svg': {
                  filter: transaction.is_favorite ? 'drop-shadow(0 0 2px rgba(251, 191, 36, 0.4))' : 'none'
                }
              }}
            >
              {transaction.is_favorite ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{transaction.name}</Typography>
            {transaction.is_reconciled && transaction.original_name && transaction.original_name !== transaction.name && (
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', display: 'block', mt: 0.25 }} noWrap>
                {transaction.original_name}
              </Typography>
            )}
            {transaction.notes && (
              <Typography
                variant="caption"
                sx={{ color: 'text.secondary', fontStyle: 'italic', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}
                noWrap
              >
                <NotesIcon sx={{ fontSize: '0.75rem', opacity: 0.7 }} />
                {transaction.notes}
              </Typography>
            )}
          </Box>
        </Box>
      </TableCell>
      <TableCell style={{ ...cellStyle, textAlign: 'center' }}>
        <Tooltip title={transaction.is_credit ? t('tx:table.credit') : t('tx:table.charge')}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {transaction.is_credit ? (
              <AddCircleOutlineIcon sx={{ fontSize: '1rem', color: 'var(--n-success)' }} />
            ) : (
              <RemoveCircleOutlineIcon sx={{ fontSize: '1rem', color: 'var(--n-error)' }} />
            )}
          </Box>
        </Tooltip>
      </TableCell>
      <TableCell style={cellStyle}>
        {editingTransaction?.identifier === transaction.identifier && !hideActions ? (
          <CategoryAutocomplete value={editCategory} onChange={setEditCategory} options={availableCategories} applyToAll={applyToAll} onApplyToAllChange={setApplyToAll} showApplyToAll={editCategory !== editingTransaction.category} />
        ) : <span style={{ cursor: 'pointer', color: 'var(--n-info)' }} onClick={(e) => { e.stopPropagation(); handleEditClick(transaction); }}>{transaction.category}</span>}
      </TableCell>
      <TableCell align="right" style={{
        ...cellStyle,
        color: transaction.is_credit ? 'var(--n-success)' : 'var(--n-error)',
        fontWeight: 600
      }}>
        {editingTransaction?.identifier === transaction.identifier && !hideActions ? (
          <TextField value={editPrice} onChange={(e) => setEditPrice(e.target.value)} size="small" type="number" sx={{ width: '80px' }} />
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span>₪{formatNumber(Math.abs(transaction.price))}</span>
            {transaction.original_currency && !['ILS', '₪', 'NIS'].includes(transaction.original_currency) && transaction.original_amount && (
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.7rem' }}>
                ({getCurrencySymbol(transaction.original_currency)}{formatNumber(Math.abs(transaction.original_amount))})
              </Typography>
            )}
          </Box>
        )}
      </TableCell>
      {!hideInstallmentsColumn && (
        <TableCell align="center" style={cellStyle}>
          {(() => {
            const info = getPaymentInfo(transaction);
            if (info.label === 'dash') return '—';
            if (info.label === 'immediate') return t('tx:table.immediate');
            if (info.label === 'immediateCreditCard') return t('tx:table.immediateCreditCard');
            return t(`tx:table.${info.label}`, info.params || {});
          })()}
        </TableCell>
      )}
      <TableCell style={cellStyle}>
        <AccountDisplay transaction={transaction} compact={isWidget} />
      </TableCell>
      <TableCell style={cellStyle}>
        {transaction.bank_account_name ? (
          <Typography variant="body2" sx={{ fontSize: isWidget ? '11px' : '13px', fontWeight: 600 }}>
            {transaction.bank_account_name}
          </Typography>
        ) : (
          <Tooltip title={t('tx:table.linkCardTooltip')}>
            <Typography variant="body2" sx={{ color: 'text.disabled', fontSize: isWidget ? '11px' : '13px' }}>
              {t('tx:table.notLinked')}
            </Typography>
          </Tooltip>
        )}
      </TableCell>
      {!groupByDate && (
        <TableCell style={cellStyle}>
          {dateUtils.formatDate(transaction.date)}
        </TableCell>
      )}
      {!hideActions && (
        <TableCell align="right" style={cellStyle}>
          {editingTransaction?.identifier === transaction.identifier ? (
            <>
              <Tooltip title={t('common:actions.save')}>
                <IconButton onClick={handleSaveClick} sx={{ color: '#4ADE80' }}><CheckIcon /></IconButton>
              </Tooltip>
              <Tooltip title={t('common:actions.cancel')}>
                <IconButton onClick={handleCancelClick} sx={{ color: 'var(--n-error)' }}><CloseIcon /></IconButton>
              </Tooltip>
            </>
          ) : (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Tooltip title={t('tx:tooltips.editTransaction')}>
                <IconButton onClick={(e) => { e.stopPropagation(); handleEditClick(transaction); }} size="small" sx={{ color: 'var(--n-info)' }}><EditIcon fontSize="small" /></IconButton>
              </Tooltip>
              <Tooltip title={transaction.notes ? t('tx:tooltips.viewNotes') : t('tx:tooltips.openNotes')}>
                <IconButton onClick={(e) => { e.stopPropagation(); setEditingNotes({ identifier: transaction.identifier, vendor: transaction.vendor, content: transaction.notes || '' }); }} size="small" sx={{ color: transaction.notes ? theme.palette.primary.main : theme.palette.text.disabled }}><NotesIcon fontSize="small" /></IconButton>
              </Tooltip>
              <Tooltip title={t('tx:tooltips.deleteTransaction')}>
                <IconButton onClick={(e) => { e.stopPropagation(); setConfirmDeleteTransaction(transaction); }} size="small" sx={{ color: 'var(--n-error)' }}><DeleteIcon fontSize="small" /></IconButton>
              </Tooltip>
            </Box>
          )}
          {editingNotes?.identifier === transaction.identifier && editingNotes?.vendor === transaction.vendor && (
            <Box onClick={(e) => e.stopPropagation()} sx={{ position: 'fixed', zIndex: 1000, bgcolor: 'background.paper', p: 2, borderRadius: 2, boxShadow: 3, border: 1, borderColor: 'divider', width: 250, right: 50 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('tx:notes.title')}</Typography>
              <TextField fullWidth multiline rows={3} placeholder={t('tx:notes.placeholder')} value={editingNotes.content} onChange={(e) => setEditingNotes({ ...editingNotes, content: e.target.value })} size="small" sx={{ mb: 1 }} />
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                <Button size="small" onClick={() => setEditingNotes(null)}>{t('common:actions.cancel')}</Button>
                <Button variant="contained" size="small" onClick={() => onNotesUpdate(transaction, editingNotes.content)}>{t('common:actions.save')}</Button>
              </Box>
            </Box>
          )}
        </TableCell>
      )}
    </TableRow>
  );
});
TransactionRow.displayName = 'TransactionRow';

interface TransactionMobileCardProps {
  transaction: Transaction;
  theme: Theme;
  onEdit: () => void;
  onDelete: () => void;
  getCardVendor: (accountNumber: string | undefined | null) => string | null;
  getCardNickname: (accountNumber: string | undefined | null) => string | null | undefined;
  showDate?: boolean;
  isEditing?: boolean;
  editCategory?: string;
  setEditCategory?: (val: string) => void;
  availableCategories?: string[];
  applyToAll?: boolean;
  setApplyToAll?: (val: boolean) => void;
  editPrice?: string;
  setEditPrice?: (val: string) => void;
  onSave?: () => void;
  onCancel?: () => void;
  onToggleFavorite?: () => void;
  onNotesUpdate?: (notes: string) => void;
  isBankView?: boolean;
}

const TransactionMobileCardContent = ({
  transaction,
  theme,
  onEdit,
  onDelete,
  onToggleFavorite,
  onNotesUpdate,
  getCardVendor,
  getCardNickname,
  showDate,
  isEditing,
  editCategory,
  setEditCategory,
  availableCategories,
  applyToAll,
  setApplyToAll,
  editPrice: _editPrice,
  setEditPrice: _setEditPrice,
  onSave,
  onCancel,
  isBankView = false
}: TransactionMobileCardProps) => {
  const { t } = useTranslation(['tx', 'common']);
  const [showNoteInput, setShowNoteInput] = React.useState(false);
  const [noteContent, setNoteContent] = React.useState(transaction.notes || '');

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', flex: 1 }}>
          <IconButton
            size="small"
            onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(); }}
            sx={{
              color: transaction.is_favorite ? '#fbbf24' : theme.palette.text.disabled,
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              p: '4px',
              '&:hover': {
                transform: 'scale(1.1)',
                color: '#fbbf24',
              }
            }}
          >
            {transaction.is_favorite ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
          </IconButton>
          <Box sx={{ ml: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" noWrap sx={{ fontWeight: 700 }}>{transaction.name}</Typography>
            {transaction.is_reconciled && transaction.original_name && transaction.original_name !== transaction.name && (
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', display: 'block' }} noWrap>
                {transaction.original_name}
              </Typography>
            )}
            {showDate && <Typography
              variant="caption"
              sx={{
                display: "block",
                color: "text.secondary"
              }}>{dateUtils.formatDate(transaction.date)}</Typography>}
            {transaction.notes && !showNoteInput && <Typography
              variant="caption"
              sx={{
                fontStyle: "italic",
                color: "text.secondary",
                display: "block"
              }}>{transaction.notes}</Typography>}
          </Box>
        </Box>
        <Typography variant="subtitle2" sx={{ fontWeight: 800, color: transaction.is_credit ? 'var(--n-success)' : 'var(--n-error)' }}>
          ₪{formatNumber(Math.abs(transaction.price))}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        {isEditing ? (
          <CategoryAutocomplete value={editCategory || ''} onChange={setEditCategory || (() => { })} options={availableCategories || []} applyToAll={applyToAll || false} onApplyToAllChange={setApplyToAll || (() => { })} showApplyToAll={editCategory !== transaction.category} />
        ) : <Typography variant="caption" sx={{ color: 'var(--n-info)', background: 'rgba(59, 130, 246, 0.1)', p: '2px 8px', borderRadius: 1 }}>{transaction.category}</Typography>}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
          <AccountDisplay transaction={transaction} compact />
          {transaction.bank_account_name && (
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '10px' }}>
              → {transaction.bank_account_name}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {isEditing ? (
            <>
              <Tooltip title={t('common:actions.save')}>
                <IconButton size="small" onClick={onSave} sx={{ color: 'var(--n-success)' }}><CheckIcon fontSize="small" /></IconButton>
              </Tooltip>
              <Tooltip title={t('common:actions.cancel')}>
                <IconButton size="small" onClick={onCancel} sx={{ color: 'var(--n-error)' }}><CloseIcon fontSize="small" /></IconButton>
              </Tooltip>
            </>
          ) : (
            <>
              <Tooltip title={t('tx:tooltips.editTransaction')}>
                <IconButton size="small" onClick={onEdit} sx={{ color: 'var(--n-info)' }}><EditIcon fontSize="small" /></IconButton>
              </Tooltip>
              <Tooltip title={transaction.notes ? t('tx:tooltips.viewNotes') : t('tx:tooltips.openNotes')}>
                <IconButton size="small" onClick={() => setShowNoteInput(!showNoteInput)} sx={{ color: transaction.notes ? theme.palette.primary.main : theme.palette.text.disabled }}><NotesIcon fontSize="small" /></IconButton>
              </Tooltip>
              <Tooltip title={t('tx:tooltips.deleteTransaction')}>
                <IconButton size="small" onClick={onDelete} sx={{ color: 'var(--n-error)' }}><DeleteIcon fontSize="small" /></IconButton>
              </Tooltip>
            </>
          )}
        </Box>
      </Box>
      {showNoteInput && (
        <Box sx={{ mt: 1 }}>
          <TextField fullWidth multiline rows={2} size="small" placeholder={t('tx:notes.placeholder')} value={noteContent} onChange={(e) => setNoteContent(e.target.value)} />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
            <Button size="small" onClick={() => setShowNoteInput(false)}>{t('common:actions.cancel')}</Button>
            <Button size="small" variant="contained" onClick={() => { onNotesUpdate?.(noteContent); setShowNoteInput(false); }}>{t('common:actions.save')}</Button>
          </Box>
        </Box>
      )}
    </Box>
  );
};

interface TransactionsSummaryBarProps {
  transactions: Transaction[];
  serverSummary?: ServerSummary | null;
}

const TransactionsSummaryBar: React.FC<TransactionsSummaryBarProps> = ({ transactions, serverSummary }) => {
  const { t } = useTranslation('tx');
  const theme = useTheme();

  const stats = React.useMemo(() => {
    if (serverSummary) {
      return {
        totalExpenses: serverSummary.totalExpenses,
        totalIncome: serverSummary.totalIncome,
        net: serverSummary.totalIncome - serverSummary.totalExpenses,
        creditCardTotal: serverSummary.creditCardTotal,
        debitTotal: serverSummary.debitTotal,
        directTotal: serverSummary.directTotal,
      };
    }

    let totalExpenses = 0;
    let totalIncome = 0;
    let creditCardTotal = 0;
    let debitTotal = 0;
    let directTotal = 0;

    transactions.forEach(tx => {
      const amount = Math.abs(tx.price);
      const catType = tx.category_type || 'expense';
      if (catType === 'transfer') return;
      if (tx.price > 0 || catType === 'income') {
        totalIncome += amount;
      } else {
        totalExpenses += amount;
        if (tx.card_type === 'debit') debitTotal += amount;
        else if (tx.card_type === 'direct') directTotal += amount;
        else creditCardTotal += amount;
      }
    });

    return { totalExpenses, totalIncome, net: totalIncome - totalExpenses, creditCardTotal, debitTotal, directTotal };
  }, [transactions, serverSummary]);

  return (
    <Box sx={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 2,
      p: 2,
      mb: 2,
      borderRadius: '12px',
      background: theme.palette.mode === 'dark' ? 'rgba(30, 41, 59, 0.6)' : 'rgba(241, 245, 249, 0.8)',
      border: `1px solid ${theme.palette.divider}`
    }}>
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', flex: 1 }}>
        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <TrendingDownIcon sx={{ fontSize: '0.85rem' }} />
            {t('summary.totalCharges')}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 700, color: 'var(--n-error)', fontVariantNumeric: 'tabular-nums' }}>₪{formatNumber(stats.totalExpenses)}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <TrendingUpIcon sx={{ fontSize: '0.85rem' }} />
            {t('summary.totalCredits')}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 700, color: 'var(--n-success)', fontVariantNumeric: 'tabular-nums' }}>₪{formatNumber(stats.totalIncome)}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>{t('summary.net')}</Typography>
          <Typography variant="body2" sx={{ fontWeight: 700, color: stats.net > 0 ? 'var(--n-success)' : stats.net < 0 ? 'var(--n-error)' : undefined, fontVariantNumeric: 'tabular-nums' }}>₪{formatNumber(stats.net)}</Typography>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>{t('summary.breakdown')}:</Typography>
        <Typography variant="caption" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{t('summary.creditCard')} ₪{formatNumber(stats.creditCardTotal)}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>·</Typography>
        <Typography variant="caption" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{t('summary.debitCard')} ₪{formatNumber(stats.debitTotal)}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>·</Typography>
        <Typography variant="caption" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{t('summary.directBank')} ₪{formatNumber(stats.directTotal)}</Typography>
      </Box>
    </Box>
  );
};

export { TransactionsSummaryBar };
export default TransactionsTable;