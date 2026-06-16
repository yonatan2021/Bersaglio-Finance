import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the logger
vi.mock('../utils/logger.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
    }
}));

describe('OTP API Handler', () => {
    let handler: any;
    let waitForOtp: any;
    let hasPendingOtp: any;
    let clearPendingOtp: any;

    beforeEach(async () => {
        // Reset global OTP store before each test
        (global as any).otpStore = {
            resolve: null,
            reject: null,
            companyId: null,
            timestamp: null,
        };

        // Import fresh module
        const mod = await import('../pages/api/scrapers/otp');
        handler = mod.default;
        waitForOtp = mod.waitForOtp;
        hasPendingOtp = mod.hasPendingOtp;
        clearPendingOtp = mod.clearPendingOtp;
    });

    afterEach(() => {
        // Clean up any pending OTP
        if ((global as any).otpStore?.reject) {
            (global as any).otpStore.reject(new Error('test cleanup'));
        }
        (global as any).otpStore = {
            resolve: null,
            reject: null,
            companyId: null,
            timestamp: null,
        };
        vi.restoreAllMocks();
    });

    describe('waitForOtp', () => {
        it('should return a promise that resolves when code is submitted', async () => {
            const promise = waitForOtp('hapoalim', 5000);

            // Simulate submitting OTP
            setTimeout(() => {
                const resolve = (global as any).otpStore.resolve;
                (global as any).otpStore = { resolve: null, reject: null, companyId: null, timestamp: null };
                resolve('123456');
            }, 50);

            const code = await promise;
            expect(code).toBe('123456');
        });

        it('should reject on timeout', async () => {
            const promise = waitForOtp('hapoalim', 100); // 100ms timeout

            await expect(promise).rejects.toThrow(/OTP timeout/);
        });

        it('should set companyId in the store', () => {
            waitForOtp('hapoalim', 5000).catch(() => { }); // Suppress unhandled rejection

            expect((global as any).otpStore.companyId).toBe('hapoalim');
        });

        it('should set timestamp in the store', () => {
            const before = Date.now();
            waitForOtp('hapoalim', 5000).catch(() => { });
            const after = Date.now();

            expect((global as any).otpStore.timestamp).toBeGreaterThanOrEqual(before);
            expect((global as any).otpStore.timestamp).toBeLessThanOrEqual(after);
        });

        it('should supersede previous pending OTP request', async () => {
            const first = waitForOtp('hapoalim', 5000);
            const _second = waitForOtp('discount', 5000).catch(() => { });

            await expect(first).rejects.toThrow(/superseded/);
            expect((global as any).otpStore.companyId).toBe('discount');

            // Clean up second
            clearPendingOtp();
        });
    });

    describe('hasPendingOtp', () => {
        it('should return false when no OTP is pending', () => {
            expect(hasPendingOtp()).toBe(false);
        });

        it('should return true when OTP is pending', () => {
            waitForOtp('hapoalim', 5000).catch(() => { });
            expect(hasPendingOtp()).toBe(true);
        });
    });

    describe('clearPendingOtp', () => {
        it('should clear the pending OTP and reject the promise', async () => {
            const promise = waitForOtp('hapoalim', 5000);

            clearPendingOtp();

            await expect(promise).rejects.toThrow(/cancelled/);
            expect(hasPendingOtp()).toBe(false);
        });

        it('should be safe to call when no OTP is pending', () => {
            expect(() => clearPendingOtp()).not.toThrow();
        });
    });

    describe('POST /api/scrapers/otp', () => {
        it('should return 400 for missing otpCode', async () => {
            const req = { method: 'POST', body: {} };
            const res = createMockRes();

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                message: 'OTP code is required'
            }));
        });

        it('should return 400 for empty otpCode', async () => {
            const req = { method: 'POST', body: { otpCode: '   ' } };
            const res = createMockRes();

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('should return 400 for non-string otpCode', async () => {
            const req = { method: 'POST', body: { otpCode: 12345 } };
            const res = createMockRes();

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('should return 409 when no OTP is pending', async () => {
            const req = { method: 'POST', body: { otpCode: '123456' } };
            const res = createMockRes();

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(409);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: false,
                message: 'No pending OTP request'
            }));
        });

        it('should resolve pending OTP and return 200', async () => {
            const promise = waitForOtp('hapoalim', 5000);

            const req = { method: 'POST', body: { otpCode: '123456' } };
            const res = createMockRes();

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                success: true
            }));

            const code = await promise;
            expect(code).toBe('123456');
        });

        it('should trim the OTP code', async () => {
            const promise = waitForOtp('hapoalim', 5000);

            const req = { method: 'POST', body: { otpCode: '  123456  ' } };
            const res = createMockRes();

            await handler(req, res);

            const code = await promise;
            expect(code).toBe('123456');
        });
    });

    describe('GET /api/scrapers/otp', () => {
        it('should return pending=false when no OTP is pending', async () => {
            const req = { method: 'GET' };
            const res = createMockRes();

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                pending: false
            }));
        });

        it('should return pending=true with companyId when OTP is pending', async () => {
            waitForOtp('hapoalim', 5000).catch(() => { });

            const req = { method: 'GET' };
            const res = createMockRes();

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(200);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                pending: true,
                companyId: 'hapoalim'
            }));
        });
    });

    describe('Other methods', () => {
        it('should return 405 for unsupported methods', async () => {
            const req = { method: 'PUT', body: {} };
            const res = createMockRes();

            await handler(req, res);

            expect(res.status).toHaveBeenCalledWith(405);
        });
    });
});

