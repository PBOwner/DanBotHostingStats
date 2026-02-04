# Quick.db Replacement Plan

##  NOTE:

This plan was generated with Antigravity AI, specifically the Gemini 3 Pro. This implementation should be thoroughly tested before being used in a production environment.

## Overview
This document outlines the plan to replace the deprecated `quick.db` package with a custom MySQL implementation using the existing `mysql2` driver. The goal is to maintain the current database structure and global variable interface (`userData`, `nodeStatus`, etc.) while removing the dependency on `quick.db`.

## Dependencies
- **Current**: `quick.db` (to be removed), `mysql2` (to be kept).
- **New**: None (we will use `mysql2` which is already in `package.json`).

## Proposed Changes

### 1. Database Connection (`src/util/MySQL.js`)
Create a new utility file to handle the MySQL connection pool. This ensures a persistent and efficient connection to the database.

### 2. Database Wrapper (`src/util/Database.js`)
Create a class that replicates the necessary methods of `quick.db` (`get`, `set`, `delete`, `push`, `all`, `add`, `subtract`) but executes raw SQL queries using the `mysql2` pool.
- This class will handle the `ID` and `json` column structure used by `quick.db`.
- It will support dot notation (e.g., `set('user.balance', 100)`).

### 3. Entry Point (`index.js`)
- Remove `quick.db` imports and initialization.
- Import the new `MySQL` connection and `Database` class.
- Initialize global variables (`global.userData`, `global.nodeStatus`, etc.) using the new `Database` class.

### 4. Cleanup (`package.json`)
- Uninstall `quick.db`.

---

## Detailed Implementation

### Step 1: Create `src/util/MySQL.js`
This file will export a `mysql2` promise pool.

```javascript
// src/util/MySQL.js
const mysql = require('mysql2/promise');
const Config = require('../../config.json');

const pool = mysql.createPool({
    host: Config.database.host,
    port: Config.database.port,
    user: Config.database.user,
    password: Config.database.pass,
    database: Config.database.db,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = pool;
```

### Step 2: Create `src/util/Database.js`
This file will contain the logic to interact with the database tables.

```javascript
// src/util/Database.js
const pool = require('./MySQL.js');
const moment = require('moment'); // If used within replacements, otherwise standard Date

class Database {
    constructor(tableName) {
        this.tableName = tableName;
        this.init();
    }

    async init() {
        // Ensure table exists (Quick.db format: ID (VARCHAR), json (TEXT))
        await pool.query(`
            CREATE TABLE IF NOT EXISTS \`${this.tableName}\` (
                ID VARCHAR(255) NOT NULL PRIMARY KEY,
                json LONGTEXT NOT NULL
            )
        `);
    }

    // Helper to handle dot notation keys
    parseKey(key) {
        if (key.includes('.')) {
            const parts = key.split('.');
            return { id: parts[0], path: parts.slice(1).join('.') };
        }
        return { id: key, path: null };
    }

    async get(key) {
        const { id, path } = this.parseKey(key);
        const [rows] = await pool.query(`SELECT json FROM \`${this.tableName}\` WHERE ID = ?`, [id]);
        
        if (rows.length === 0) return null;
        
        let data = JSON.parse(rows[0].json);
        
        if (path) {
            // Traverse path
            const parts = path.split('.');
            for (const part of parts) {
                if (data === undefined || data === null) return null;
                data = data[part];
            }
            return data;
        }
        
        return data;
    }

    async set(key, value) {
        const { id, path } = this.parseKey(key);
        
        if (!path) {
            // Set the full object
            const json = JSON.stringify(value);
            await pool.query(`
                INSERT INTO \`${this.tableName}\` (ID, json) VALUES (?, ?)
                ON DUPLICATE KEY UPDATE json = VALUES(json)
            `, [id, json]);
            return value;
        } else {
            // Update a nested property
            // We fetch, update, and save. JSON_SET can be used but full fetch/save is safer for complex deep setting if structure doesn't exist
            let current = await this.get(id) || {};
            if (typeof current !== 'object') current = {};

            // Recursive update
            const parts = path.split('.');
            let ref = current;
            for (let i = 0; i < parts.length - 1; i++) {
                if (!ref[parts[i]]) ref[parts[i]] = {};
                ref = ref[parts[i]];
            }
            ref[parts[parts.length - 1]] = value;

            const json = JSON.stringify(current);
            await pool.query(`
                INSERT INTO \`${this.tableName}\` (ID, json) VALUES (?, ?)
                ON DUPLICATE KEY UPDATE json = VALUES(json)
            `, [id, json]);
            return current;
        }
    }

    async delete(key) {
        const { id, path } = this.parseKey(key);
        
        if (!path) {
            await pool.query(`DELETE FROM \`${this.tableName}\` WHERE ID = ?`, [id]);
            return true;
        } else {
            let current = await this.get(id);
            if (!current) return false;

            const parts = path.split('.');
            let ref = current;
            for (let i = 0; i < parts.length - 1; i++) {
                if (!ref[parts[i]]) return false;
                ref = ref[parts[i]];
            }
            delete ref[parts[parts.length - 1]];

            const json = JSON.stringify(current);
            await pool.query(`UPDATE \`${this.tableName}\` SET json = ? WHERE ID = ?`, [json, id]);
            return true;
        }
    }

    async all() {
        const [rows] = await pool.query(`SELECT * FROM \`${this.tableName}\``);
        return rows.map(r => ({ ID: r.ID, data: JSON.parse(r.json) }));
    }

    async push(key, value) {
        const current = await this.get(key);
        let array = Array.isArray(current) ? current : [];
        array.push(value);
        await this.set(key, array);
        return array;
    }

    async add(key, value) {
        const current = await this.get(key) || 0;
        const potentialNumber = Number(current);
        const newValue = (isNaN(potentialNumber) ? 0 : potentialNumber) + Number(value);
        await this.set(key, newValue);
        return newValue;
    }

    async subtract(key, value) {
        const current = await this.get(key) || 0;
        const potentialNumber = Number(current);
        const newValue = (isNaN(potentialNumber) ? 0 : potentialNumber) - Number(value);
        await this.set(key, newValue);
        return newValue;
    }
}

module.exports = Database;
```

### Step 3: Modify `index.js`

```diff
- const { QuickDB, MySQLDriver } = require("quick.db");
+ const Database = require("./src/util/Database.js");

- //Starting MySQL Database, and global tables.
- const mysqlDriver = new MySQLDriver({
-     host: Config.database.host,
-     port: Config.database.port,
-     user: Config.database.user,
-     password: Config.database.pass,
-     database: Config.database.db,
- });
-
- await mysqlDriver.connect();
- const db = new QuickDB({ driver: mysqlDriver });

- global.userData = db.table("userData"); 
- global.nodeStatus = db.table("nodeStatus");
- global.userPrem = db.table("userPrem");
- global.codes = db.table("redeemCodes");
- global.nodePing = db.table("nodePing"); 
- global.nodeStatus = db.table("nodeStatus"); // Note: Duplicate assignment in original, removed
- global.nodeServers = db.table("nodeServers");

+ global.userData = new Database("userData"); 
+ global.nodeStatus = new Database("nodeStatus");
+ global.userPrem = new Database("userPrem");
+ global.codes = new Database("redeemCodes");
+ global.nodePing = new Database("nodePing");
+ global.nodeServers = new Database("nodeServers");
```

---

## Affected Files
1.  `src/util/MySQL.js` (NEW)
2.  `src/util/Database.js` (NEW)
3.  `index.js` (Modify)
4.  `package.json` (Remove `quick.db`)
