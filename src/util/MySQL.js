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
