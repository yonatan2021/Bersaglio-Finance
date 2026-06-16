import type { Meta, StoryObj } from '@storybook/react';
import { Box } from '@mui/material';
import React from 'react';
import TransactionsTable, { Transaction } from '../components/CategoryDashboard/components/TransactionsTable';
import { createTheme } from '@mui/material/styles';

const _darkTheme = createTheme({
    palette: {
        mode: 'dark',
    },
});

const _lightTheme = createTheme({
    palette: {
        mode: 'light',
    },
});

const meta: Meta<typeof TransactionsTable> = {
    title: 'Components/TransactionsTable',
    component: TransactionsTable,
    parameters: {
        layout: 'padded',
    },
    tags: ['autodocs'],
    decorators: [
        (Story) => (
            <Box sx={{ p: 4, bgcolor: 'var(--n-bg-main)', minHeight: '400px', borderRadius: '16px' }}>
                <Story />
            </Box>
        ),
    ],
};

export default meta;

type Story = StoryObj<typeof TransactionsTable>;

const mockTransactions: Transaction[] = [
    {
        identifier: '1',
        name: 'Apple Services',
        price: -29.90,
        date: '2024-03-01',
        category: 'Subscriptions',
        vendor: 'Visa',
        account_number: '1234',
        is_favorite: true,
        notes: 'Monthly iCloud storage'
    },
    {
        identifier: '2',
        name: 'Super-Pharm',
        price: -142.00,
        date: '2024-03-01',
        category: 'Health',
        vendor: 'Mastercard',
        account_number: '5678',
        is_favorite: false
    },
    {
        identifier: '3',
        name: 'Salary Deposit',
        price: 18500.00,
        date: '2024-02-28',
        category: 'Income',
        vendor: 'Bank',
        account_number: '9012',
        is_favorite: false,
        notes: 'February Salary'
    },
    {
        identifier: '4',
        name: 'Wolt Dispatch',
        price: -84.50,
        date: '2024-02-28',
        category: 'Food',
        vendor: 'Amex',
        account_number: '3456',
        is_favorite: true
    },
    {
        identifier: '5',
        name: 'Netflix',
        price: -54.90,
        date: '2024-02-27',
        category: 'Entertainment',
        vendor: 'Visa',
        account_number: '1234',
        is_favorite: false
    }
];

export const Desktop: Story = {
    args: {
        transactions: mockTransactions,
        isLoading: false,
    },
};

export const GroupedByDate: Story = {
    args: {
        transactions: mockTransactions,
        isLoading: false,
        groupByDate: true,
    },
};

export const Mobile: Story = {
    parameters: {
        viewport: {
            defaultViewport: 'mobile1'
        }
    },
    args: {
        transactions: mockTransactions,
        isLoading: false,
    },
};

export const Loading: Story = {
    args: {
        transactions: [],
        isLoading: true,
    },
};

export const Empty: Story = {
    args: {
        transactions: [],
        isLoading: false,
    },
};
