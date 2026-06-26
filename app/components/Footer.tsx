import React from 'react';
import Image from 'next/image';
import { Box, Typography, Container } from '@mui/material';
import { styled, useTheme } from '@mui/material/styles';
import packageJson from '../package.json';

const StyledFooter = styled('footer')(({ theme }) => ({
    padding: '12px 0',
    marginTop: 'auto',
    borderTop: `1px solid ${theme.palette.divider}`,
    background: theme.palette.mode === 'dark'
        ? 'rgba(15, 23, 42, 0.4)'
        : 'rgba(255, 255, 255, 0.4)',
    backdropFilter: 'blur(10px)',
    transition: 'all 0.3s ease',
}));

const FooterContainer = styled(Container)({
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: '16px',
    '@media (max-width: 600px)': {
        flexDirection: 'column',
        textAlign: 'center',
        gap: '8px',
    },
});

const LogoSection = styled(Box)({
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
});


const VersionTag = styled(Typography)(({ theme }) => ({
    fontSize: '0.7rem',
    color: theme.palette.text.disabled,
    fontWeight: 500,
    letterSpacing: '0.05em',
}));

const Footer: React.FC = () => {
    const _theme = useTheme();

    return (
        <StyledFooter>
            <FooterContainer maxWidth="xl">
                <LogoSection>
                    <Image
                        src="/bersaglio-fin-logo.svg"
                        alt="Bersaglio Fin Logo"
                        width={20}
                        height={20}
                        style={{ objectFit: 'contain' }}
                    />
                    <Typography
                        variant="body2"
                        sx={{
                            fontWeight: 400,
                            letterSpacing: '0.01em',
                            color: 'var(--n-primary)',
                            fontSize: '0.85rem',
                            fontFamily: "'DM Serif Display', Georgia, serif"
                        }}
                    >
                        Bersaglio Fin
                    </Typography>
                </LogoSection>


                <VersionTag>
                    v{packageJson.version}
                </VersionTag>
            </FooterContainer>
        </StyledFooter>
    );
};

export default Footer;