describe('Hapoalim OTP Handler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (global as any).otpStore = {
            resolve: null,
            reject: null,
            companyId: null,
            timestamp: null,
        };
    });

    afterEach(() => {
        if ((global as any).otpStore?.reject) {
            (global as any).otpStore.reject(new Error('test cleanup'));
        }
        (global as any).otpStore = {
            resolve: null,
            reject: null,
            companyId: null,
            timestamp: null,
        };
        vi.restoreAllMocks();
    });

    describe('isOtpPage', () => {
        it('should detect OTP page via the form.auth-otp-login selector (primary signal)', async () => {
            const { isOtpPage } = await import('../scrapers/hapoalimOtp');
            const mockForm = { _isFormElement: true };
            const mockPage = createMockPuppeteerPage();
            mockPage.$.mockImplementation((sel: string) =>
                Promise.resolve(sel === 'form.auth-otp-login' ? mockForm : null)
            );
            mockPage.url.mockReturnValue('https://login.bankhapoalim.co.il/ng-portals-bt/auth/login');

            const result = await isOtpPage(mockPage as any);
            expect(result).toBe(true);
        });

        it('should detect OTP page when the form is in an iframe', async () => {
            const { isOtpPage } = await import('../scrapers/hapoalimOtp');
            const mockForm = { _isFormElement: true };
            const mainFrame = { url: () => 'main', $: vi.fn().mockResolvedValue(null) };
            const otpFrame = {
                url: () => 'https://login.bankhapoalim.co.il/iframe-otp',
                $: vi.fn().mockImplementation((sel: string) =>
                    Promise.resolve(sel === 'form.auth-otp-login' ? mockForm : null)
                ),
                $$: vi.fn().mockResolvedValue([]),
            };
            const mockPage = createMockPuppeteerPage();
            mockPage.$.mockResolvedValue(null);
            mockPage.frames.mockReturnValue([mainFrame, otpFrame]);
            mockPage.mainFrame.mockReturnValue(mainFrame);

            const result = await isOtpPage(mockPage as any);
            expect(result).toBe(true);
        });

        it('should detect OTP page by separated digit input fallback when form selector misses', async () => {
            const { isOtpPage } = await import('../scrapers/hapoalimOtp');
            const fakeInputs = Array.from({ length: 5 }, () => ({}));
            const mockPage = createMockPuppeteerPage();
            mockPage.$.mockResolvedValue(null);
            mockPage.$$.mockImplementation((sel: string) =>
                Promise.resolve(sel === 'input[data-testid^="separated-"]' ? fakeInputs : [])
            );

            const result = await isOtpPage(mockPage as any);
            expect(result).toBe(true);
        });

        it('should detect OTP page via narrow URL patterns as a tertiary fallback', async () => {
            const { isOtpPage } = await import('../scrapers/hapoalimOtp');
            const patterns = [
                'https://login.bankhapoalim.co.il/VALIDATEOTPCODE/start',
                'https://login.bankhapoalim.co.il/smsVerification/page',
                'https://login.bankhapoalim.co.il/MOBILE_AUTHENTICATION/start',
                'https://login.bankhapoalim.co.il/AUTHENTICATE/OTP/validate',
            ];
            for (const url of patterns) {
                const mockPage = createMockPuppeteerPage();
                mockPage.url.mockReturnValue(url);
                mockPage.$.mockResolvedValue(null);
                mockPage.$$.mockResolvedValue([]);
                const result = await isOtpPage(mockPage as any);
                expect(result, `URL ${url} should be detected as OTP`).toBe(true);
            }
        });

        it('should return false for the regular login page (no form, no digit inputs, login URL)', async () => {
            const { isOtpPage } = await import('../scrapers/hapoalimOtp');
            const mockPage = createMockPuppeteerPage();
            mockPage.url.mockReturnValue('https://login.bankhapoalim.co.il/portalserver/HomePage');
            mockPage.$.mockResolvedValue(null);
            mockPage.$$.mockResolvedValue([]);
            mockPage.evaluate.mockResolvedValue(false);

            const result = await isOtpPage(mockPage as any);
            expect(result).toBe(false);
        });

        it('should not return false-positive when the regular login form (#userCode) is present', async () => {
            const { isOtpPage } = await import('../scrapers/hapoalimOtp');
            const mockPage = createMockPuppeteerPage();
            mockPage.url.mockReturnValue('https://login.bankhapoalim.co.il/ng-portals/auth/login');
            mockPage.$.mockResolvedValue(null);
            mockPage.$$.mockResolvedValue([]);
            // text scan: even if Hebrew keywords leaked into the page, login form presence overrides
            mockPage.evaluate.mockResolvedValue(false);

            const result = await isOtpPage(mockPage as any);
            expect(result).toBe(false);
        });

        it('should handle DOM query errors gracefully', async () => {
            const { isOtpPage } = await import('../scrapers/hapoalimOtp');
            const mockPage = createMockPuppeteerPage();
            mockPage.url.mockReturnValue('https://login.bankhapoalim.co.il/somepage');
            mockPage.$.mockRejectedValue(new Error('Page not available'));
            mockPage.$$.mockRejectedValue(new Error('Page not available'));
            mockPage.evaluate.mockRejectedValue(new Error('Page not available'));

            const result = await isOtpPage(mockPage as any);
            expect(result).toBe(false);
        });
    });

    describe('handleHapoalimOtp', () => {
        it('should throw if the OTP form cannot be located within the timeout', async () => {
            const { handleHapoalimOtp } = await import('../scrapers/hapoalimOtp');
            const onProgress = vi.fn();
            const mockPage = createMockPuppeteerPage();
            // Default mocks: $ returns null, frames returns [mainFrame] only — form never appears.

            await expect(handleHapoalimOtp(mockPage as any, onProgress)).rejects.toThrow(/form not found/i);
            expect(onProgress).toHaveBeenCalledWith('hapoalim', expect.objectContaining({
                type: 'otpFailed',
                message: expect.stringMatching(/2FA verification form not found/i),
            }));
        }, 15000);

        it('should emit otpRequired and abort cleanly when the user OTP wait times out', async () => {
            const { handleHapoalimOtp } = await import('../scrapers/hapoalimOtp');
            const otpMod = await import('../pages/api/scrapers/otp');
            const onProgress = vi.fn();

            const mockPage = createMockPuppeteerPageWithForm();

            const spy = vi.spyOn(otpMod, 'waitForOtp').mockRejectedValue(new Error('OTP timeout'));
            try {
                await expect(handleHapoalimOtp(mockPage as any, onProgress)).rejects.toThrow(/OTP timeout/);
                expect(onProgress).toHaveBeenCalledWith('hapoalim', expect.objectContaining({
                    type: 'otpRequired',
                    attempt: 1,
                    maxAttempts: 3,
                }));
                expect(onProgress).toHaveBeenCalledWith('hapoalim', expect.objectContaining({
                    type: 'otpFailed',
                    message: 'OTP timeout',
                }));
            } finally {
                spy.mockRestore();
            }
        });

        it('should type each digit with real keyboard events and click submit with real mouse', async () => {
            const { handleHapoalimOtp } = await import('../scrapers/hapoalimOtp');
            const onProgress = vi.fn();

            // Build a Puppeteer-like mock where the form is present, then disappears, and URL flips.
            const { mockPage, digitInputs, formClicks } = buildOtpScenario({
                code: '12345',
                formGoesAwayAfterSubmit: true,
                successUrl: 'https://login.bankhapoalim.co.il/ng-portals/rb/he/homepage',
            });

            const promise = handleHapoalimOtp(mockPage as any, onProgress);

            // Drive the user-side: wait for the scraper to call waitForOtp, then resolve it.
            const code = await waitForOtpResolveFromTest('12345');
            expect(code).toBe('12345');

            const result = await promise;
            expect(result).toBe(true);

            // Each input got: click → evaluate(clear) → type(digit, {delay})
            for (let i = 0; i < 5; i++) {
                expect(digitInputs[i].click).toHaveBeenCalled();
                expect(digitInputs[i].evaluate).toHaveBeenCalled(); // value clear
                expect(digitInputs[i].type).toHaveBeenCalledWith('12345'[i], expect.objectContaining({ delay: expect.any(Number) }));
            }

            // Submit was clicked via REAL mouse on the form context (page.click), not via page.evaluate
            expect(formClicks.length).toBeGreaterThan(0);
            const evalCalls = (mockPage.evaluate as any).mock.calls;
            const synthClickCall = evalCalls.find((call: any[]) => {
                const fnSrc = call[0]?.toString?.() || '';
                return /querySelector.*click\(\)/.test(fnSrc) || /\.click\(\)/.test(fnSrc);
            });
            expect(synthClickCall).toBeUndefined();

            // Success event emitted
            expect(onProgress).toHaveBeenCalledWith('hapoalim', expect.objectContaining({
                type: 'otpSuccess',
            }));
        }, 30000);

        it('should retry on inline error and succeed on the second attempt', async () => {
            const { handleHapoalimOtp } = await import('../scrapers/hapoalimOtp');
            const onProgress = vi.fn();

            const { mockPage, digitInputs } = buildOtpScenario({
                code: 'ignored',
                attempts: [
                    { kind: 'wrong-code', errorText: 'הקוד שהוקלד שגוי' },
                    { kind: 'success', successUrl: 'https://login.bankhapoalim.co.il/portalserver/HomePage' },
                ],
            });

            const promise = handleHapoalimOtp(mockPage as any, onProgress);

            // Attempt #1: user enters wrong code
            await waitForOtpResolveFromTest('00000');

            // Attempt #2: user enters right code
            await waitForOtpResolveFromTest('99999', 10000);

            const result = await promise;
            expect(result).toBe(true);

            // otpFailed was emitted between attempts (with retry message), and otpRequired re-emitted
            const events = (onProgress.mock.calls as any[]).map((call) => call[1]?.type);
            expect(events.filter((t: string) => t === 'otpRequired').length).toBe(2);
            expect(events).toContain('otpFailed');
            expect(events).toContain('otpSuccess');

            // Each digit was retyped on the second attempt — i.e. type called twice per input
            expect(digitInputs[0].type).toHaveBeenCalledTimes(2);
        }, 60000);

        it('should give up after MAX_OTP_ATTEMPTS wrong codes', async () => {
            const { handleHapoalimOtp } = await import('../scrapers/hapoalimOtp');
            const onProgress = vi.fn();

            const { mockPage } = buildOtpScenario({
                attempts: [
                    { kind: 'wrong-code', errorText: 'שגוי 1' },
                    { kind: 'wrong-code', errorText: 'שגוי 2' },
                    { kind: 'wrong-code', errorText: 'שגוי 3' },
                ],
            });

            const promise = handleHapoalimOtp(mockPage as any, onProgress);
            await waitForOtpResolveFromTest('11111');
            await waitForOtpResolveFromTest('22222', 10000);
            await waitForOtpResolveFromTest('33333', 10000);

            await expect(promise).rejects.toThrow(/failed after 3 attempts/);
            const events = (onProgress.mock.calls as any[]).map((call) => call[1]);
            const lastFailure = [...events].reverse().find((e) => e?.type === 'otpFailed');
            expect(lastFailure?.message).toMatch(/failed after 3 attempts/);
        }, 90000);
    });
});

