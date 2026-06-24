const store = new Map<string, { data: unknown; expires: number }>();

export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const hit = store.get(key);
    if (hit && Date.now() < hit.expires) return Promise.resolve(hit.data as T);
    const promise = fn();
    promise.then((data) => store.set(key, { data, expires: Date.now() + ttlMs }));
    return promise;
}

export function bustCache(prefix: string): void {
    for (const key of store.keys()) {
        if (key.startsWith(prefix)) store.delete(key);
    }
}

export function bustAllCache(): void {
    store.clear();
}

export function cacheSize(): number {
    return store.size;
}
