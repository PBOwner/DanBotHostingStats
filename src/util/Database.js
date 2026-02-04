const pool = require('./MySQL.js');

class Database {
    constructor(tableName) {
        this.tableName = tableName;
        this.init();
    }

    async init() {
        // Ensure table exists (Quick.db format: ID (VARCHAR), json (TEXT))
        // We use typical Quick.db schema: ID column and json column.
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
            // We fetch the entire object first to ensure we merge correctly with existing data
            let current = await this.get(id);
            // If the row doesn't exist or is null, start with empty object
            if (current === null || typeof current !== 'object') {
                current = {};
            }

            // Recursive update
            const parts = path.split('.');
            let ref = current;
            for (let i = 0; i < parts.length - 1; i++) {
                if (!ref[parts[i]] || typeof ref[parts[i]] !== 'object') {
                    ref[parts[i]] = {};
                }
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
            // Navigate to the property to delete
            for (let i = 0; i < parts.length - 1; i++) {
                if (!ref[parts[i]]) return false; // Path doesn't exist
                ref = ref[parts[i]];
            }

            const lastPart = parts[parts.length - 1];
            if (ref[lastPart] === undefined) return false;

            delete ref[lastPart];

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
        if (!Array.isArray(array)) array = []; // Safety check
        array.push(value);
        await this.set(key, array);
        return array;
    }

    async add(key, value) {
        const current = await this.get(key);
        const currentNum = Number(current);
        const toAdd = Number(value);
        if (isNaN(toAdd)) throw new Error("Value to add is not a number");

        const newValue = (isNaN(currentNum) ? 0 : currentNum) + toAdd;
        await this.set(key, newValue);
        return newValue;
    }

    async subtract(key, value) {
        const current = await this.get(key);
        const currentNum = Number(current);
        const toSub = Number(value);
        if (isNaN(toSub)) throw new Error("Value to subtract is not a number");

        const newValue = (isNaN(currentNum) ? 0 : currentNum) - toSub;
        await this.set(key, newValue);
        return newValue;
    }

    async has(key) {
        return (await this.get(key)) != null;
    }
}

module.exports = Database;
