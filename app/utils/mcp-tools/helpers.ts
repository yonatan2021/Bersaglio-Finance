/* eslint-disable @typescript-eslint/no-explicit-any -- MCP tool handlers consume dynamic JSON responses from internal APIs whose shapes vary by endpoint */
export class VaultLockedError extends Error {
    code: string;
    type: string;
    statusCode: number;
    operational: boolean;

    constructor(message: string, code = "VAULT_LOCKED", type = "VAULT_LOCKED", statusCode = 401) {
        super(message);
        this.name = "VaultLockedError";
        this.code = code;
        this.type = type;
        this.statusCode = statusCode;
        this.operational = true;
    }
}

export function handleMcpError(error: unknown) {
    if (error instanceof VaultLockedError) {
        return {
            isError: true,
            content: [{
                type: "text" as const,
                text: JSON.stringify({
                    status: "error",
                    code: error.code,
                    type: error.type,
                    message: error.message || "Vault is locked. Please unlock the vault via the web UI.",
                    statusCode: error.statusCode,
                    operational: error.operational
                }, null, 2)
            }]
        };
    }
    return {
        isError: true,
        content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }]
    };
}

// Configuration
const PORT = process.env.PORT || "6969";
const API_BASE = process.env.NUDLERS_API_URL || `http://localhost:${PORT}/api`;

// Helper function to make API requests
export async function apiRequest<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const url = `${API_BASE}${endpoint}`;

    const response = await fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...options.headers,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 401) {
            try {
                const parsed = JSON.parse(errorText);
                if (parsed.type === 'VAULT_LOCKED' || parsed.code === 'VAULT_LOCKED') {
                    throw new VaultLockedError(
                        parsed.error || "Vault is locked.",
                        parsed.code || "VAULT_LOCKED",
                        parsed.type || "VAULT_LOCKED",
                        response.status
                    );
                }
            } catch (e) {
                if (e instanceof VaultLockedError) {
                    throw e;
                }
            }
        }
        throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }

    return response.json() as Promise<T>;
}

// Helper to format currency
export function formatCurrency(amount: number): string {
    return new Intl.NumberFormat("he-IL", {
        style: "currency",
        currency: "ILS",
    }).format(amount);
}

// Helper to format transaction amount with sign and Hebrew direction
export function formatTransactionAmount(amount: number): string {
    const isIncome = amount >= 0;
    const sign = isIncome ? "+" : "-";
    const direction = isIncome ? "(הכנסה)" : "(הוצאה)";
    return `${sign}${formatCurrency(Math.abs(amount))} ${direction}`;
}

// Helper function to consume SSE stream from sync-all-stream
export async function consumeSseStream(
    endpoint: string,
    body: any
): Promise<any> {
    const url = `${API_BASE}${endpoint}`;
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.status} - ${errorText}`);
    }

    if (!response.body) {
        throw new Error("No response body received from sync stream");
    }

    const reader = (response.body as any).getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accountsList: Array<{ id: number; nickname: string; vendor: string }> = [];
    let accountsStatus: Array<{ id: number; nickname: string; success: boolean; error?: string }> = [];
    let finalSummary: any = null;

    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            // Save the last partial line back to the buffer
            buffer = lines.pop() || "";

            let currentEvent = "";

            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith("event:")) {
                    currentEvent = trimmed.replace("event:", "").trim();
                } else if (trimmed.startsWith("data:")) {
                    const dataStr = trimmed.replace("data:", "").trim();
                    try {
                        const data = JSON.parse(dataStr);
                        if (currentEvent === "queue") {
                            accountsList = data.accounts || [];
                        } else if (currentEvent === "account_complete") {
                            const acc = accountsList.find(a => a.id === data.id);
                            accountsStatus.push({
                                id: data.id,
                                nickname: acc ? acc.nickname : `Account ${data.id}`,
                                success: true,
                            });
                        } else if (currentEvent === "account_error") {
                            const acc = accountsList.find(a => a.id === data.id);
                            accountsStatus.push({
                                id: data.id,
                                nickname: acc ? acc.nickname : `Account ${data.id}`,
                                success: false,
                                error: data.message,
                            });
                        } else if (currentEvent === "complete") {
                            finalSummary = data.summary;
                        }
                    } catch (e) {
                        // Ignore parsing errors for individual debug lines
                    }
                }
            }
        }
    } finally {
        reader.releaseLock();
    }

    return {
        success: true,
        accounts: accountsStatus,
        summary: finalSummary,
    };
}
