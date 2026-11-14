import { TimeoutError } from './errors.js';
export const withTimeout = async (promise, timeoutMs, message) => {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new TimeoutError(message)), timeoutMs);
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    }
    finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
};
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
