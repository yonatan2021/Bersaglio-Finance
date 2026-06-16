/* eslint-disable @typescript-eslint/no-explicit-any -- story wrapper accepts the component's full args bag */
import type { Meta, StoryObj } from '@storybook/react';
import React, { useState } from 'react';
import { Box } from '@mui/material';
import NDatePicker from '../components/NDatePicker';

const meta: Meta<typeof NDatePicker> = {
    title: 'Components/NDatePicker',
    component: NDatePicker,
    parameters: {
        layout: 'centered',
    },
    decorators: [
        (Story) => (
            <Box sx={{ width: '300px', p: 4 }}>
                <Story />
            </Box>
        ),
    ],
};

export default meta;
type Story = StoryObj<typeof NDatePicker>;

const InteractiveTemplate = (args: any) => {
    const [value, setValue] = useState(args.value || '');
    return (
        <NDatePicker
            {...args}
            value={value}
            onChange={setValue}
        />
    );
};

export const Default: Story = {
    render: (args) => <InteractiveTemplate {...args} />,
    args: {
        label: 'Pick a date',
    },
};

export const WithValue: Story = {
    render: (args) => <InteractiveTemplate {...args} />,
    args: {
        value: '2026-01-15',
        label: 'Start Date',
    },
};

export const WithError: Story = {
    render: (args) => <InteractiveTemplate {...args} />,
    args: {
        value: '',
        label: 'Start Date',
        error: 'Date is required',
    },
};

export const Loading: Story = {
    args: {
        value: '',
        loading: true,
    },
};

export const MaxDateToday: Story = {
    render: (args) => <InteractiveTemplate {...args} />,
    args: {
        value: '2026-02-01',
        label: 'Start Date',
        maxDate: new Date(),
    },
};

export const Disabled: Story = {
    args: {
        value: '2026-01-15',
        label: 'Start Date',
        disabled: true,
    },
};
