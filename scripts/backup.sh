#!/bin/bash

# =============================================================================
# Daily Backup Script for AIBillingSystem
# Backs up: PostgreSQL database + Git code changes
# =============================================================================

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="$PROJECT_DIR/backups"
DATE=$(date +%Y-%m-%d_%H-%M-%S)
LOG_FILE="$BACKUP_DIR/backup.log"

# Load environment variables
if [ -f "$PROJECT_DIR/.env" ]; then
    export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "========== Starting Backup =========="

# =============================================================================
# 1. DATABASE BACKUP
# =============================================================================
log "Starting database backup..."

DB_BACKUP_FILE="$BACKUP_DIR/db_backup_$DATE.sql"

# Extract database connection details from DATABASE_URL
if [ -n "$DATABASE_URL" ]; then
    # Create a Node.js backup script
    cat > "$BACKUP_DIR/.backup_db.js" << 'NODESCRIPT'
const { Client } = require('pg');
const fs = require('fs');

async function backup() {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();

    const tablesResult = await client.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
    );

    let backup = '-- Database Backup: ' + new Date().toISOString() + '\n';
    backup += '-- Tables: ' + tablesResult.rows.length + '\n\n';

    for (const row of tablesResult.rows) {
        const table = row.tablename;
        backup += '-- Table: ' + table + '\n';

        const countResult = await client.query('SELECT COUNT(*) FROM "' + table + '"');
        backup += '-- Rows: ' + countResult.rows[0].count + '\n';

        const dataResult = await client.query('SELECT * FROM "' + table + '"');
        if (dataResult.rows.length > 0) {
            for (const dataRow of dataResult.rows) {
                const columns = Object.keys(dataRow).map(k => '"' + k + '"').join(', ');
                const values = Object.values(dataRow).map(v => {
                    if (v === null) return 'NULL';
                    if (typeof v === 'object') return "'" + JSON.stringify(v).replace(/'/g, "''") + "'";
                    if (typeof v === 'string') return "'" + v.replace(/'/g, "''") + "'";
                    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
                    return v;
                }).join(', ');
                backup += 'INSERT INTO "' + table + '" (' + columns + ') VALUES (' + values + ');\n';
            }
        }
        backup += '\n';
    }

    fs.writeFileSync(process.env.BACKUP_FILE, backup);
    console.log('Database backup complete: ' + tablesResult.rows.length + ' tables');
    await client.end();
}

backup().catch(e => {
    console.error('Backup failed:', e.message);
    process.exit(1);
});
NODESCRIPT

    # Run the backup script
    cd "$PROJECT_DIR"
    BACKUP_FILE="$DB_BACKUP_FILE" node "$BACKUP_DIR/.backup_db.js" && \
        log "Database backup saved to: $DB_BACKUP_FILE" || \
        log "ERROR: Database backup failed"

    # Cleanup temp script
    rm -f "$BACKUP_DIR/.backup_db.js"
else
    log "WARNING: DATABASE_URL not set, skipping database backup"
fi

# =============================================================================
# 2. GIT CODE BACKUP
# =============================================================================
log "Starting code backup..."

cd "$PROJECT_DIR"

# Check if there are any changes
if [ -n "$(git status --porcelain)" ]; then
    # Stage all changes
    git add -A

    # Commit with timestamp
    git commit -m "Auto-backup: $DATE

Automated daily backup of uncommitted changes.

Co-Authored-By: Backup Script <backup@local>" || true

    # Push to remote
    git push origin main && log "Code changes pushed to GitHub" || log "WARNING: Failed to push to GitHub"
else
    log "No code changes to backup"
fi

# =============================================================================
# 3. CLEANUP OLD BACKUPS (keep last 30 days)
# =============================================================================
log "Cleaning up old backups..."
find "$BACKUP_DIR" -name "db_backup_*.sql" -mtime +30 -delete 2>/dev/null || true
log "Old backups cleaned up"

# =============================================================================
# SUMMARY
# =============================================================================
log "========== Backup Complete =========="

# Count backup files
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/db_backup_*.sql 2>/dev/null | wc -l | tr -d ' ')
BACKUP_SIZE=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)

log "Total backups: $BACKUP_COUNT files ($BACKUP_SIZE)"
log ""
