import { useCallback, useState } from 'react';

export type SnackbarSeverity = 'success' | 'error' | 'info' | 'warning';

export interface SnackbarState<S extends SnackbarSeverity = SnackbarSeverity> {
    open: boolean;
    message: string;
    severity: S;
}

export interface UseSnackbarResult<S extends SnackbarSeverity = SnackbarSeverity> {
    snackbar: SnackbarState<S>;
    showSnackbar: (message: string, severity?: S) => void;
    hideSnackbar: () => void;
}

const DEFAULT_STATE: SnackbarState = { open: false, message: '', severity: 'success' };

export function useSnackbar<S extends SnackbarSeverity = 'success' | 'error'>(
    initial?: Partial<SnackbarState<S>>
): UseSnackbarResult<S> {
    const [snackbar, setSnackbar] = useState<SnackbarState<S>>({
        ...(DEFAULT_STATE as SnackbarState<S>),
        ...initial,
    });

    const showSnackbar = useCallback((message: string, severity: S = 'success' as S) => {
        setSnackbar({ open: true, message, severity });
    }, []);

    const hideSnackbar = useCallback(() => {
        setSnackbar(prev => ({ ...prev, open: false }));
    }, []);

    return { snackbar, showSnackbar, hideSnackbar };
}