// --- Test fixtures --------------------------------------------------------

/**
 * Polls global.otpStore until the scraper has registered a waitForOtp handler,
 * then resolves it with `code`. Returns the resolved code for assertion.
 */
async function waitForOtpResolveFromTest(code: string, timeoutMs = 5000): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const resolveFn = (global as any).otpStore?.resolve;
        if (resolveFn) {
            (global as any).otpStore = { resolve: null, reject: null, companyId: null, timestamp: null };
            resolveFn(code);
            return code;
        }
        await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`Timed out waiting for scraper to call waitForOtp (${timeoutMs}ms)`);
}

/**
 * Build a Puppeteer-like mock that simulates the OTP form lifecycle across
 * one or more attempts.
 *
 * Each attempt has a `kind`:
 *   'wrong-code' — after submit, the form remains and the inline error TEXT changes
 *                  (so handler distinguishes fresh error from stale).
 *   'success'    — after submit, the form goes away and the URL flips to `successUrl`.
 */
function buildOtpScenario(opts: {
    code?: string;
    formGoesAwayAfterSubmit?: boolean;
    successUrl?: string;
    attempts?: Array<{ kind: 'wrong-code' | 'success'; errorText?: string; successUrl?: string }>;
}) {
    const attempts = opts.attempts
        ?? [{ kind: 'success' as const, successUrl: opts.successUrl ?? 'https://login.bankhapoalim.co.il/ng-portals/rb/he/homepage' }];

    const mockForm = { _isFormElement: true };
    const mockErrorEl = { _isErrorElement: true };

    const digitInputs = Array.from({ length: 5 }, () => ({
        click: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(undefined),
        type: vi.fn().mockResolvedValue(undefined),
        boundingBox: vi.fn().mockResolvedValue({ x: 0, y: 0, width: 40, height: 40 }),
    }));

    const formClicks: Array<{ selector: string; t: number }> = [];

    let attemptIdx = 0;
    let phase: 'awaiting-submit' | 'after-submit' = 'awaiting-submit';
    let currentUrl = 'https://login.bankhapoalim.co.il/ng-portals-bt/auth/login';
    let currentErrorText: string | null = null; // text of the inline error
    let formPresent = true;

    const advancePhaseAfterSubmit = () => {
        const a = attempts[attemptIdx];
        if (!a) return;
        phase = 'after-submit';
        if (a.kind === 'success') {
            formPresent = false;
            currentUrl = a.successUrl ?? 'https://login.bankhapoalim.co.il/ng-portals/rb/he/homepage';
        } else {
            // wrong-code: form stays, error text appears (different from any prior)
            formPresent = true;
            currentErrorText = a.errorText ?? `wrong-${attemptIdx}`;
        }
    };

    const onSubmitClicked = (selector: string) => {
        formClicks.push({ selector, t: Date.now() });
        // Schedule the post-submit DOM change shortly after the click
        setTimeout(advancePhaseAfterSubmit, 50);
    };

    const onAttemptResubmitted = () => {
        // Called when the handler loops back for a retry after wrong-code.
        attemptIdx++;
        phase = 'awaiting-submit';
        // Keep the previous error text visible (stale) until the new submit clears it server-side.
        // Don't reset currentErrorText — handler must distinguish stale from fresh.
    };

    const mockPage: any = {
        url: vi.fn(() => currentUrl),
        $: vi.fn().mockImplementation((sel: string) => {
            if (sel === 'form.auth-otp-login') return Promise.resolve(formPresent ? mockForm : null);
            if (sel === '.errors-rb .error-message, .auth-otp-login .error') {
                return Promise.resolve(currentErrorText ? mockErrorEl : null);
            }
            return Promise.resolve(null);
        }),
        $$: vi.fn().mockImplementation((sel: string) => {
            if (sel === 'form.auth-otp-login input[type="text"]') {
                return Promise.resolve(formPresent ? digitInputs : []);
            }
            if (sel === 'input[data-testid^="separated-"]') {
                return Promise.resolve(formPresent ? digitInputs : []);
            }
            return Promise.resolve([]);
        }),
        click: vi.fn().mockImplementation((sel: string) => {
            // The handler will retry via different selectors — we accept the first scoped attempt
            // and trigger the post-submit phase. If a retry attempt is pending, we treat any
            // click on .btn-red_1 (with or without form scope) as the next submit.
            if (sel.includes('.btn-red_1')) {
                if (phase === 'awaiting-submit') {
                    onSubmitClicked(sel);
                } else if (phase === 'after-submit' && attemptIdx + 1 < attempts.length) {
                    // This is the retry submit
                    onAttemptResubmitted();
                    onSubmitClicked(sel);
                }
                return Promise.resolve(undefined);
            }
            return Promise.resolve(undefined);
        }),
        type: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockImplementation(async (fn: any) => {
            // captureErrorState is implemented as evaluate((selector) => ...). Simulate it.
            const fnSrc = typeof fn === 'function' ? fn.toString() : '';
            if (fnSrc.includes('querySelectorAll')) {
                return currentErrorText ?? '';
            }
            return false;
        }),
        screenshot: vi.fn().mockResolvedValue(undefined),
        mainFrame: vi.fn().mockReturnValue({ url: () => 'main' }),
        frames: vi.fn().mockReturnValue([{ url: () => 'main' }]),
        isClosed: vi.fn().mockReturnValue(false),
        keyboard: { press: vi.fn().mockResolvedValue(undefined) },
        waitForNavigation: vi.fn().mockResolvedValue(undefined),
        waitForFunction: vi.fn().mockResolvedValue(undefined),
    };
    // mainFrame must equal one of the entries in frames() so iframe loop skips it
    const mainFrameRef = { url: () => 'main' };
    mockPage.mainFrame.mockReturnValue(mainFrameRef);
    mockPage.frames.mockReturnValue([mainFrameRef]);

    return { mockPage, digitInputs, formClicks };
}

