import React from 'react';
import Snackbar, { SnackbarProps } from '@mui/material/Snackbar';
import Alert, { AlertProps } from '@mui/material/Alert';
import { SnackbarState } from './hooks/useSnackbar';

interface SnackbarFeedbackProps {
    snackbar: SnackbarState;
    onClose: () => void;
    autoHideDuration?: number;
    anchorOrigin?: SnackbarProps['anchorOrigin'];
    alertSx?: AlertProps['sx'];
    showAlertClose?: boolean;
}

const SnackbarFeedback: React.FC<SnackbarFeedbackProps> = ({
    snackbar,
    onClose,
    autoHideDuration = 6000,
    anchorOrigin,
    alertSx,
    showAlertClose = true,
}) => (
    <Snackbar
        open={snackbar.open}
        autoHideDuration={autoHideDuration}
        onClose={onClose}
        anchorOrigin={anchorOrigin}
    >
        <Alert
            severity={snackbar.severity}
            onClose={showAlertClose ? onClose : undefined}
            sx={alertSx}
        >
            {snackbar.message}
        </Alert>
    </Snackbar>
);

export default SnackbarFeedback;
