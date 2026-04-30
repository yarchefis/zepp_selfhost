const withDebugLogging = Object.hasOwn(process.env, "DEBUG");

export const debugLog = (...args) => {
    if(withDebugLogging) {
        console.log(...args);
    }
};
