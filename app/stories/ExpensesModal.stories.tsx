/* eslint-disable @typescript-eslint/no-explicit-any -- stories use loose types so the wrappers can spread varying arg shapes into the wrapped component */
import type { Meta, StoryObj } from '@storybook/react';
import React, { useState } from 'react';
import { Button } from '@mui/material';
import ExpensesModal from '../components/CategoryDashboard/components/ExpensesModal';

const meta: Meta<typeof ExpensesModal> = {
    title: 'Components/ExpensesModal',
    component: ExpensesModal,
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
};

export default meta;

type Story = StoryObj<typeof ExpensesModal>;

const mockExpenses = [
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
    }
];

const InteractiveWrapper = (args: any) => {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button variant="contained" onClick={() => setOpen(true)}>
                Open Expenses Modal
            </Button>
            <ExpensesModal
                {...args}
                open={open}
                onClose={() => setOpen(false)}
                data={{
                    type: 'Subscriptions',
                    data: mockExpenses
                }}
            />
        </>
    );
};

export const Default: Story = {
    render: (args) => <InteractiveWrapper {...args} />,
    args: {
        color: '#fbbf24',
    } as any,
};

export const BankTransactions: Story = {
    render: (args) => <InteractiveWrapper {...args} />,
    args: {
        color: '#3b82f6',
        data: {
            type: 'Bank Transactions',
            data: mockExpenses
        }
    } as any,
};
