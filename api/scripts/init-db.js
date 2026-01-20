/**
 * Database Initialization Script
 *
 * This script creates the required collections and indexes for the org chart application
 * Run this after setting up your MongoDB Atlas cluster
 *
 * Usage: node api/scripts/init-db.js
 */

const { MongoClient } = require('mongodb');

// Read connection string from local.settings.json
const localSettings = require('../local.settings.json');
const connectionString = localSettings.Values.COSMOS_CONNECTION_STRING;

if (!connectionString || connectionString === 'mongodb://localhost:27017/orgchart') {
    console.error('❌ ERROR: Please update COSMOS_CONNECTION_STRING in api/local.settings.json');
    console.error('   with your MongoDB Atlas connection string before running this script.');
    process.exit(1);
}

async function initializeDatabase() {
    const client = new MongoClient(connectionString);

    try {
        console.log('🔌 Connecting to MongoDB Atlas...');
        await client.connect();
        console.log('✅ Connected successfully!\n');

        const db = client.db('orgchart');

        // ============================================
        // 1. Create Collections
        // ============================================
        console.log('📁 Creating collections...');

        const collections = await db.listCollections().toArray();
        const collectionNames = collections.map(c => c.name);

        // Create charts collection
        if (!collectionNames.includes('charts')) {
            await db.createCollection('charts');
            console.log('  ✓ Created "charts" collection');
        } else {
            console.log('  ⊙ Collection "charts" already exists');
        }

        // Create deleted_charts collection
        if (!collectionNames.includes('deleted_charts')) {
            await db.createCollection('deleted_charts');
            console.log('  ✓ Created "deleted_charts" collection');
        } else {
            console.log('  ⊙ Collection "deleted_charts" already exists');
        }

        // Create rate_limits collection
        if (!collectionNames.includes('rate_limits')) {
            await db.createCollection('rate_limits');
            console.log('  ✓ Created "rate_limits" collection');
        } else {
            console.log('  ⊙ Collection "rate_limits" already exists');
        }

        console.log('');

        // ============================================
        // 2. Create Indexes
        // ============================================
        console.log('📊 Creating indexes...');

        const charts = db.collection('charts');
        const deletedCharts = db.collection('deleted_charts');
        const rateLimits = db.collection('rate_limits');

        // Charts collection indexes
        await charts.createIndex({ id: 1 }, { unique: true });
        console.log('  ✓ Created unique index on charts.id');

        await charts.createIndex({ ownerId: 1 });
        console.log('  ✓ Created index on charts.ownerId');

        await charts.createIndex({ 'permissions.userId': 1 });
        console.log('  ✓ Created index on charts.permissions.userId');

        await charts.createIndex({ lastModified: -1 });
        console.log('  ✓ Created index on charts.lastModified');

        // Deleted charts indexes
        await deletedCharts.createIndex({ id: 1 });
        console.log('  ✓ Created index on deleted_charts.id');

        await deletedCharts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
        console.log('  ✓ Created TTL index on deleted_charts.expiresAt (90-day auto-deletion)');

        // Rate limits indexes
        await rateLimits.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
        console.log('  ✓ Created TTL index on rate_limits.expiresAt (auto-cleanup)');

        await rateLimits.createIndex({ userId: 1, action: 1, timestamp: 1 });
        console.log('  ✓ Created compound index on rate_limits for efficient queries');

        console.log('');

        // ============================================
        // 3. Database Summary
        // ============================================
        console.log('📋 Database Summary:');
        console.log(`  Database: ${db.databaseName}`);
        console.log(`  Collections: ${(await db.listCollections().toArray()).length}`);

        const stats = await db.stats();
        console.log(`  Storage Size: ${(stats.storageSize / 1024).toFixed(2)} KB`);
        console.log('');

        console.log('✅ Database initialization completed successfully!');
        console.log('');
        console.log('🚀 Next steps:');
        console.log('  1. Run: swa start app --api-location api');
        console.log('  2. Open: http://localhost:4280');
        console.log('');

    } catch (error) {
        console.error('❌ Error during database initialization:', error);
        process.exit(1);
    } finally {
        await client.close();
        console.log('🔌 Connection closed.');
    }
}

// Run initialization
initializeDatabase().catch(console.error);
