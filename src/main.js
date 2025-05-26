import sql from 'mssql';
import dotenv from 'dotenv';

import {createServer} from "./server.js";

dotenv.config();

const app = createServer();

process.on('SIGINT', () => {
    console.log('\nReceived SIGINT. Shutting down gracefully...');
    app.listen().close(() => {
        console.log('Server closed.');
        process.exit(0);
    });
    sql.close().then(() => {
        console.log('Database connection closed.');
        process.exit(0);
    }).catch(err => {
        console.error('Error closing database connection:', err);
        process.exit(1);
    });
});

process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    sql.close().then(() => {
        console.log('Database connection closed.');
        process.exit(0);
    }).catch(err => {
        console.error('Error closing database connection:', err);
        process.exit(1);
    });
})
