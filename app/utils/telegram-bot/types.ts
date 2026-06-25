import { Context, SessionFlavor } from 'grammy';
import { HydrateFlavor } from '@grammyjs/hydrate';
import { ParseModeFlavor } from '@grammyjs/parse-mode';

export interface BotSession {
    conversation?: {
        type: 'expense' | 'triage' | 'search_filter';
        step: string;
        data: Record<string, unknown>;
    };
    pagination?: {
        command: string;
        offset: number;
        filters?: Record<string, unknown>;
    };
}

export type BotContext = HydrateFlavor<ParseModeFlavor<Context & SessionFlavor<BotSession>>>;

export interface TransactionRow {
    id: number;
    identifier: string;
    vendor: string;
    date: string;
    name: string;
    price: number;
    category: string | null;
    memo: string | null;
    account_number: string;
    transaction_type: string;
}

export interface BudgetRow {
    category: string;
    budget_limit: number;
}

export interface CategorySpending {
    category: string;
    actual: number;
    budget: number;
    remaining: number;
    percentUsed: number;
    isOverBudget: boolean;
}
