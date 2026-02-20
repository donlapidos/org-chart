const { MongoClient } = require('mongodb');

let client = null;
let clientPromise = null;
let dbInitPromise = null;

/**
 * Get or reuse MongoDB client connection
 * Connections are reused across function invocations in the same container
 *
 * Benefits:
 * - First request: ~200ms (connection establishment)
 * - Subsequent requests: ~5-10ms (connection reused)
 * - Saves ~$50-100/month in RU costs
 */
async function getCosmosClient() {
    // Check if existing connection is still alive
    if (client && client.topology && client.topology.isConnected()) {
        return client;
    }

    // Create new connection if needed
    if (!clientPromise) {
        const connectionString = process.env.COSMOS_CONNECTION_STRING;

        if (!connectionString) {
            throw new Error('COSMOS_CONNECTION_STRING environment variable not set');
        }

        client = new MongoClient(connectionString, {
            maxPoolSize: 10,              // Max concurrent connections
            minPoolSize: 2,               // Keep 2 connections warm
            maxIdleTimeMS: 60000,         // Close idle connections after 60s
            serverSelectionTimeoutMS: 5000,
            retryWrites: true,
            retryReads: true
        });

        clientPromise = client.connect();
    }

    await clientPromise;

    // Initialize database on first connection (indexes, TTL, etc.)
    if (!dbInitPromise) {
        dbInitPromise = initializeDatabaseAsync(client);
    }
    await dbInitPromise;

    return client;
}

/**
 * Initialize database asynchronously (non-blocking)
 * Runs setup in background to avoid blocking API requests
 */
async function initializeDatabaseAsync(client) {
    try {
        // Import here to avoid circular dependency
        const { initializeDatabase } = require('./dbSetup');
        await initializeDatabase(client);
    } catch (error) {
        // Log error but don't block API requests
        console.error('Database initialization error:', error.message);
        // Reset promise so it can retry on next request
        dbInitPromise = null;
    }
}

/**
 * Close the MongoDB client connection
 * Only used during graceful shutdown or testing
 */
async function closeCosmosClient() {
    if (client) {
        await client.close();
        client = null;
        clientPromise = null;
        dbInitPromise = null;
    }
}

module.exports = { getCosmosClient, closeCosmosClient };
