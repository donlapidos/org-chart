const appInsights = require('applicationinsights');

// Initialize Application Insights if connection string is provided
if (process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
    appInsights.setup(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING)
        .setAutoDependencyCorrelation(true)
        .setAutoCollectRequests(true)
        .setAutoCollectPerformance(true, true)
        .setAutoCollectExceptions(true)
        .setAutoCollectDependencies(true)
        .setAutoCollectConsole(true)
        .setUseDiskRetryCaching(true)
        .setSendLiveMetrics(false)
        .start();
}

const client = appInsights.defaultClient;

/**
 * Log levels
 */
const LOG_LEVELS = {
    DEBUG: 'debug',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error'
};

/**
 * Create structured log entry with required fields
 *
 * @param {string} level - Log level (debug, info, warn, error)
 * @param {string} message - Log message
 * @param {object} metadata - Additional metadata
 * @returns {object} Structured log entry
 */
function createLogEntry(level, message, metadata = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        level: level,
        message: message,
        correlationId: metadata.correlationId || null,
        requestId: metadata.requestId || null,
        userId: metadata.userId || null,
        chartId: metadata.chartId || null,
        action: metadata.action || null,
        latencyMs: metadata.latencyMs || null,
        ...metadata
    };

    // Remove null values for cleaner logs
    Object.keys(entry).forEach(key => {
        if (entry[key] === null) {
            delete entry[key];
        }
    });

    return entry;
}

/**
 * Log a structured message
 *
 * @param {string} level - Log level
 * @param {string} message - Log message
 * @param {object} metadata - Additional metadata
 */
function logStructured(level, message, metadata = {}) {
    const entry = createLogEntry(level, message, metadata);

    // Console output for local development
    console.log(JSON.stringify(entry));

    // Send to Application Insights if available
    if (client) {
        switch (level) {
            case LOG_LEVELS.ERROR:
                client.trackException({
                    exception: new Error(message),
                    properties: entry
                });
                break;
            case LOG_LEVELS.WARN:
                client.trackTrace({
                    message: message,
                    severity: 2, // Warning
                    properties: entry
                });
                break;
            default:
                client.trackTrace({
                    message: message,
                    severity: level === LOG_LEVELS.DEBUG ? 0 : 1,
                    properties: entry
                });
        }
    }
}

/**
 * Log debug message
 */
function logDebug(message, metadata = {}) {
    logStructured(LOG_LEVELS.DEBUG, message, metadata);
}

/**
 * Log info message
 */
function logInfo(message, metadata = {}) {
    logStructured(LOG_LEVELS.INFO, message, metadata);
}

/**
 * Log warning message
 */
function logWarn(message, metadata = {}) {
    logStructured(LOG_LEVELS.WARN, message, metadata);
}

/**
 * Log error message
 */
function logError(message, metadata = {}) {
    logStructured(LOG_LEVELS.ERROR, message, metadata);
}

/**
 * Log function execution with performance metrics
 *
 * @param {string} functionName - Name of the function
 * @param {string} userId - User ID
 * @param {number} startTime - Start timestamp (Date.now())
 * @param {boolean} success - Whether the function succeeded
 * @param {object} additionalMetadata - Additional metadata
 */
function logFunctionExecution(functionName, userId, startTime, success, additionalMetadata = {}) {
    const latencyMs = Date.now() - startTime;

    logInfo(`Function ${functionName} ${success ? 'completed' : 'failed'}`, {
        action: functionName,
        userId: userId,
        latencyMs: latencyMs,
        success: success,
        ...additionalMetadata
    });

    // Track custom metric in Application Insights
    if (client) {
        client.trackMetric({
            name: `${functionName}_Duration`,
            value: latencyMs,
            properties: {
                userId: userId,
                success: success.toString(),
                ...additionalMetadata
            }
        });

        client.trackEvent({
            name: `${functionName}_${success ? 'Success' : 'Failure'}`,
            properties: {
                userId: userId,
                latencyMs: latencyMs,
                ...additionalMetadata
            }
        });
    }
}

/**
 * Track custom event
 *
 * @param {string} eventName - Name of the event
 * @param {object} properties - Event properties
 */
function trackEvent(eventName, properties = {}) {
    logInfo(`Event: ${eventName}`, properties);

    if (client) {
        client.trackEvent({
            name: eventName,
            properties: properties
        });
    }
}

/**
 * Track custom metric
 *
 * @param {string} metricName - Name of the metric
 * @param {number} value - Metric value
 * @param {object} properties - Metric properties
 */
function trackMetric(metricName, value, properties = {}) {
    logInfo(`Metric: ${metricName} = ${value}`, properties);

    if (client) {
        client.trackMetric({
            name: metricName,
            value: value,
            properties: properties
        });
    }
}

/**
 * Generate correlation ID for request tracing
 *
 * @returns {string} UUID v4 correlation ID
 */
function generateCorrelationId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

module.exports = {
    logStructured,
    logDebug,
    logInfo,
    logWarn,
    logError,
    logFunctionExecution,
    trackEvent,
    trackMetric,
    generateCorrelationId,
    LOG_LEVELS
};