/**
 * A bare puppeteer-page mock with the OTP form selector returning a truthy element,
 * so handleHapoalimOtp gets past the "form not found" guard.
 */
function createMockPuppeteerPageWithForm() {
    const page = createMockPuppeteerPage();
    const mockForm = { _isFormElement: true };
    page.$.mockImplementation((sel: string) =>
        Promise.resolve(sel === 'form.auth-otp-login' ? mockForm : null)
    );
    return page;
}

// Helper to create mock response object
function createMockRes() {
    const res: any = {};
    res.status = vi.fn().mockReturnValue(res);
    res.json = vi.fn().mockReturnValue(res);
    return res;
}

// Helper to create a mock Puppeteer page
function createMockPuppeteerPage() {
    const mainFrame = { url: () => 'main' };
    const page: any = {
        url: vi.fn().mockReturnValue('https://login.bankhapoalim.co.il/some-page'),
        evaluate: vi.fn().mockResolvedValue(false),
        evaluateHandle: vi.fn().mockResolvedValue({ asElement: () => null }),
        $: vi.fn().mockResolvedValue(null),
        $$: vi.fn().mockResolvedValue([]),
        click: vi.fn().mockResolvedValue(undefined),
        type: vi.fn().mockResolvedValue(undefined),
        keyboard: {
            press: vi.fn().mockResolvedValue(undefined)
        },
        waitForNavigation: vi.fn().mockResolvedValue(undefined),
        waitForFunction: vi.fn().mockResolvedValue(undefined),
        screenshot: vi.fn().mockResolvedValue(undefined),
        mainFrame: vi.fn().mockReturnValue(mainFrame),
        frames: vi.fn().mockReturnValue([mainFrame]),
        isClosed: vi.fn().mockReturnValue(false),
    };
    return page;
}
