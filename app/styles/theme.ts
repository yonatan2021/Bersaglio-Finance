
import { createTheme, ThemeOptions } from '@mui/material/styles';

type Mode = 'light' | 'dark';
type Direction = 'ltr' | 'rtl';

// Common settings
const baseTheme: ThemeOptions = {
    typography: {
        fontFamily: "'Outfit', 'Assistant', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif",
        h1: { fontWeight: 800, letterSpacing: '-0.02em' },
        h2: { fontWeight: 700, letterSpacing: '-0.02em' },
        h3: { fontWeight: 700, letterSpacing: '-0.01em' },
        h4: { fontWeight: 600 },
        h5: { fontWeight: 600 },
        h6: { fontWeight: 600 },
        button: { textTransform: 'none', fontWeight: 600, letterSpacing: '0.01em' },
    },
    shape: {
        borderRadius: 12,
    },
    components: {
        MuiButton: {
            styleOverrides: {
                root: {
                    borderRadius: 10,
                    boxShadow: 'none',
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    '&:hover': {
                        transform: 'translateY(-1px)',
                        boxShadow: 'var(--n-shadow-md)',
                    },
                    '&:active': {
                        transform: 'translateY(0)',
                    },
                    '&.MuiButton-containedPrimary': {
                        background: 'var(--n-primary)',
                        '&:hover': {
                            background: 'var(--n-primary-hover)',
                        },
                    },
                },
            },
        },
        MuiCard: {
            styleOverrides: {
                root: {
                    backgroundImage: 'none',
                    borderRadius: 16,
                    border: '1px solid var(--n-border)',
                    backgroundColor: 'var(--n-bg-surface)',
                    boxShadow: 'var(--n-shadow-md)',
                    transition: 'all 0.3s ease',
                    '&:hover': {
                        boxShadow: 'var(--n-shadow-lg)',
                    },
                },
            },
        },
        MuiPaper: {
            styleOverrides: {
                root: {
                    backgroundImage: 'none',
                    backgroundColor: 'var(--n-bg-surface)',
                },
            },
        },
        MuiTableCell: {
            styleOverrides: {
                root: {
                    borderBottom: '1px solid var(--n-border)',
                },
                head: {
                    fontWeight: 700,
                    backgroundColor: 'var(--n-bg-surface-alt)',
                    color: 'var(--n-text-secondary)',
                },
            },
        },
        MuiDialog: {
            styleOverrides: {
                paper: {
                    borderRadius: 20,
                    boxShadow: 'var(--n-shadow-xl)',
                    border: '1px solid var(--n-border)',
                },
            },
        },
    },
};

const lightPalette: ThemeOptions['palette'] = {
    mode: 'light',
    primary: {
        main: '#1a3354',
        light: '#2a5070',
        dark: '#132742',
    },
    secondary: {
        main: '#8a9bb5',
        light: '#b0bdd0',
        dark: '#627d98',
    },
    background: {
        default: '#f8f9fb',
        paper: '#ffffff',
    },
    text: {
        primary: '#0b0f1a',
        secondary: '#4b5563',
    },
    divider: '#e2e5ea',
};

const darkPalette: ThemeOptions['palette'] = {
    mode: 'dark',
    primary: {
        main: '#3e6b8a',
        light: '#627d98',
        dark: '#2a5070',
    },
    secondary: {
        main: '#9fb3c8',
        light: '#bcccdc',
        dark: '#8a9bb5',
    },
    background: {
        default: '#0b0f1a',
        paper: '#111827',
    },
    text: {
        primary: '#f8f9fb',
        secondary: '#9aa1ad',
    },
    divider: '#1f2937',
};

export const buildTheme = (mode: Mode, direction: Direction = 'ltr') =>
    createTheme({
        ...baseTheme,
        direction,
        palette: mode === 'light' ? lightPalette : darkPalette,
    });

export const lightTheme = buildTheme('light');
export const darkTheme = buildTheme('dark');
