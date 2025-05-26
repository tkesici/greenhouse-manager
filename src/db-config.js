import dotenv from "dotenv";
import sql from "mssql";
dotenv.config()

export const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_DATABASE,
    options: {
        encrypt: true,
        trustServerCertificate: true
    }
};

export const connectionPool = await sql.connect(dbConfig).then((pool) => {
    console.log('Database connection established successfully.');
    return pool;
}).catch(err => {
    console.error('Error connecting to the database:', err);
    throw err;
});
